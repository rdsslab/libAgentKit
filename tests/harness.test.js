import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";

import { askAgent } from "../src/agent.js";
import {
	createAIProviderAdapter,
	registerAIProviderAdapter,
} from "../src/ia.js";
import { getModelConfig } from "../src/config/presets.js";
import { shouldRunPreSearch } from "../src/policies.js";
import {
	extractCodeBlock,
	extractCodeBlocks,
	detectRefusal,
} from "../src/utils/response-cleaner.js";
import { validateSyntax } from "../src/utils/syntax-validator.js";
import { ResponseCache, createCacheKey } from "../src/utils/response-cache.js";
import { suggestTimeoutMs } from "../src/utils/adaptive-timeout.js";
import { recommendModel } from "../src/utils/model-registry.js";
import { enhancedAskAgent } from "../src/utils/harness-improvements.js";
import { enriquecerMensajes } from "../src/utils/task-enhancer.js";
import { detectPromptLanguage, getSystemPrompt } from "../src/utils/system-prompts-en.js";
import { normalizeToolArguments } from "../src/utils/tool-arguments.js";
import { generateMultiFile, stripWrapperTags } from "../src/utils/multi-file-generator.js";
import {
  blocksByLanguage,
  firstBlock,
  mergeBlocks,
  missingBlockLanguages,
  normalizeBlockKey,
  sanitizeToolName,
} from "./utils/e2e-helpers.js";
import { validateEmailBehavior, validateReadFileBehavior, validateLandingWiring } from "./utils/code-behavior.js";

const fakeProviderNamePrefix = "test-harness-";
let fakeProviderCounter = 0;

const python3Available = (() => {
	try {
		return spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;
	} catch {
		return false;
	}
})();

function registerFakeAdapter(run, onConfig) {
	const name = `${fakeProviderNamePrefix}${fakeProviderCounter++}`;
	registerAIProviderAdapter(name, (config) => {
		if (typeof onConfig === "function") onConfig(config);
		return { run };
	});
	return { provider: name, model: "fake-model" };
}

test("askAgent: provider.system y system de nivel superior llegan al proveedor", async () => {
	let captured = null;
	const provider = registerFakeAdapter(async ({ prompts }) => {
		captured = prompts;
		return { text: "ok" };
	});

	await askAgent({
		provider: { ...provider, system: "SYSTEM DESDE PROVIDER" },
		system: "SYSTEM SUPERIOR",
		messages: [{ role: "user", content: "hola" }],
	});

	const systems = captured.filter((m) => m.role === "system").map((m) => m.content);
	assert.equal(systems.length, 1);
	assert.match(systems[0], /SYSTEM SUPERIOR/);
	assert.match(systems[0], /SYSTEM DESDE PROVIDER/);
});

test("askAgent: mensajes system del historial se consolidan con provider.system", async () => {
	let captured = null;
	const provider = registerFakeAdapter(async ({ prompts }) => {
		captured = prompts;
		return { text: "ok" };
	});

	await askAgent({
		provider: { ...provider, system: "SYSTEM DEL PRESET" },
		history: [{ role: "system", content: "SYSTEM DEL HISTORIAL" }],
		messages: [{ role: "user", content: "hola" }],
	});

	const systems = captured.filter((m) => m.role === "system");
	assert.equal(systems.length, 1);
	assert.match(systems[0].content, /SYSTEM DEL PRESET/);
	assert.match(systems[0].content, /SYSTEM DEL HISTORIAL/);
	assert.equal(captured.filter((m) => m.role === "user").length, 1);
});

test("askAgent: provider.systemPrompt también se respeta", async () => {
	let captured = null;
	const provider = registerFakeAdapter(async ({ prompts }) => {
		captured = prompts;
		return { text: "ok" };
	});

	await askAgent({
		provider: { ...provider, systemPrompt: "SYSTEM ALIAS" },
		messages: "hola",
	});

	assert.ok(captured.some((m) => m.role === "system" && m.content === "SYSTEM ALIAS"));
});

test("presets: getModelConfig expone system en el provider", () => {
	const config = getModelConfig("qwen2.5-coder:3b", "code", { maxTokens: 128 });
	assert.equal(config.provider, "ollama");
	assert.equal(config.model, "qwen2.5-coder:3b");
	assert.equal(config.maxTokens, 128);
	assert.match(config.system, /programador experto/i);
});

test("response-cleaner: extractCodeBlock no filtra estado entre llamadas", () => {
	const first = "Aqui:\n```python\nprint(1)\n```\nfin";
	const second = "Otro:\n```javascript\nconst x = 2;\n```\nfinal";

	assert.equal(extractCodeBlock(first), "print(1)");
	assert.equal(extractCodeBlock(second), "const x = 2;");
	assert.equal(extractCodeBlock(first), "print(1)");
});

test("response-cleaner: extractCodeBlocks devuelve todos los bloques", () => {
	const blocks = extractCodeBlocks("```html\n<h1>x</h1>\n```\n```css\nbody{}\n```");
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].language, "html");
	assert.equal(blocks[1].language, "css");
});

test("askAgent: no elimina markdown en chat por defecto", async () => {
	const answer = "React es una librería. Ejemplo:\n```js\nconst x = 1;\n```\nEs muy usada.";
	const provider = registerFakeAdapter(async () => ({ text: answer }));

	const result = await askAgent({
		provider,
		messages: "¿qué es React?",
	});

	assert.equal(result.text, answer);
});

test("askAgent: responseProcessing=true extrae código cuando se pide", async () => {
	const answer = "Aquí tienes:\n```js\nconst x = 1;\n```";
	const provider = registerFakeAdapter(async () => ({ text: answer }));

	const result = await askAgent({
		provider,
		messages: "dame código JS",
		responseProcessing: true,
	});

	assert.equal(result.text, "const x = 1;");
});

test("ia: no envía top_k, repeat_penalty ni options por el endpoint OpenAI-compatible", () => {
	const config = {
		provider: "ollama",
		model: "qwen2.5-coder:3b",
		baseUrl: "http://127.0.0.1:11434",
		top_k: 17,
		repeat_penalty: 1.4,
		num_ctx: 2048,
	};
	const adapter = createAIProviderAdapter(config);
	const request = adapter.buildCompletionRequest([{ role: "user", content: "hola" }], []);

	assert.equal("top_k" in request, false);
	assert.equal("repeat_penalty" in request, false);
	assert.equal("options" in request, false);
	assert.equal(request.top_p >= 0, true);
});

test("ia: parámetros nativos solo se envían con opt-in explícito", () => {
	const config = {
		provider: "ollama",
		model: "qwen2.5-coder:3b",
		baseUrl: "http://127.0.0.1:11434",
		top_k: 17,
		repeat_penalty: 1.4,
		num_ctx: 2048,
		sendNativeProviderParams: true,
	};
	const adapter = createAIProviderAdapter(config);
	const request = adapter.buildCompletionRequest([{ role: "user", content: "hola" }], []);

	assert.equal(request.top_k, 17);
	assert.equal(request.repeat_penalty, 1.4);
	assert.deepEqual(request.options, { num_ctx: 2048 });
});

test("askAgent: autoCompact reduce mensajes antes de llamar al proveedor", async () => {
	let captured = null;
	const provider = registerFakeAdapter(async ({ prompts }) => {
		captured = prompts;
		return { text: "resumen" };
	});

	const history = Array.from({ length: 20 }, (_, index) => ({
		role: index % 2 === 0 ? "user" : "assistant",
		content: `mensaje ${index}`.repeat(20),
	}));

	const result = await askAgent({
		provider: { ...provider, contextLength: 200 },
		messages: history,
		autoCompact: true,
		compactionThresholdPercent: 25,
		compactionKeepLastMessages: 2,
		compactionStrategy: "truncate",
		includeDiagnostics: true,
	});

	assert.equal(result.compaction.triggered, true);
	assert.ok(result.compaction.after < result.compaction.before);
	const sentNonSystem = captured.filter((m) => m.role !== "system");
	assert.ok(sentNonSystem.length <= 3);
});

test("enhancedAskAgent: idiomaSystemPrompt cambia el system prompt", async () => {
	const capturedByLanguage = {};
	for (const idioma of ["en", "es"]) {
		const provider = registerFakeAdapter(async ({ prompts }) => {
			capturedByLanguage[idioma] = prompts.find((m) => m.role === "system")?.content || "";
			return { text: "// x\nfunction f(){ return 1; }" };
		});
		await enhancedAskAgent({
			provider,
			messages: [{ role: "user", content: "genera código" }],
			taskType: "code",
			lenguaje: "javascript",
			idiomaSystemPrompt: idioma,
		});
	}

	assert.match(capturedByLanguage.en, /STRICT RULES/);
	assert.match(capturedByLanguage.es, /REGLAS ESTRICTAS/);
});

test("enhancedAskAgent: autoCorrect reintenta cuando la validación falla", async () => {
	let calls = 0;
	const provider = registerFakeAdapter(async () => {
		calls += 1;
		if (calls === 1) return { text: "const x = 1;" };
		return { text: "// comentario\nfunction sumar(a, b) { return a + b; }" };
	});

	const result = await enhancedAskAgent({
		provider,
		messages: [{ role: "user", content: "genera una función" }],
		taskType: "code",
		lenguaje: "javascript",
		autoCorrect: true,
		maxCorrectionAttempts: 1,
	});

	assert.equal(result.intentos, 2);
	assert.match(result.text, /function sumar/);
	assert.ok(result.mejorasAplicadas.some((item) => item.startsWith("correccion_")));
});

test("syntax-validator: valida JavaScript real", async () => {
	const valid = await validateSyntax("const x = 1; console.log(x);", "javascript");
	const invalid = await validateSyntax("const x = ;", "javascript");

	assert.equal(valid.valid, true);
	assert.equal(invalid.valid, false);
	assert.ok(invalid.error);
});

test(
	"syntax-validator: valida Python real cuando python3 está disponible",
	{ skip: !python3Available },
	async () => {
		const valid = await validateSyntax("def sumar(a, b):\n    return a + b\n", "python");
		const invalid = await validateSyntax("def sumar(a, b)\n    return a + b\n", "python");

		assert.equal(valid.supported, true);
		assert.equal(valid.valid, true);
		assert.equal(invalid.valid, false);
		assert.ok(invalid.error);
	},
);

test("response-cache: devuelve el mismo valor y expone estadísticas", () => {
	const cache = new ResponseCache({ maxEntries: 2, ttlMs: 1000 });
	const key = "test-key";
	cache.set(key, { text: "hola" });

	assert.deepEqual(cache.get(key), { text: "hola" });
	assert.equal(cache.stats().hits, 1);
	assert.equal(cache.stats().size, 1);
});

test("adaptive-timeout: crece con observaciones y respeta límites", () => {
	const base = suggestTimeoutMs({ maxTokens: 100, tokensPerSecond: 10, minMs: 5000, maxMs: 60000 });
	const slow = suggestTimeoutMs({ observedMs: 20000, maxTokens: 100, tokensPerSecond: 10, minMs: 5000, maxMs: 60000 });
	const capped = suggestTimeoutMs({ observedMs: 200000, maxTokens: 100, tokensPerSecond: 10, minMs: 5000, maxMs: 60000 });

	assert.ok(slow > base);
	assert.equal(capped, 60000);
});

test("model-registry: recomienda modelos según entorno y tarea", () => {
	const webLocal = recommendModel({ taskType: "web", environment: "local" });
	const codeRemote = recommendModel({ taskType: "code", environment: "remote" });

	assert.equal(webLocal.model, "lfm3-omni:2b");
	assert.equal(codeRemote.model, "qwen2.5-coder:3b");
});

test("response-cleaner: extrae el bloque del idioma pedido aunque haya otros antes", () => {
	const respuesta = [
		"```html\n<h1>hola</h1>\n```",
		"```css\nbody { color: red; }\n```",
		"```js\nconst x = 1;\n```",
	].join("\n");

	assert.equal(extractCodeBlock(respuesta, "javascript"), "const x = 1;");
	assert.equal(extractCodeBlock(respuesta, "js"), "const x = 1;");
	assert.equal(extractCodeBlock(respuesta, "html"), "<h1>hola</h1>");
	assert.equal(extractCodeBlock("```js\nconst y = 2;\n```", "javascript"), "const y = 2;");
});

test("response-cleaner: un comentario que empieza con 'No puedo' no es rechazo", () => {
	const codigo = "// No puedo creer que esto funcione\nconst x = 1;";
	assert.equal(detectRefusal(codigo, "js").refused, false);
	assert.equal(detectRefusal("No puedo generar el código", "js").refused, true);
});

test("system-prompts: alias js/html/css usan el prompt de code/web", () => {
	assert.match(getSystemPrompt("js", "en"), /expert programmer/);
	assert.match(getSystemPrompt("html", "en"), /web developer/);
	assert.match(getSystemPrompt("css", "es"), /desarrollador web experto/);
});

test("task-enhancer: conserva un system existente y añade reglas y few-shot sin duplicar", () => {
	const mensajes = [
		{ role: "system", content: "REGLAS PROPIAS DEL LLAMADOR" },
		{ role: "user", content: "genera código" },
	];
	const enriquecidos = enriquecerMensajes(mensajes, "code", "javascript", "en");
	const systems = enriquecidos.filter((m) => m.role === "system");

	assert.equal(systems.length, 1);
	assert.match(systems[0].content, /REGLAS PROPIAS DEL LLAMADOR/);
	assert.match(systems[0].content, /STRICT RULES/);
	assert.match(systems[0].content, /EJEMPLO DE SALIDA ESPERADA/);
	assert.deepEqual(mensajes[0], { role: "system", content: "REGLAS PROPIAS DEL LLAMADOR" });
});

test("enhancedAskAgent: descarta un reintento que empeora la puntuación", async () => {
	let calls = 0;
	const provider = registerFakeAdapter(async () => {
		calls += 1;
		if (calls === 1) return { text: "// TODO: implementar\nfunction sumar(a, b) { return a + b; }" };
		return { text: "const x = 1;" };
	});

	const result = await enhancedAskAgent({
		provider: { ...provider, temperature: 0.8, seed: 42 },
		messages: [{ role: "user", content: "genera una función" }],
		taskType: "code",
		lenguaje: "javascript",
		autoCorrect: true,
		umbralPuntuacion: 100,
		maxCorrectionAttempts: 1,
	});

	assert.equal(result.intentos, 2);
	assert.match(result.text, /function sumar/);
	assert.ok(result.mejorasAplicadas.some((item) => item.startsWith("reintento_descartado")));
});

test("enhancedAskAgent: el reintento baja temperatura y elimina la semilla fija", async () => {
	let llamadas = 0;
	let configuracionRetry = null;
	const provider = registerFakeAdapter(
		async () => {
			llamadas += 1;
			if (llamadas === 1) return { text: "const x = 1;" };
			return { text: "// ok\nfunction sumar(a, b) { return a + b; }" };
		},
		(config) => {
			if (llamadas >= 1) configuracionRetry = config;
		},
	);

	await enhancedAskAgent({
		provider: { ...provider, temperature: 0.8, seed: 123 },
		messages: [{ role: "user", content: "genera una función" }],
		taskType: "code",
		lenguaje: "javascript",
		autoCorrect: true,
		maxCorrectionAttempts: 1,
	});

	assert.equal(configuracionRetry.temperature, 0.4);
	assert.equal("seed" in configuracionRetry, false);
});

test("system-prompts: detecta el idioma del prompt sin forzar un cambio", () => {
	assert.equal(detectPromptLanguage("Escribe una función isValidEmail en JavaScript. Devuelve solo el código."), "es");
	assert.equal(detectPromptLanguage("Create a responsive landing page. Return only the code."), "en");
	assert.equal(detectPromptLanguage(""), null);
});

test("enhancedAskAgent: idioma 'auto' usa español con prompts en español", async () => {
	let systemEnviado = "";
	const provider = registerFakeAdapter(async ({ prompts }) => {
		systemEnviado = prompts.find((m) => m.role === "system")?.content || "";
		return { text: "// ok\nfunction sumar(a, b) { return a + b; }" };
	});

	const resultado = await enhancedAskAgent({
		provider,
		messages: [{ role: "user", content: "Escribe una función en JavaScript" }],
		taskType: "code",
		lenguaje: "javascript",
	});

	assert.match(systemEnviado, /REGLAS ESTRICTAS/);
	assert.equal(resultado.diagnosticos.idiomaEfectivo, "es");
});

test("enhancedAskAgent: la validación funcional dispara y reporta el reintento", async () => {
	let llamada = 0;
	const provider = registerFakeAdapter(async () => {
		llamada += 1;
		return llamada === 1
			? { text: "function isValidEmail(){ return true; }" }
			: { text: "function isValidEmail(email){ return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email); }" };
	});
	const puntuaciones = [];
	const validarComportamiento = ({ texto }) => {
		const puntuacion = texto.includes("return true;") ? 17 : 100;
		puntuaciones.push(puntuacion);
		return {
			soportado: true,
			ok: puntuacion === 100,
			puntuacion,
			casos: puntuacion === 100
				? []
				: [{ name: "email_invalido", passed: false, detail: "devolvió true" }],
		};
	};

	const resultado = await enhancedAskAgent({
		provider,
		messages: [{ role: "user", content: "Escribe isValidEmail en JavaScript" }],
		taskType: "code",
		lenguaje: "javascript",
		autoCorrect: true,
		maxCorrectionAttempts: 1,
		validarComportamiento,
	});

	assert.equal(resultado.intentos, 2);
	assert.deepEqual(puntuaciones, [17, 100]);
	assert.equal(resultado.comportamiento.puntuacion, 100);
	assert.ok(resultado.mejorasAplicadas.some((item) => item.startsWith("correccion_")));
});

test("enhancedAskAgent: el retry conserva un resumen de las herramientas ejecutadas", async () => {
	let llamada = 0;
	let promptsRetry = null;
	const provider = registerFakeAdapter(async ({ prompts }) => {
		llamada += 1;
		if (llamada === 1) {
			return {
				text: "const x = 1;",
				toolExecutions: [{ toolName: "web_search", isError: false, textResult: '{"ok":true,"results":[{"title":"Fuente"}]}' }],
				webResults: [{ title: "Fuente", url: "https://ejemplo.test", snippet: "texto de prueba" }],
			};
		}
		promptsRetry = prompts;
		return { text: "// ok\nfunction sumar(a, b) { return a + b; }" };
	});

	await enhancedAskAgent({
		provider,
		messages: [{ role: "user", content: "genera una función" }],
		taskType: "code",
		lenguaje: "javascript",
		autoCorrect: true,
		maxCorrectionAttempts: 1,
	});

	const contenido = (promptsRetry || [])
		.filter((mensaje) => mensaje.role === "user")
		.map((mensaje) => mensaje.content)
		.join("\n");
	assert.match(contenido, /CONTEXTO DE HERRAMIENTAS YA EJECUTADAS/);
	assert.match(contenido, /HERRAMIENTA web_search/);
	assert.match(contenido, /WEB: Fuente/);
});

test("tool-arguments: desenvuelve envoltorios anidados del schema", () => {
	const normalizado = normalizeToolArguments({
		query: { type: "string", description: "consulta", value: { type: "string", value: "clima Quito" } },
		opciones: [{ label: "Sí", value: "yes" }],
		numero: 7,
	});

	assert.equal(normalizado.query, "clima Quito");
	assert.deepEqual(normalizado.opciones, [{ label: "Sí", value: "yes" }]);
	assert.equal(normalizado.numero, 7);
});

test("response-cache: la clave ignora secretos y distingue parámetros de calidad", () => {
	const opciones = {
		provider: { provider: "ollama", model: "fake", apiKey: "super-secreto" },
		messages: [{ role: "user", content: "hola" }],
		umbralPuntuacion: 70,
	};
	const clave = createCacheKey(opciones);

	assert.equal(clave.includes("super-secreto"), false);
	assert.notEqual(clave, createCacheKey({ ...opciones, umbralPuntuacion: 90 }));
	assert.notEqual(clave, createCacheKey({ ...opciones, validarSintaxis: true }));
});

test("response-cache: la clave distingue el hook de validación funcional", () => {
	function validarEmail() {}
	const opciones = {
		messages: [{ role: "user", content: "hola" }],
		validarComportamiento: validarEmail,
		validarComportamientoId: "email-v1",
	};
	const clave = createCacheKey(opciones);

	assert.equal(clave.includes("validarEmail"), false);
	assert.notEqual(clave, createCacheKey({ ...opciones, validarComportamientoId: "email-v2" }));
});

test("e2e-helpers: detecta bloques faltantes y fusiona respuestas parciales", () => {
	const parcial = "```html\n<!DOCTYPE html><html><body></body></html>\n```\n```css\nbody{color:red}\n```";
	const faltantes = missingBlockLanguages(parcial, { embedded: {} });
	const fusionados = mergeBlocks(parcial, "```js\ndocument.addEventListener('DOMContentLoaded', () => {});\n```");

	assert.deepEqual(faltantes, ["js"]);
	assert.ok(fusionados.html);
	assert.ok(fusionados.css);
	assert.match(fusionados.js, /DOMContentLoaded/);
});

test("e2e-helpers: alias de bloques se agrupan bajo claves canónicas", () => {
	const respuesta = [
		"```html\n<!DOCTYPE html><html></html>\n```",
		"```css\nbody { color: red; }\n```",
		"```js\nconst x = 1;\n```",
	].join("\n");

	assert.equal(normalizeBlockKey("javascript"), "js");
	assert.equal(normalizeBlockKey("htm"), "html");
	assert.deepEqual(Object.keys(blocksByLanguage(respuesta)), ["html", "css", "js"]);
	assert.equal(firstBlock(respuesta, "js"), "const x = 1;");
	assert.equal(firstBlock(respuesta, "javascript"), "const x = 1;");
	assert.equal(sanitizeToolName("Get-Local.IP"), "get_local_ip");
});

test("code-behavior: ejecuta isValidEmail contra casos reales", () => {
	const correcto = String.raw`function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}`;
	const bueno = validateEmailBehavior(correcto);
	assert.equal(bueno.soportado, true);
	assert.equal(bueno.ok, true);
	assert.equal(bueno.puntuacion, 100);

	const malo = validateEmailBehavior("function isValidEmail(email) { return true; }");
	assert.equal(malo.ok, false);
	assert.equal(malo.puntuacion < 100, true);
	assert.equal(malo.casos.some((caso) => caso.name === "sin_arroba" && !caso.passed), true);
});

test("code-behavior: ejecuta leer_archivo con archivo existente y ausente", () => {
	const correcto = `def leer_archivo(ruta):
    try:
        with open(ruta, encoding="utf-8") as archivo:
            return archivo.read()
    except Exception as error:
        return "Error: " + str(error)
`;
	const bueno = validateReadFileBehavior(correcto);
	assert.equal(bueno.ok, true, JSON.stringify(bueno.casos));
	assert.equal(bueno.puntuacion, 100);

	const malo = validateReadFileBehavior("def leer_archivo(ruta):\n    return open(ruta).read()\n");
	assert.equal(malo.ok, false);
	assert.equal(malo.casos.some((caso) => caso.name === "archivo_ausente" && !caso.passed), true);
});

test("code-behavior: detecta JS que no engancha con el HTML generado", () => {
	const html = '<form id="formulario"><input id="nombre"></form><link href="style.css"><script src="script.js"></script>';
	const js = "document.getElementById('otro_id'); addEventListener('submit', function (e) { e.preventDefault(); });";
	const resultado = validateLandingWiring({ html, css: "body { color: red; }", js });
	assert.equal(resultado.ok, false);
	assert.equal(resultado.casos.find((caso) => caso.name === "ids_coinciden").passed, false);
	assert.match(resultado.casos.find((caso) => caso.name === "ids_coinciden").detail, /otro_id/);
});

test("multi-file: quita envoltorios <style>/<script> del CSS/JS generado", () => {
	assert.equal(stripWrapperTags("css", "<style>\nbody { color: red; }\n</style>"), "body { color: red; }");
	assert.equal(stripWrapperTags("javascript", "<script>\nconst x = 1;\n</script>"), "const x = 1;");
	assert.equal(stripWrapperTags("css", "body { color: red; }"), "body { color: red; }");
});

test("multi-file: divide la landing en tres llamadas y reúne los bloques", async () => {
	const prompts = [];
	const provider = registerFakeAdapter(async ({ prompts: mensajes } = {}) => {
		prompts.push(mensajes);
		const ultimo = mensajes[mensajes.length - 1]?.content || "";
		if (ultimo.includes("index.html")) return { text: "<!DOCTYPE html><html></html>" };
		if (ultimo.includes("style.css")) return { text: "body { color: red; }" };
		return { text: "addEventListener('click', () => {});" };
	});

	const resultado = await generateMultiFile({
		provider,
		brief: "Landing para una clínica veterinaria",
	});

	assert.equal(resultado.ok, true);
	assert.deepEqual(Object.keys(resultado.archivos), ["html", "css", "js"]);
	assert.equal(prompts.length, 3);
	assert.match(prompts[0][prompts[0].length - 1].content, /ÚNICAMENTE el contenido del archivo index\.html/);
	assert.match(resultado.texto, /```html/);
	assert.match(resultado.texto, /```css/);
	assert.match(resultado.texto, /```javascript/);
});

test("multi-file: parallel=true solapa llamadas con tope de concurrencia", async () => {
	const files = ["a", "b", "c", "d"].map((key) => ({
		key,
		language: "javascript",
		instruction: `archivo ${key}`,
	}));
	let activas = 0;
	let maxActivas = 0;
	const ask = async ({ messages }) => {
		activas += 1;
		maxActivas = Math.max(maxActivas, activas);
		await new Promise((resolve) => setTimeout(resolve, 5));
		activas -= 1;
		return { text: `const x = ${messages[0].content.length};` };
	};

	await generateMultiFile({ provider: { provider: "fake" }, brief: "prueba", files, ask });
	assert.equal(maxActivas, 1);

	maxActivas = 0;
	const paralelo = await generateMultiFile({
		provider: { provider: "fake" },
		brief: "prueba",
		files,
		parallel: true,
		concurrency: 2,
		ask,
	});
	assert.equal(maxActivas, 2);
	assert.equal(paralelo.ok, true);
	assert.deepEqual(Object.keys(paralelo.archivos), ["a", "b", "c", "d"]);
});

test("policies: preSearch respeta la capacidad web del host", () => {
	const prompt = "Busca en internet la capital de Ecuador";

	assert.equal(shouldRunPreSearch({ preSearch: "auto", lastUserText: prompt }), true);
	assert.equal(shouldRunPreSearch({ preSearch: "auto", lastUserText: prompt, webAllowed: false }), false);
	assert.equal(shouldRunPreSearch({ preSearch: "always", lastUserText: prompt, webAllowed: false }), false);
	assert.equal(shouldRunPreSearch({ preSearch: false, lastUserText: prompt }), false);
});

test("askAgent: capabilities.mcp={enabled:false} evita conectar servidores", async () => {
	const provider = registerFakeAdapter(async () => ({ text: "ok" }));
	const resultado = await askAgent({
		provider,
		messages: [{ role: "user", content: "hola" }],
		capabilities: { mcp: { enabled: false } },
		mcpServers: [{ name: "bogus", transport: "stdio", command: "no-existe-este-binario" }],
	});

	assert.equal(resultado.text, "ok");
});

test("ia: normaliza argumentos de tool con envoltorio de schema", async () => {
	let ejecucion = null;
	const provider = registerFakeAdapter(async ({ runtime }) => {
		ejecucion = await runtime.executeToolCalls([{
			name: "eco",
			arguments: {
				texto: {
					type: "string",
					description: "Texto a repetir",
					value: "hola herramienta",
				},
			},
		}]);
		return { text: "listo" };
	});

	await askAgent({
		provider,
		messages: [{ role: "user", content: "prueba" }],
		tools: { eco: true },
		toolHandlers: {
			eco: {
				description: "Repite el texto recibido.",
				inputSchema: {
					type: "object",
					properties: { texto: { type: "string" } },
					required: ["texto"],
				},
				handler: async (args) => ({ ok: true, texto: args.texto }),
			},
		},
	});

	assert.equal(ejecucion?.[0]?.isError, false);
	assert.equal(ejecucion?.[0]?.rawResult?.texto, "hola herramienta");
});

test("ia: ollama-native usa /api/chat con num_ctx real y ejecuta tools", async () => {
	const solicitudes = [];
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => { raw += chunk; });
		req.on("end", () => {
			const cuerpo = JSON.parse(raw);
			solicitudes.push({ url: req.url, cuerpo });
			const respuesta = solicitudes.length === 1
				? {
					model: "fake",
					message: {
						role: "assistant",
						content: "",
						tool_calls: [{ function: { name: "eco", arguments: { texto: "hola" } } }],
					},
					prompt_eval_count: 10,
					eval_count: 2,
				}
				: {
					model: "fake",
					message: { role: "assistant", content: "La capital es Quito" },
					prompt_eval_count: 12,
					eval_count: 3,
				};
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(respuesta));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();

	try {
		const resultado = await askAgent({
			provider: {
				provider: "ollama-native",
				model: "fake",
				baseUrl: `http://127.0.0.1:${port}`,
				num_ctx: 4096,
				top_k: 17,
				repeat_penalty: 1.2,
				temperature: 0.2,
				maxTokens: 100,
				responseTimeout: 10000,
			},
			messages: [{ role: "user", content: "di hola" }],
			tools: { eco: true },
			toolHandlers: {
				eco: {
					description: "Repite el texto recibido.",
					inputSchema: { type: "object", properties: { texto: { type: "string" } } },
					handler: async (args) => ({ ok: true, texto: args.texto }),
				},
			},
			preSearch: false,
			capabilities: { web: false, mcp: false },
		});

		assert.match(resultado.text, /Quito/);
		assert.equal(solicitudes.length, 2);
		assert.equal(solicitudes[0].url, "/api/chat");
		assert.equal(solicitudes[0].cuerpo.options.num_ctx, 4096);
		assert.equal(solicitudes[0].cuerpo.options.top_k, 17);
		assert.equal(solicitudes[0].cuerpo.options.repeat_penalty, 1.2);
		assert.equal(solicitudes[0].cuerpo.options.num_predict, 100);
		assert.equal(solicitudes[1].cuerpo.messages.some((mensaje) => mensaje.role === "tool"), true);
		assert.equal(solicitudes[1].cuerpo.messages.some((mensaje) => mensaje.tool_name === "eco"), true);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
