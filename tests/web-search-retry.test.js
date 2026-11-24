import { test } from "node:test";
import assert from "node:assert/strict";

import {
	AGENTKIT_FEATURES,
	AgentSession,
	isGenericWebInstruction,
	listWebSearchEngines,
	looksLikeNoAnswer,
	looksLikeWebQuery,
	pickWebQuery,
} from "../src/index.js";
import { extractBingResults, extractGoogleNewsResults } from "../src/websearch.js";

const provider = (extra = {}) => ({ provider: "fake-session", model: "fake-1", contextLength: 100000, ...extra });

const makeSession = ({ webSearchFn, askAgentFn, ...options } = {}) => {
	const events = [];
	const calls = [];
	const session = new AgentSession({
		provider: provider(),
		system: "Eres un asistente de prueba.",
		config: {},
		onEvent: (event) => events.push(event),
		webSearchFn: webSearchFn || (async () => ({ ok: false, source: null, results: [] })),
		askAgentFn: async (request) => {
			calls.push(request);
			if (typeof askAgentFn === "function") return askAgentFn(request, calls.length);
			return { text: "ok" };
		},
		...options,
	});
	return { session, events, calls };
};

test("policies: sitios nombrados son consultas web, aunque no digan 'internet'", () => {
	const text = "Busca en github a edwinspire, y si puedes acceder a su cuenta de LinkedIn extrae todos los datos públicos";
	assert.equal(looksLikeWebQuery(text), true);
	assert.equal(isGenericWebInstruction(text), false);
	assert.equal(pickWebQuery({ ownText: text }), "Github edwinspire Linkedin");
});

test("policies: una instrucción genérica toma la query del mensaje citado", () => {
	const quoted = "Busca en github a edwinspire, y si puedes acceder a su cuenta de LinkedIn extrae todos los datos públicos";
	assert.equal(isGenericWebInstruction("Busca en internet"), true);
	assert.equal(pickWebQuery({ ownText: "Busca en internet" }), "");
	assert.equal(pickWebQuery({ ownText: "Busca en internet", quotedText: quoted }), "Github edwinspire Linkedin");
});

test("policies: detecta rechazos del modelo para ofrecer reintento", () => {
	assert.equal(looksLikeNoAnswer("No lo sé. No tengo acceso a información actualizada."), true);
	assert.equal(looksLikeNoAnswer("No encontré datos suficientes para responder."), true);
	assert.equal(looksLikeNoAnswer("I have no access to real-time data."), true);
	assert.equal(looksLikeNoAnswer("Aquí tienes el archivo JS."), false);
	assert.equal(looksLikeNoAnswer("No, aquí está el JSON que pediste."), false);
});

test("AgentSession: la búsqueda ocurre en la sesión aunque el harness inyecte askAgentFn", async () => {
	const seen = [];
	const { session, events, calls } = makeSession({
		webSearchFn: async ({ query }) => {
			seen.push(query);
			return {
				ok: true,
				source: "fixture",
				query,
				results: [{ title: "edwinspire/OpenFusionAPI", url: "https://github.com/edwinspire/OpenFusionAPI", snippet: "Repositorio público" }],
			};
		},
	});

	const result = await session.ask("Busca en github a edwinspire");
	assert.deepEqual(seen, ["Github edwinspire"]);
	assert.match(calls[0].system, /WEB SEARCH RESULTS/);
	assert.match(calls[0].system, /github\.com\/edwinspire/);
	assert.equal(calls[0].preSearch, false, "askAgent no debe buscar dos veces");
	assert.equal(result.webSearch.used, true);
	assert.equal(result.webSearch.source, "fixture");
	assert.equal(result.webSearch.results, 1);

	const webEvent = events.filter((event) => event.type === "web_search").at(-1);
	assert.equal(webEvent.query, "Github edwinspire");
	assert.equal(webEvent.used, true);
	const done = events.filter((event) => event.type === "done").at(-1);
	assert.deepEqual(done.webSearch.query, "Github edwinspire");
});

test("AgentSession: ofrece sugerencia de búsqueda cuando el modelo rechaza responder", async () => {
	const { session, events } = makeSession({
		askAgentFn: () => ({ text: "No lo sé. No tengo acceso a información actualizada." }),
		webSearchFn: async () => ({ ok: false, source: null, results: [] }),
	});

	const result = await session.ask("Busca en github a edwinspire y dime sus repositorios");
	assert.equal(result.suggestion?.type, "web_search");
	assert.equal(result.suggestion?.query, "Github edwinspire repositorios");
	assert.match(result.suggestion.message, /busque en internet/i);

	const event = events.filter((item) => item.type === "no_answer").at(-1);
	assert.equal(event.query, result.suggestion.query);
});

test("AgentSession: un rechazo tras búsqueda fallida también ofrece reintento", async () => {
	const { session } = makeSession({
		askAgentFn: () => ({ text: "No tengo acceso a internet." }),
		webSearchFn: async ({ query }) => ({ ok: false, query, source: null, results: [], errors: ["BLOCKED"] }),
	});
	const result = await session.ask("Busca en internet el clima de Quito hoy");
	assert.equal(result.webSearch.used, false);
	assert.equal(result.webSearch.errors[0], "BLOCKED");
	assert.equal(result.suggestion?.query, result.webSearch.query);
});

test("AgentSession: el reintento con query explícita busca sin duplicar preSearch", async () => {
	const queries = [];
	const { session, calls } = makeSession({
		webSearchFn: async ({ query }) => {
			queries.push(query);
			return { ok: true, source: "fixture", results: [{ title: "Quito", url: "https://example.org/quito", snippet: "Clima" }] };
		},
	});
	await session.ask("No lo sé", {
		preSearch: "always",
		webSearch: { query: "Quito clima hoy" },
		quotedText: "¿Cómo está el clima?",
	});
	assert.deepEqual(queries, ["Quito clima hoy"]);
	assert.equal(calls[0].preSearch, false);
});

test("websearch: Bing descodifica /ck/a?u= y devuelve la URL real", () => {
	const real = "https://github.com/edwinspire/OpenFusionAPI";
	const wrapped = `a1${Buffer.from(real).toString("base64url")}`;
	const html = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=${wrapped}">${real}</a></h2><p>Repositorio de edwinspire</p></li>`;
	const results = extractBingResults(html, 5);
	assert.equal(results.length, 1);
	assert.equal(results[0].url, real);
	assert.equal(results[0].title, real);
	assert.match(results[0].snippet, /Repositorio/);
});

test("websearch: parser de Google News RSS con título, enlace y fecha", () => {
	const xml = `<?xml version="1.0"?><rss><channel>
		<item><title>Quito anuncia nueva medida</title><link>https://news.example.org/quito</link><description>Detalles de la medida</description><pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate></item>
		<item><title>Sin enlace</title><description>Se descarta</description></item>
	</channel></rss>`;
	const results = extractGoogleNewsResults(xml, 5);
	assert.equal(results.length, 1);
	assert.equal(results[0].title, "Quito anuncia nueva medida");
	assert.equal(results[0].url, "https://news.example.org/quito");
	assert.match(results[0].snippet, /2026/);
});

test("websearch: los motores por defecto incluyen los fallbacks y el kit expone capacidades", () => {
	const engines = listWebSearchEngines();
	for (const name of ["duckduckgo", "bing", "google-news", "duckduckgo-instant", "http-json"]) {
		assert.ok(engines.includes(name), `${name} debe estar registrado`);
	}
	assert.equal(AGENTKIT_FEATURES.sessionWebSearch, true);
	assert.equal(AGENTKIT_FEATURES.noAnswerSuggestion, true);
});
