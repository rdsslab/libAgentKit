import { test } from "node:test";
import assert from "node:assert/strict";

import {
	AGENTKIT_FEATURES,
	AgentSession,
	isGenericWebInstruction,
	listWebSearchEngines,
	looksLikeNoAnswer,
	looksLikeWebQuery,
	parseWebDecision,
	prefilterWebDecision,
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
	assert.equal(AGENTKIT_FEATURES.agentWebDecision, true);
});

test("policies: parseWebDecision acepta JSON y booleano seguido de query", () => {
	assert.deepEqual(parseWebDecision('{"search":true,"query":"presidente Ecuador 2026"}'), {
		search: true,
		query: "presidente Ecuador 2026",
	});
	assert.deepEqual(parseWebDecision('```json\n{"search":false,"query":""}\n```'), {
		search: false,
		query: "",
	});
	assert.deepEqual(parseWebDecision("true - presidenta del Ecuador 2026"), {
		search: true,
		query: "presidenta del Ecuador 2026",
	});
	assert.deepEqual(parseWebDecision("no"), { search: false, query: "" });
	assert.equal(parseWebDecision("quizá debería buscar"), null);
	assert.equal(parseWebDecision(""), null);
});

test("AgentSession: el router del modelo decide buscar aunque la regex no lo detecte", async () => {
	const searched = [];
	const routerRequests = [];
	const { session, events, calls } = makeSession({
		webSearchFn: async ({ query }) => {
			searched.push(query);
			return { ok: true, source: "fixture", results: [{ title: "Presidente", url: "https://example.org/pres", snippet: "Dato actual" }] };
		},
		webDecisionWithModel: {
			askFn: async (request) => {
				routerRequests.push(request);
				return { text: '{"search":true,"query":"presidente actual del Ecuador 2026"}' };
			},
		},
	});
	const text = "¿quién es el presidente actual del Ecuador?";
	assert.equal(looksLikeWebQuery(text), false, "la política fija no detecta esta pregunta");
	const result = await session.ask(text);

	assert.deepEqual(searched, ["presidente actual del Ecuador 2026"]);
	assert.equal(result.webSearch.used, true);
	assert.equal(routerRequests.length, 1, "el router no debe disparar el callback del host");
	assert.equal(routerRequests[0].preSearch, false);
	assert.deepEqual(routerRequests[0].tools, {});
	assert.equal(calls.length, 1, "solo la generación principal usa askAgentFn");
	const decision = events.filter((event) => event.type === "web_decision").at(-1);
	assert.equal(decision.search, true);
	assert.equal(decision.query, "presidente actual del Ecuador 2026");
});

test("AgentSession: el router puede vetoar una query que la regex marcaría como web", async () => {
	const searched = [];
	const { session, events, calls } = makeSession({
		webSearchFn: async ({ query }) => {
			searched.push(query);
			return { ok: true, source: "fixture", results: [{ title: "x", url: "https://example.org/x", snippet: "x" }] };
		},
		webDecisionWithModel: { askFn: async () => ({ text: '{"search":false,"query":""}' }) },
	});
	const text = "noticias de bitcoin";
	assert.equal(looksLikeWebQuery(text), true);
	await session.ask(text);

	assert.deepEqual(searched, [], "el modelo manda false: no se busca");
	assert.equal(calls.length, 1);
	assert.equal(calls[0].system.includes("WEB SEARCH RESULTS"), false);
	const decision = events.filter((event) => event.type === "web_decision").at(-1);
	assert.equal(decision.search, false);
});

test("AgentSession: router inválido o con error cae a la política determinista", async () => {
	const searched = [];
	const broken = makeSession({
		webSearchFn: async ({ query }) => {
			searched.push(query);
			return { ok: false, source: null, results: [] };
		},
		webDecisionWithModel: { askFn: async () => ({ text: "no entiendo la pregunta" }) },
	});
	await broken.session.ask("noticias de bitcoin");
	assert.deepEqual(searched, ["noticias de bitcoin"], "la regex sigue como fallback");
	assert.equal(broken.events.filter((event) => event.type === "web_decision").at(-1).search, null);

	const failed = makeSession({
		webSearchFn: async ({ query }) => {
			searched.push(query);
			return { ok: false, source: null, results: [] };
		},
		webDecisionWithModel: { askFn: async () => { throw new Error("provider down"); } },
	});
	await failed.session.ask("clima hoy");
	assert.deepEqual(searched.at(-1), "clima hoy");
	assert.equal(failed.events.filter((event) => event.type === "web_decision").at(-1).search, null);
});

test("AgentSession: preSearch y query explícitos ganan sobre el router", async () => {
	const searched = [];
	const routerCalls = [];
	const { session } = makeSession({
		webSearchFn: async ({ query }) => {
			searched.push(query);
			return { ok: false, source: null, results: [] };
		},
		webDecisionWithModel: {
			askFn: async () => {
				routerCalls.push(1);
				return { text: '{"search":false,"query":""}' };
			},
		},
	});
	await session.ask("hola", { preSearch: "always", webSearch: { query: "Quito clima hoy" } });
	assert.deepEqual(searched, ["Quito clima hoy"]);
	assert.deepEqual(routerCalls, [], "un override explícito no consulta al router");
});

test("policies: prefilter decide casos obvios y deja la duda al modelo", () => {
	assert.equal(prefilterWebDecision({ text: "hola" }).search, false);
	assert.equal(prefilterWebDecision({ text: "¿cuánto es 2+2?" }).search, false);
	assert.equal(prefilterWebDecision({ text: "hello, how are you?" }).search, false);
	assert.equal(prefilterWebDecision({ text: "¿qué opinas de las noticias de hoy?" }), null);

	const news = prefilterWebDecision({ text: "noticias de bitcoin" });
	assert.equal(news.search, true);
	assert.equal(news.source, "policy-yes");
	assert.ok(news.query.toLowerCase().includes("bitcoin"));

	const who = prefilterWebDecision({ text: "¿quién es el presidente del Ecuador?" });
	assert.equal(who.search, true);

	const english = prefilterWebDecision({ text: "search for the current price of bitcoin" });
	assert.equal(english.search, true);

	const url = prefilterWebDecision({ text: "mira https://example.org/article" });
	assert.equal(url.search, true);
});

test("policies: una corrección explícita fuerza búsqueda sin consultar al router", async () => {
	const cases = [
		"La información no es correcta, busca otras fuentes",
		"No es correcto, busca nuevamente el presidente del Ecuador",
		"Intenta nuevamente con Daniel Noboa",
		"That's wrong, check other sources about the president of Ecuador",
	];
	for (const text of cases) {
		const decision = prefilterWebDecision({ text });
		assert.equal(decision?.search, true, `"${text}" debe forzar búsqueda`);
		assert.equal(decision?.source, "policy-yes");
		assert.ok(decision.query.length > 8);
	}
	assert.equal(prefilterWebDecision({ text: "¿es correcto?" }), null);

	const searched = [];
	const routerCalls = [];
	const { session } = makeSession({
		webSearchFn: async ({ query }) => {
			searched.push(query);
			return { ok: false, source: null, results: [] };
		},
		webDecisionPrefilter: true,
		webDecisionWithModel: {
			askFn: async () => {
				routerCalls.push(1);
				return { text: '{"search":false,"query":""}' };
			},
		},
	});
	await session.ask("La información no es correcta, busca otras fuentes");
	assert.deepEqual(routerCalls, [], "la corrección no llega al router");
	assert.equal(searched.length, 1);
});

test("AgentSession: groundingPolicy block no persiste una respuesta sin respaldo", async () => {
	const { session, events } = makeSession({
		webSearchFn: async () => ({
			ok: true,
			source: "fixture",
			results: [{
				title: "Presidencia",
				url: "https://www.presidencia.gob.ec/",
				snippet: "Daniel Noboa es presidente del Ecuador.",
			}],
		}),
		webDecisionPrefilter: true,
		groundingPolicy: {
			mode: "block",
			fallback: () => "No verificado con las fuentes disponibles.",
		},
		askAgentFn: () => ({
			text: "El presidente es Luisinio Gutiérrez. Fuente: [Ecuador](https://www.ecuador.gov.ec/).",
		}),
	});
	const result = await session.ask("¿quién es el presidente del Ecuador?");
	assert.equal(result.text, "No verificado con las fuentes disponibles.");
	assert.equal(session.history[1].content, result.text);
	assert.ok(!result.text.includes("ecuador.gov.ec"), "el fallback no repite la cita falsa");
	assert.ok(!session.memory.episodes.some((row) => String(row.next?.content || "").includes("Luisinio")));
	assert.equal(events.find((event) => event.type === "grounding").blocked, true);
	assert.equal(events.filter((event) => event.type === "done").at(-1).grounding.blocked, true);
});

test("policies: los saludos anclados ampliados no consultan al router", () => {
	const anchored = [
		"¿cómo estás?",
		"qué tal",
		"muchas gracias",
		"gracias por tu ayuda",
		"thanks a lot",
		"good morning",
		"how are you doing?",
		"buenos días",
		"hasta luego",
	];
	for (const text of anchored) {
		const decision = prefilterWebDecision({ text });
		assert.equal(decision?.search, false, `"${text}" debe resolverse con policy-no`);
		assert.equal(decision?.source, "policy-no");
	}

	// La coincidencia es completa: un saludo dentro de una pregunta compuesta
	// nunca se clasifica como NO automático.
	assert.notEqual(prefilterWebDecision({ text: "gracias por tu ayuda con las noticias de bitcoin" })?.search, false);
	assert.equal(prefilterWebDecision({ text: "hola, ¿cómo estás? ¿qué opinas del clima de Marte?" }), null);
});

test("AgentSession: el prefilter evita la llamada al router en turnos obvios", async () => {
	const searched = [];
	const routerCalls = [];
	const { session, events } = makeSession({
		webSearchFn: async ({ query }) => {
			searched.push(query);
			return { ok: true, source: "fixture", results: [{ title: "x", url: "https://example.org/x", snippet: "x" }] };
		},
		webDecisionPrefilter: true,
		webDecisionWithModel: {
			askFn: async () => {
				routerCalls.push(1);
				return { text: '{"search":false,"query":""}' };
			},
		},
	});
	await session.ask("noticias de bitcoin");
	assert.deepEqual(routerCalls, [], "un caso obvio no consulta al modelo");
	assert.equal(searched.length, 1);
	assert.equal(events.filter((event) => event.type === "web_decision").at(-1).source, "policy-yes");

	await session.ask("hola");
	assert.deepEqual(routerCalls, [], "un saludo tampoco consulta al modelo");
	assert.equal(events.filter((event) => event.type === "web_decision").at(-1).source, "policy-no");

	await session.ask("¿qué opinas del clima de Marte?");
	assert.deepEqual(routerCalls, [1], "una duda sí consulta al modelo");
	assert.equal(events.filter((event) => event.type === "web_decision").at(-1).source, "model");
});

test("AgentSession: sin webDecisionWithModel no se consulta al router", async () => {
	const routerCalls = [];
	const { session, events } = makeSession({
		webDecisionWithModel: {
			askFn: async () => {
				routerCalls.push(1);
				return { text: '{"search":true,"query":"x"}' };
			},
		},
	});
	// El flag se activa con true/objeto; con false (por defecto) no hay router.
	session.webDecisionWithModel = false;
	await session.ask("noticias de bitcoin");
	assert.deepEqual(routerCalls, []);
	assert.equal(events.some((event) => event.type === "web_decision"), false);
});
