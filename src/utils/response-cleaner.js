/**
 * Utilidades para limpiar y validar respuestas de modelos de IA.
 *
 * Capa de post-procesamiento del harness. No pertenece al núcleo del proveedor
 * (es agnóstico al modelo), pero mejora significativamente la calidad de lo que
 * entrega el harness cuando se activa explícitamente para tareas de código/web.
 *
 * Regla importante: NO eliminar markdown de respuestas de chat. Un mensaje
 * conversacional puede contener bloques de código legítimos y debe conservarse.
 */

const LANGUAGE_ALIASES = {
	js: "javascript",
	javascript: "javascript",
	node: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	python: "python",
	html: "html",
	htm: "html",
	css: "css",
	json: "json",
};

// Un modelo puede etiquetar el mismo lenguaje con varios alias (```js,
// ```javascript, ```node). La búsqueda debe aceptarlos todos; si no, se caía
// al primer bloque genérico y, en respuestas multi-archivo, se validaba el
// HTML como si fuera JavaScript.
const FENCE_ALIASES = {
	javascript: ["javascript", "js", "node", "mjs", "cjs"],
	python: ["python", "py"],
	html: ["html", "htm"],
	css: ["css"],
	json: ["json"],
};

const normalizeLanguage = (value) => {
	if (typeof value !== "string") return null;
	const key = value.trim().toLowerCase().replace(/^\.+/, "");
	return LANGUAGE_ALIASES[key] || key || null;
};

const buildFenceRegex = (language) => {
	const lang = normalizeLanguage(language);
	const aliases = FENCE_ALIASES[lang];
	// No `g`: evitar fugas de `lastIndex` entre llamadas.
	if (aliases) {
		return new RegExp(`\`\`\`(?:${aliases.join("|")})[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?\`\`\``, "i");
	}
	if (lang) {
		return new RegExp(`\`\`\`(?:${lang})[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?\`\`\``, "i");
	}
	return /```(?:[\w-]+)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/i;
};

/**
 * Extrae el código de un bloque markdown. Si no hay bloques, devuelve el texto.
 *
 * @param {string} text - Respuesta cruda del modelo
 * @param {string} [expectedLanguage] - Lenguaje esperado (javascript, python, html, css, etc.)
 * @returns {string} Texto limpio sin marcadores markdown
 */
export function extractCodeBlock(text, expectedLanguage) {
	if (typeof text !== "string" || text.trim() === "") {
		return text;
	}

	const trimmed = text.trim();
	const target = normalizeLanguage(expectedLanguage);

	// Primero el bloque etiquetado con el idioma esperado, aunque haya otros
	// antes. Así extraer JavaScript de una respuesta HTML+CSS+JS no devuelve
	// el HTML por ser el primer bloque del texto.
	if (target) {
		const matchingBlock = extractCodeBlocks(trimmed).find((block) => block.language === target);
		if (matchingBlock?.code) return matchingBlock.code;
	}

	const specific = buildFenceRegex(expectedLanguage).exec(trimmed);
	if (specific?.[1]) {
		return specific[1].trim();
	}

	const generic = buildFenceRegex().exec(trimmed);
	if (generic?.[1]) {
		return generic[1].trim();
	}

	return trimmed;
}

/**
 * Extrae TODOS los bloques de código de una respuesta, útil para landing pages
 * donde el modelo entrega index.html, style.css y script.js en bloques distintos.
 *
 * @param {string} text
 * @returns {Array<{language: string|null, code: string}>}
 */
export function extractCodeBlocks(text) {
	if (typeof text !== "string" || text.trim() === "") return [];

	const blocks = [];
	const pattern = /```([\w-]+)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/gi;
	let match;
	while ((match = pattern.exec(text)) !== null) {
		blocks.push({
			language: match[1] ? normalizeLanguage(match[1]) : null,
			code: match[2].trim(),
		});
	}
	return blocks;
}

/**
 * Detecta si el modelo se negó a generar contenido (texto explicativo en lugar de código).
 *
 * @param {string} text - Respuesta del modelo
 * @param {string} [taskType] - Tipo de tarea (code, web, html, css, js)
 * @returns {{refused: boolean, reason?: string}}
 */
export function detectRefusal(text, taskType = "code") {
	if (typeof text !== "string" || text.trim() === "") {
		return { refused: true, reason: "empty response" };
	}

	const trimmed = text.trim();
	const lineas = trimmed.split("\n");
	// Los comentarios iniciales son parte legítima del código: no deben
	// interpretarse como una negativa del modelo.
	const primeraLineaUtil = lineas.find((linea) => !/^\s*(\/\/|#|\/\*|\*)/.test(linea)) || lineas[0] || "";
	const firstLine = primeraLineaUtil.toLowerCase();

	const refusalPatterns = [
		/lo siento/,
		/no puedo/,
		/disculpe/,
		/no tengo acceso a internet/,
		/i'm sorry/,
		/i cannot/,
		/i can't/,
		/as an ai/,
		/no puedo crear/,
		/no puedo generar/,
	];

	// Solo la primera línea: buscar en los primeros 200 caracteres daba falsos
	// positivos con comentarios legítimos como `// No puedo creer que...`.
	for (const pattern of refusalPatterns) {
		if (pattern.test(firstLine)) {
			return { refused: true, reason: "the model refused to generate content" };
		}
	}

	// Detectar HTML embebido en archivo que debería ser JS
	if (taskType === "js" || taskType === "javascript") {
		if (/<!DOCTYPE\s+html>/i.test(trimmed) || /<html[^>]*>/i.test(trimmed)) {
			return { refused: false, reason: "contamination: HTML detected in a JS file" };
		}
	}

	// Detectar CSS embebido en archivo que debería ser HTML puro
	if (taskType === "html") {
		if (/<style[^>]*>/i.test(trimmed)) {
			return { refused: false, reason: "contamination: embedded CSS in HTML" };
		}
	}

	return { refused: false };
}

/**
 * Valida que la respuesta tenga contenido mínimo útil.
 *
 * @param {string} text - Respuesta del modelo
 * @param {number} [minChars] - Caracteres mínimos esperados (default: 50)
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateMinimumContent(text, minChars = 50) {
	if (typeof text !== "string" || text.trim().length < minChars) {
		return {
			valid: false,
			reason: "response too short: " + (text?.trim().length || 0) + " chars (minimum " + minChars + ")",
		};
	}
	return { valid: true };
}

export default { extractCodeBlock, extractCodeBlocks, detectRefusal, validateMinimumContent };
