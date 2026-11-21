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
  detectarTruncamiento,
  repararRespuesta,
  fenceBalance as fenceBalanceRespuesta,
} from "../src/utils/response-repair.js";
import {
  blockForPath,
  blockTagForPath,
  blocksByLanguage,
  blocksByPath,
  fenceBalance,
  firstBlock,
  mergeBlocks,
  mergePathBlocks,
  missingBlockLanguages,
  missingBlockPaths,
  MULTIPAGE_BLOCKS,
  normalizeBlockKey,
  sanitizeToolName,
} from "./utils/e2e-helpers.js";
import {
  validateEmailBehavior,
  validateReadFileBehavior,
  validateLandingWiring,
  validateMultiPage,
} from "./utils/code-behavior.js";

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

const MULTIPAGE_RESPUESTA = [
  '```html-index',
  '<!-- index.html -->',
  '<!DOCTYPE html><html><body data-page="index">inicio</body></html>',
  '```',
  '```html-servicios',
  '<!-- servicios.html -->',
  '<!DOCTYPE html><html><body data-page="servicios">servicios</body></html>',
  '```',
  '```html-precios',
  '<!-- precios.html -->',
  '<!DOCTYPE html><html><body data-page="precios">precios</body></html>',
  '```',
  '```html-contacto',
  '<!-- contacto.html -->',
  '<!DOCTYPE html><html><body data-page="contacto">contacto</body></html>',
  '```',
  '```css',
  '/* style.css */',
  ':root { --tinta: #1B1A17; }',
  '```',
  '```js',
  '// script.js',
  " document.querySelector('[data-nav-toggle]');",
  '```',
].join("\n");

test("e2e-helpers: blocksByPath conserva las cuatro páginas y limpia el comentario", () => {
  const bloques = blocksByPath(MULTIPAGE_RESPUESTA);
  assert.deepEqual(Object.keys(bloques), Object.values(MULTIPAGE_BLOCKS));
  assert.match(bloques["index.html"], /^<!DOCTYPE html>/);
  assert.doesNotMatch(bloques["index.html"], /<!-- index.html -->/);
  assert.equal(blockTagForPath("precios.html"), "html-precios");
  assert.equal(blockTagForPath("script.js"), "js");
});

test("e2e-helpers: blockForPath rechaza fences sin cerrar y acepta etiquetas genéricas", () => {
  assert.equal(fenceBalance("```html-index\nabierto"), 1);
  assert.equal(fenceBalance("```html-index\ncerrado\n```"), 2);
  const truncado = "```html-index\n<!-- index.html -->\n<!DOCTYPE html><html></html>";
  assert.deepEqual(blockForPath(truncado, "index.html"), { code: null, completo: false, fuente: null });
  const generico = "```html\n<!DOCTYPE html><html><body>x</body></html>\n```";
  const extraido = blockForPath(generico, "index.html");
  assert.equal(extraido.completo, true);
  assert.equal(extraido.fuente, "tipo");
  assert.match(extraido.code, /^<!DOCTYPE html>/);
});

test("e2e-helpers: missingBlockPaths y mergePathBlocks reparan bloques sueltos", () => {
  assert.deepEqual(missingBlockPaths(MULTIPAGE_RESPUESTA), []);
  const incompleto = MULTIPAGE_RESPUESTA.split("```js")[0];
  assert.deepEqual(missingBlockPaths(incompleto), ["script.js"]);
  const reparado = mergePathBlocks(incompleto, '```js\n// script.js\nconst theme = 1;\n```');
  assert.match(reparado["script.js"], /const theme = 1/);
  assert.equal(Object.keys(reparado).length, 6);
});

const paginaMultipagina = (nombre) => [
  "<!DOCTYPE html>",
  '<html lang="es"><head><meta charset="utf-8"><title>Clínica ' + nombre + "</title>",
  '<link rel="stylesheet" href="style.css"></head>',
  '<body data-page="' + nombre + '">',
  '<header><nav><a href="index.html">Inicio</a></nav></header>',
  '<main><h1>' + nombre + '</h1><svg stroke="currentColor" aria-hidden="true"></svg></main>',
  '<footer><script src="script.js"></script></footer>',
  "</body></html>",
].join("\n");

const cssMultipagina = [
  ":root { --tinta: #1B1A17; --crema: #F4EFE6; --terracota: #C65D3B; --salvia: #6F8F6A; }",
  "*, *::before, *::after { box-sizing: border-box; }",
  "@keyframes marquesina { from { transform: translateX(0); } to { transform: translateX(-50%); } }",
  "@keyframes reveal { from { opacity: 0; } to { opacity: 1; } }",
  ".titular { font-size: clamp(2.5rem, 5vw, 6rem); }",
  "@media (max-width: 800px) { body { padding: 1rem; } }",
  "@media (min-width: 1200px) { body { padding: 2rem; } }",
  "@media (prefers-reduced-motion: reduce) { * { animation: none; } }",
  ":focus-visible { outline: 2px solid var(--terracota); }",
].join("\n");

const jsMultipagina = [
  "document.addEventListener('DOMContentLoaded', function () {",
  "  var nav = document.querySelector('[data-nav-toggle]');",
  "  nav.addEventListener('click', function () {",
  "    nav.setAttribute('aria-expanded', nav.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');",
  "  });",
  "  var theme = document.querySelector('[data-theme-toggle]');",
  "  theme.addEventListener('click', function () {",
  "    var next = document.documentElement.dataset.theme === 'oscuro' ? 'claro' : 'oscuro';",
  "    document.documentElement.dataset.theme = next;",
  "    localStorage.setItem('theme', next);",
  "  });",
  "  var faq = document.querySelector('[data-faq-toggle]');",
  "  faq.addEventListener('click', function () {",
  "    faq.setAttribute('aria-expanded', faq.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');",
  "  });",
  "  var precios = [].concat(",
  "    [].slice.call(document.querySelectorAll('[data-mensual]')),",
  "    [].slice.call(document.querySelectorAll('[data-anual]'))",
  "  );",
  "  document.querySelector('[data-price-toggle]').addEventListener('click', function () {",
  "    precios.forEach(function (item) { item.textContent = 'Oferta ' + item.textContent; });",
  "  });",
  "  var form = document.querySelector('form');",
  "  var exito = document.querySelector('[data-form-exito]');",
  "  form.addEventListener('submit', function (event) {",
  "    event.preventDefault();",
  "    var fields = [].slice.call(document.querySelectorAll('input[name], textarea[name]'));",
  "    var invalid = fields.filter(function (field) { return !String(field.value || '').trim(); });",
  "    if (invalid.length) {",
  "      invalid.forEach(function (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); });",
  "      return;",
  "    }",
  "    exito.textContent = 'Gracias, te contactaremos pronto.';",
  "  });",
  "  var observer = new IntersectionObserver(function (entries) {",
  "    entries.forEach(function (entry) { entry.target.setAttribute('data-visible', 'true'); });",
  "  });",
  "  document.querySelectorAll('[data-reveal]').forEach(function (item) { observer.observe(item); });",
  "  var progress = document.querySelector('[data-scroll-progress]');",
  "  window.addEventListener('scroll', function () { progress.style.width = '25%'; });",
  "});",
].join("\n");

test("code-behavior: validateMultiPage aprueba diseño, hooks e interacciones simuladas", () => {
  const resultado = validateMultiPage({
    pages: {
      "index.html": paginaMultipagina("index"),
      "servicios.html": paginaMultipagina("servicios"),
      "precios.html": paginaMultipagina("precios"),
      "contacto.html": paginaMultipagina("contacto"),
    },
    css: cssMultipagina,
    js: jsMultipagina,
  });

  const porNombre = Object.fromEntries(resultado.casos.map((caso) => [caso.name, caso]));
  for (const nombre of [
    "paginas_entregadas", "links_resueltos", "data_page_por_pagina", "js_hooks_testeables",
    "nav_toggle", "theme_toggle", "faq_toggle", "price_toggle",
    "formulario_rechaza_invalido", "formulario_acepta_valido", "reveal_observer",
    "scroll_progress", "no_gradient_generico",
  ]) {
    assert.equal(porNombre[nombre]?.passed, true, `falló ${nombre}: ${porNombre[nombre]?.detail}`);
  }
  assert.ok(resultado.puntuacion >= 85, `puntuación ${resultado.puntuacion}`);
  assert.ok(resultado.originalidad.puntuacion >= 80);
  assert.equal(resultado.paginas, 4);
});

test("code-behavior: el stub acepta hooks con selector, classList y alert", () => {
  const js = [
    "document.addEventListener('DOMContentLoaded', function () {",
    "  document.querySelectorAll('[data-nav-toggle]').forEach(function (boton) {",
    "    boton.addEventListener('click', function () {",
    "      var destino = document.querySelector(boton.getAttribute('data-nav-toggle'));",
    "      if (destino) destino.classList.toggle('active');",
    "    });",
    "  });",
    "  document.querySelector('form').addEventListener('submit', function (event) {",
    "    event.preventDefault();",
    "    if (!document.getElementById('name').value) {",
    "      alert('Por favor complete todos los campos.');",
    "      return;",
    "    }",
    "    alert('Gracias, formulario enviado correctamente.');",
    "  });",
    "});",
  ].join("\n");

  const resultado = validateMultiPage({
    pages: { "index.html": paginaMultipagina("index") },
    css: cssMultipagina,
    js,
  });
  const porNombre = Object.fromEntries(resultado.casos.map((caso) => [caso.name, caso]));
  assert.equal(porNombre.nav_toggle.passed, true, porNombre.nav_toggle.detail);
  assert.equal(porNombre.formulario_rechaza_invalido.passed, true, porNombre.formulario_rechaza_invalido.detail);
  assert.equal(porNombre.formulario_acepta_valido.passed, true, porNombre.formulario_acepta_valido.detail);
});

test("code-behavior: el stub soporta nextElementSibling, classList propio y FormData", () => {
  const js = [
    "document.addEventListener('DOMContentLoaded', function () {",
    "  document.querySelectorAll('[data-nav-toggle]').forEach(function (boton) {",
    "    boton.addEventListener('click', function () { this.classList.toggle('active'); });",
    "  });",
    "  document.querySelectorAll('[data-faq-toggle]').forEach(function (boton) {",
    "    boton.addEventListener('click', function () { this.nextElementSibling.classList.toggle('active'); });",
    "  });",
    "  document.querySelectorAll('[data-price-toggle]').forEach(function (boton) {",
    "    boton.addEventListener('click', function () { this.nextElementSibling.classList.toggle('active'); });",
    "  });",
    "  var exito = document.querySelector('[data-form-exito]');",
    "  document.querySelector('form').addEventListener('submit', function (event) {",
    "    event.preventDefault();",
    "    var datos = new FormData(this);",
    "    if (!datos.get('name') || !datos.get('email') || !datos.get('message')) {",
    "      alert('Por favor, complete todos los campos.');",
    "      return;",
    "    }",
    "    exito.style.display = 'block';",
    "  });",
    "});",
  ].join("\n");

  const resultado = validateMultiPage({
    pages: { "index.html": paginaMultipagina("index") },
    css: cssMultipagina,
    js,
  });
  const porNombre = Object.fromEntries(resultado.casos.map((caso) => [caso.name, caso]));
  for (const nombre of [
    "nav_toggle", "faq_toggle", "price_toggle",
    "formulario_rechaza_invalido", "formulario_acepta_valido",
  ]) {
    assert.equal(porNombre[nombre]?.passed, true, `falló ${nombre}: ${porNombre[nombre]?.detail}`);
  }
});

test("code-behavior: validateMultiPage detecta anti-patrones y JS que no reacciona", () => {
  const pagina = paginaMultipagina("index").replace("<h1>", "<h1>").concat("\n<p>Lorem ipsum</p>");
  const css = cssMultipagina.replace("--tinta: #1B1A17;", "#667eea;");
  const js = jsMultipagina.replace(/nav\.setAttribute\('aria-expanded'[^\n]+\n/, "");
  const resultado = validateMultiPage({
    pages: {
      "index.html": pagina,
      "servicios.html": paginaMultipagina("servicios"),
      "precios.html": paginaMultipagina("precios"),
      "contacto.html": paginaMultipagina("contacto"),
    },
    css,
    js,
  });
  const porNombre = Object.fromEntries(resultado.casos.map((caso) => [caso.name, caso]));
  assert.equal(porNombre.no_lorem_ipsum.passed, false);
  assert.equal(porNombre.no_gradient_generico.passed, false);
  assert.equal(porNombre.nav_toggle.passed, false);
});

test("response-repair: cierra un cerco sin cerrar y conserva la señal de truncamiento", () => {
  const crudo = "```js\nconst x = 1;";
  const reparado = repararRespuesta(crudo, { language: "javascript" });

  assert.equal(fenceBalanceRespuesta(reparado.text), 0);
  assert.equal(reparado.truncado, true);
  assert.ok(reparado.senales.includes("cerco_sin_cerrar"));
  assert.ok(reparado.reparaciones.includes("cerco_cerrado"));
});

test("response-repair: quita prólogo y envolvente sin tocar comentarios de código", () => {
  const conPrologo = repararRespuesta("Aquí tienes el archivo:\n```css\nbody { color: red; }\n```", { language: "css" });
  const conComentario = repararRespuesta("// generado\n```css\nbody { color: red; }\n```", { language: "css" });
  const conEnvolvente = repararRespuesta("<style>\nbody { color: red; }\n</style>", { language: "css" });

  assert.equal(conPrologo.text, "```css\nbody { color: red; }\n```");
  assert.ok(conPrologo.reparaciones.includes("prologo_eliminado"));
  assert.match(conComentario.text, /^\/\/ generado/);
  assert.equal(conEnvolvente.text, "body { color: red; }");
  assert.ok(conEnvolvente.reparaciones.includes("envolvente_eliminado"));
});

test("response-repair: recorta un bucle de repetición al final", () => {
  const crudo = [
    "const x = 1;",
    "console.log(x);",
    "}",
    "}",
    "}",
    "}",
    "}",
  ].join("\n");
  const reparado = repararRespuesta(crudo, { language: "javascript" });

  assert.ok(reparado.reparaciones.includes("repeticion_recortada"));
  assert.ok(reparado.senales.includes("bucle_repeticion"));
  assert.ok(!reparado.text.endsWith("}\n}\n}\n}"));
});

test("response-repair: no altera prosa de chat sin cercos", () => {
  const texto = "Hola, aquí tienes la explicación. Espero que sirva.";
  const reparado = repararRespuesta(texto);

  assert.equal(reparado.text, texto);
  assert.deepEqual(reparado.reparaciones, []);
  assert.equal(reparado.truncado, false);
});

test("askAgent: postProcess.repair repara la salida antes de devolverla", async () => {
  const provider = registerFakeAdapter(async () => ({ text: "Respuesta:\n```js\nconst x = 1;" }));
  const resultado = await askAgent({
    provider,
    messages: [{ role: "user", content: "genera código" }],
    postProcess: { repair: true },
    includeDiagnostics: true,
  });

  assert.equal(fenceBalanceRespuesta(resultado.text), 0);
  assert.ok(resultado.diagnostics.reparacionesAplicadas.includes("cerco_cerrado"));
  assert.ok(resultado.diagnostics.reparacionesAplicadas.includes("prologo_eliminado"));
});

test("system-prompts: el idioma de respuesta no queda fijo en inglés", () => {
  const en = getSystemPrompt("chat", "en", "en");
  const es = getSystemPrompt("chat", "es", "es");

  assert.match(en, /Respond in English/);
  assert.doesNotMatch(en, /Respond in Spanish|Responde en español/);
  assert.match(es, /Responde en español/);
  assert.doesNotMatch(es, /Respond in English/);
});

test("enhancedAskAgent: un truncamiento amplía maxTokens en el reintento", async () => {
  let llamadas = 0;
  let configuracionRetry = null;
  const provider = registerFakeAdapter(
    async () => {
      llamadas += 1;
      if (llamadas === 1) return { text: "```js\nconst x = 1;" };
      return { text: "// ok\nfunction sumar(a, b) { return a + b; }" };
    },
    (config) => {
      if (llamadas >= 1) configuracionRetry = config;
    },
  );

  await enhancedAskAgent({
    provider: { ...provider, temperature: 0.8, seed: 123, maxTokens: 100 },
    messages: [{ role: "user", content: "genera una función" }],
    taskType: "code",
    lenguaje: "javascript",
    autoCorrect: true,
    maxCorrectionAttempts: 1,
  });

  assert.equal(configuracionRetry.temperature, 0.4);
  assert.equal("seed" in configuracionRetry, false);
  assert.equal(configuracionRetry.maxTokens, 160);
});

test("response-repair: detecta identificadores repetidos sin reescribirlos", () => {
  const crudo = "function guardarDataScrollProgressToggleToggleToggleToggleToggle(scroll) {}";
  const reparado = repararRespuesta(crudo, { language: "javascript" });

  // Reescribir el nombre podría colisionar con otro símbolo del archivo.
  assert.match(reparado.text, /ProgressToggleToggleToggleToggleToggle\(scroll\)/);
  assert.ok(!reparado.reparaciones.includes("identificador_colapsado"));
  assert.ok(reparado.senales.includes("identificador_repetido"));
});

test("response-repair: recorta una declaración de función incompleta al final", () => {
  const crudo = [
    "function completa() { return 1; }",
    "function guardarScroll(scroll)",
  ].join("\n");
  const reparado = repararRespuesta(crudo, { language: "javascript" });

  assert.equal(reparado.text.trim(), "function completa() { return 1; }");
  assert.ok(reparado.reparaciones.includes("cola_incompleta_recortada"));
  assert.ok(reparado.senales.includes("declaracion_incompleta"));
});

test("response-repair: un corte con cerco abierto sigue señalando truncamiento tras reparar", () => {
  const crudo = [
    "```js",
    "function completa() { return 1; }",
    "function guardarScrollToggleToggleToggleToggleToggle(scroll)",
  ].join("\n");
  const reparado = repararRespuesta(crudo, { language: "web" });

  assert.equal(fenceBalanceRespuesta(reparado.text), 0);
  assert.equal(reparado.truncado, true);
  assert.ok(reparado.senales.includes("declaracion_incompleta"));
  assert.ok(reparado.senales.includes("identificador_repetido"));
});

test("response-repair: elimina bloques de función idénticos repetidos", () => {
  const bloque = "function f() {\n  return 1;\n}";
  const crudo = [bloque, "function g() {\n  return 2;\n}", bloque].join("\n\n");
  const reparado = repararRespuesta(crudo, { language: "javascript" });

  assert.equal((reparado.text.match(/function f\(/g) || []).length, 1);
  assert.match(reparado.text, /function g\(/);
  assert.ok(reparado.reparaciones.some((item) => item.startsWith("bloques_duplicados_eliminados")));
});

test("code-behavior: un JS que no ejecuta falla también todas las interacciones", () => {
  const resultado = validateMultiPage({
    pages: {
      "index.html": paginaMultipagina("index"),
      "servicios.html": paginaMultipagina("servicios"),
      "precios.html": paginaMultipagina("precios"),
      "contacto.html": paginaMultipagina("contacto"),
    },
    css: cssMultipagina,
    js: "function roto( {",
  });
  const porNombre = Object.fromEntries(resultado.casos.map((caso) => [caso.name, caso]));

  assert.equal(porNombre.ejecucion_js.passed, false);
  for (const nombre of ["dom_ready", "eventos_registrados", "nav_toggle", "formulario_acepta_valido"]) {
    assert.equal(porNombre[nombre]?.passed, false, `la interacción ${nombre} no se marcó como fallida`);
  }
});

test("response-repair: no toma prosa de chat aunque contenga un bloque de código", () => {
  const texto = "Claro, aquí va un ejemplo:\n```js\nconst x = 1;\n```\nEspero que ayude.";
  const reparado = repararRespuesta(texto, { language: "chat" });

  assert.equal(reparado.text, texto);
  assert.deepEqual(reparado.reparaciones, []);
});
