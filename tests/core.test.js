import { test } from "node:test";
import assert from "node:assert";
import {
	loadEffectiveConfig,
	defaultConfig,
	saveGlobalConfig,
	loadGlobalConfig,
	findProjectConfigPath,
	resolveSecretReference,
	resolveConfigSecrets,
} from "../src/config.js";
import {
	defaultCapabilitiesFor,
	capabilityEnabled,
	normalizeCapabilities,
	resolveToolCapability,
	applyCapabilitiesToToolHandlers,
	capabilityDeniedResult,
} from "../src/capabilities.js";
import {
	shouldAutoCompact,
	compactMessages,
} from "../src/compaction.js";
import { askAgent } from "../src/agent.js";
import {
	looksLikeRecall,
	looksLikeWebQuery,
	cleanWebQuery,
	checkGrounding,
	formatHistoryRecap,
} from "../src/policies.js";

test("config: defaultConfig returns valid structure", () => {
	const cfg = defaultConfig();
	assert.ok(cfg.provider);
	assert.equal(cfg.provider.provider, "ollama");
	assert.equal(cfg.language, "en");
	assert.ok(cfg.capabilities);
	assert.equal(cfg.capabilities.web, true);
	assert.equal(cfg.mode, "build");
});

test("config: loadEffectiveConfig returns merged config", async () => {
	const cfg = await loadEffectiveConfig({ cwd: process.cwd() });
	assert.ok(cfg.config);
	assert.ok(cfg.globalPath);
	assert.equal(typeof cfg.config.provider, "object");
});

test("config: resolveSecretReference resolves env vars", () => {
	process.env.TEST_SECRET_KEY = "my-secret-value";
	assert.equal(resolveSecretReference("env:TEST_SECRET_KEY"), "my-secret-value");
	assert.equal(resolveSecretReference("literal-value"), "literal-value");
	assert.equal(resolveSecretReference("env:NONEXISTENT_KEY"), undefined);
	delete process.env.TEST_SECRET_KEY;
});

test("config: resolveConfigSecrets deep-resolves env refs", () => {
	process.env.TEST_API_KEY = "sk-12345";
	const config = {
		provider: {
			apiKey: "env:TEST_API_KEY",
			baseUrl: "http://localhost:11434",
		},
	};
	const resolved = resolveConfigSecrets(config);
	assert.equal(resolved.provider.apiKey, "sk-12345");
	assert.equal(resolved.provider.baseUrl, "http://localhost:11434");
	delete process.env.TEST_API_KEY;
});

test("capabilities: defaultCapabilitiesFor returns all caps", () => {
	const caps = defaultCapabilitiesFor();
	assert.equal(caps.terminal, false);
	assert.equal(caps.web, true);
	assert.equal(caps.mcp, true);
	assert.equal(caps.documents, true);
	assert.equal(caps.artifacts, true);
	assert.equal(caps.filesystem, false);
});

test("capabilities: capabilityEnabled checks individual caps", () => {
	assert.equal(capabilityEnabled({ web: true }, "web"), true);
	assert.equal(capabilityEnabled({ web: false }, "web"), false);
	assert.equal(capabilityEnabled({}, "web"), true); // default true
});

test("capabilities: normalizeCapabilities normalizes object", () => {
	const caps = normalizeCapabilities({ terminal: true, web: false });
	assert.equal(caps.terminal, true);
	assert.equal(caps.web, false);
	assert.equal(caps.mcp, true); // default
});

test("capabilities: resolveToolCapability checks tool access", () => {
	assert.equal(resolveToolCapability("web_search", { web: true }).allowed, true);
	assert.equal(resolveToolCapability("web_search", { web: false }).allowed, false);
	assert.equal(resolveToolCapability("run_command", { terminal: true }).allowed, true);
	assert.equal(resolveToolCapability("run_command", { terminal: false }).allowed, false);
});

test("capabilities: applyCapabilitiesToToolHandlers preserves allowed handlers", () => {
	const handlers = {
		web_search: { handler: async () => ({ ok: true }) },
		run_command: { handler: async () => ({ ok: true }) },
	};
	const secured = applyCapabilitiesToToolHandlers(handlers, { web: true, terminal: false });
	assert.ok(secured.web_search);
	assert.ok(typeof secured.web_search.handler === "function");
	assert.ok(secured.run_command);
	assert.ok(typeof secured.run_command.handler === "function");
});

test("compaction: shouldAutoCompact checks threshold", () => {
	const result = shouldAutoCompact({ context: { used_percent: 95 } }, 90);
	assert.equal(result, true);
	const result2 = shouldAutoCompact({ context: { used_percent: 50 } }, 90);
	assert.equal(result2, false);
});

test("compaction: compactMessages returns compacted messages", async () => {
	const messages = [
		{ role: "user", content: "message 1" },
		{ role: "assistant", content: "response 1" },
		{ role: "user", content: "message 2" },
	];
	const compacted = await compactMessages({
		messages,
		strategy: "truncate",
		keepLastMessages: 2,
	});
	assert.ok(Array.isArray(compacted));
	assert.ok(compacted.length <= messages.length);
});

test("policies: looksLikeRecall detects recall queries", () => {
	assert.equal(looksLikeRecall("te dije eso antes"), true);
	assert.equal(looksLikeRecall("recuerdas lo que hablamos"), true);
	assert.equal(looksLikeRecall("hola cómo estás"), false);
});

test("policies: looksLikeWebQuery detects web queries", () => {
	assert.equal(looksLikeWebQuery("clima hoy"), true);
	assert.equal(looksLikeWebQuery("noticias de bitcoin"), true);
	assert.equal(looksLikeWebQuery("hola"), false);
});

test("policies: cleanWebQuery cleans query text", () => {
	const cleaned = cleanWebQuery("busca el clima en quito por favor");
	assert.equal(typeof cleaned, "string");
	assert.ok(cleaned.length > 0);
});

test("policies: cleanWebQuery extrae entidades del contexto de memoria", () => {
	const verbose = "Busca en internet datos verificables sobre el lugar que viste en la imagen: altitud de la ciudad y el parque que aparece en primer plano.";
	const context = "Analiza la imagen de Quito, Ecuador. La imagen es una vista aérea de Quito.";
	assert.equal(cleanWebQuery("busca el clima en quito por favor"), "el clima en quito");
	assert.equal(cleanWebQuery(verbose, { context }), "Quito Ecuador altitud parque");
});

test("policies: la regla estructural descarta andamiaje sin borrar intenciones", () => {
	const verbose = "Busca datos verificables sobre el lugar que viste en la imagen: altitud y parque.";
	const noisyContext = [
		"MENSAJES ANTIGUOS RECUPERADOS DEL HISTORIAL DEL USUARIO:",
		'- usuario: Analiza la imagen adjunta "vista-aérea-de-quito-el-centro-de-la-ciudad.webp".',
		"  bot: Based on the provided aerial view. The image shows a dense city. However, I cannot identify it.",
	].join("\n");
	assert.equal(cleanWebQuery(verbose, { context: noisyContext }), "Quito altitud parque");
	// "capital" no está en una lista de stopwords: al abrir frase es intención.
	assert.equal(cleanWebQuery("¿Cuál es la capital de Ecuador?"), "Ecuador capital");
});

test("policies: checkGrounding detecta cifras y entidades sin respaldo web", () => {
	const webResults = [{
		title: "Quito — Wikipedia",
		url: "https://es.wikipedia.org/wiki/Quito",
		snippet: "Quito se asienta a unos 2.850 metros de altitud. Parque Itchimbía.",
	}];
	const supported = checkGrounding({
		text: "Quito está a 2.850 m de altitud; el parque es Itchimbía.",
		webResults,
	});
	assert.equal(supported.ok, true);

	const wrong = checkGrounding({
		text: "Quito tiene 3,165 m y el parque es Quito Central Park.",
		webResults,
	});
	assert.equal(wrong.ok, false);
	assert.ok(wrong.unsupported.includes("3165"));
	assert.ok(wrong.unsupported.some((item) => /Quito Central Park/i.test(item)));
	assert.ok(wrong.sourceChars > 0);

	// Las cabeceras markdown no son afirmaciones que haya que respaldar.
	const markdown = checkGrounding({
		text: "1. **City Altitude**: 2.850 m.\n## Foreground Details\nSe ve el Parque Itchimbía.",
		webResults,
	});
	assert.equal(markdown.ok, true);
	assert.deepEqual(markdown.unsupported, []);

	const noSources = checkGrounding({ text: "cualquier cosa" });
	assert.equal(noSources.ok, null);
	assert.equal(noSources.reason, "no web sources");
	assert.equal(noSources.coverage, null);
	assert.equal(noSources.confidence, null);

	// Coverage and confidence make a partial match visible instead of hiding it
	// behind a single boolean.
	assert.equal(supported.coverage, 1);
	assert.ok(["low", "medium", "high"].includes(supported.confidence));
	assert.equal(wrong.coverage, 0);
	assert.equal(wrong.confidence, "low");
	assert.ok(wrong.checked.numbers >= 1);
});

test("policies: formatHistoryRecap formats history", () => {
	const recap = formatHistoryRecap({
		results: [
			{ role: "user", content: "hola" },
			{ role: "assistant", content: "¿en qué puedo ayudarte?" },
		],
	});
	assert.ok(recap.includes("hola"));
	assert.ok(recap.includes("ayudarte"));
});
