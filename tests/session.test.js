import { test } from "node:test";
import assert from "node:assert/strict";

import { AgentSession, MemoryStore, compactMessagesWithSummary, resolveEmbeddings } from "../src/index.js";
import { __internalIAForTests } from "../src/ia.js";

const provider = (extra = {}) => ({ provider: "fake-session", model: "fake-1", contextLength: 100000, ...extra });

const makeSession = ({ onEvent, askAgentFn, ...options } = {}) => {
	const events = [];
	const calls = [];
	const session = new AgentSession({
		provider: provider(),
		system: "Eres un asistente de prueba.",
		config: {},
		memory: { mode: "lexical" },
		onEvent: (event) => events.push(event),
		askAgentFn: async (request) => {
			calls.push(request);
			if (typeof askAgentFn === "function") return askAgentFn(request, calls.length);
			return { text: `respuesta-${calls.length}` };
		},
		...options,
	});
	return { session, events, calls };
};

const types = (events) => events.map((event) => event.type);

test("AgentSession: conserva el historial entre turnos y emite eventos útiles", async () => {
	const { session, events, calls } = makeSession({
		askAgentFn: (request, turn) => {
			request.onThinking?.("analizando la pregunta", { provider: "fake-session", round: 1 });
			request.onTextDelta?.("Respuesta", { provider: "fake-session", round: 1 });
			return { text: `respuesta-${turn}` };
		},
	});

	await session.ask("Hola, soy Ana");
	await session.ask("¿Cómo me llamo?");

	assert.equal(calls.length, 2);
	assert.equal(calls[0].history.length, 0);
	assert.equal(calls[1].history.length, 2);
	assert.deepEqual(calls[1].history[0], { role: "user", content: "Hola, soy Ana" });
	assert.equal(calls[1].history[1].content, "respuesta-1");
	assert.equal(session.history.length, 4);
	assert.equal(session.memory.size, 2);

	assert.equal(types(events)[0], "thinking");
	assert.equal(events[0].phase, "request");
	assert.equal(typeof events[0].estimatedTokens, "number");
	assert.ok(events.some((event) => event.type === "thinking" && event.phase === "provider"));
	assert.ok(events.some((event) => event.type === "answer_delta" && event.text === "Respuesta"));
	const dones = events.filter((event) => event.type === "done");
	const done = dones.at(-1);
	assert.equal(done.chars, "respuesta-2".length);
	assert.equal(done.historyMessages, 4);
});

test("AgentSession: avisa, compacta al 90% y deja solo system + resumen", async () => {
	const { session, events, calls } = makeSession({
		context: { limit: 100000, thresholdPercent: 90 },
		askAgentFn: () => ({ text: "ok" }),
	});

	await session.ask("Hola");
	await session.ask("¿Cómo estás?");
	// El historial debe mandar: si el turno entrante fuera el grande, el
	// harness avisa pero no compacta (ver test de incoming_turn_too_large).
	for (let index = 0; index < 4; index += 1) {
		await session.ask(`Datos de prueba ${index}: ${"a".repeat(80)}`);
	}
	events.length = 0;
	session.contextLimitOverride = 60; // simula que el contexto se llenó
	await session.ask("¿Y ahora?");

	assert.deepEqual(types(events).slice(0, 3), [
		"context_warning",
		"compaction_start",
		"compaction_end",
	]);
	const warning = events[0];
	assert.equal(warning.reason, "context_threshold");
	assert.equal(warning.contextLimit, 60);
	assert.ok(warning.usedPercent >= 90);
	assert.ok(warning.message.includes("90%"));
	assert.ok(warning.preview.length > 0);

	const start = events[1];
	assert.equal(start.contextLimit, 60);
	assert.equal(start.messagesBefore, 12);
	assert.ok(start.preview);

	const end = events[2];
	assert.ok(end.summaryChars > 0);
	assert.equal(end.removedMessages, 12);
	assert.equal(end.archivedTurns, 12);
	assert.equal(end.messagesAfter, 1);
	assert.equal(end.indexEpisodes, 1);
	assert.ok(end.preview);

	// Justo después de compactar queda solo [system+resumen]; el turno actual se
	// añade después, por eso al final hay resumen + 2 mensajes nuevos.
	assert.equal(session.history.length, 3);
	assert.equal(session.history[0].role, "system");
	assert.ok(session.summary.includes("Conversation summary"));
	assert.equal(session.memory.size, 2);
	assert.equal(session.memory.episodes[0].kind, "summary");
	assert.equal(calls[6].history.length, 1);
	assert.equal(calls[6].history[0].role, "system");
});

test("AgentSession: un turno entrante sobredimensionado avisa pero no compacta", async () => {
	const { session, events } = makeSession({
		context: { limit: 40, thresholdPercent: 90 },
		askAgentFn: () => ({ text: "ok" }),
	});

	await session.ask("x".repeat(300));

	const warning = events.find((event) => event.type === "context_warning");
	assert.equal(warning.reason, "incoming_turn_too_large");
	assert.ok(warning.incomingShare >= 0.7);
	assert.equal(warning.compactionSkipped, true);
	assert.equal(events.filter((event) => event.type === "compaction_start").length, 0);
	assert.equal(session.history.length, 2);
});

test("AgentSession: la búsqueda léxica se dispara en preguntas de recall", async () => {
	const { session, events, calls } = makeSession();
	await session.ask("Te mostré un auto azul modelo Phantom.");
	await session.ask("¿Recuerdas el auto azul que te mostré?");

	const recall = events.find((event) => event.type === "recall");
	assert.ok(recall, "debe emitirse un evento recall");
	assert.ok(recall.matches >= 1);
	assert.equal(recall.usedEmbeddings, false);
	assert.equal(recall.mode, "lexical");
	assert.ok(recall.preview.includes("auto azul"));
	assert.ok(calls[1].system.includes("auto azul"));
	assert.ok(calls[1].system.includes("Memory from previous conversations"));
});

test("MemoryStore: usa embeddings inyectados y degrada a léxico si fallan", async () => {
	const embedded = new MemoryStore({
		mode: "hybrid",
		config: {},
		embeddings: {
			embedFn: async (text) => (text.includes("azul") ? [1, 0] : [0, 1]),
		},
	});
	await embedded.addTurn("Vi un auto azul", "El auto azul era un Phantom");
	await embedded.addTurn("Compré pan", "El pan era integral");

	const hit = await embedded.search("auto azul", { topK: 2 });
	assert.equal(hit.usedEmbeddings, true);
	assert.equal(hit.mode, "hybrid");
	assert.ok(hit.results.some((row) => row.content.includes("auto azul")));

	const degraded = new MemoryStore({
		mode: "hybrid",
		config: {},
		embeddings: {
			embedFn: async () => { throw new Error("servidor caído"); },
		},
	});
	await degraded.addTurn("Vi un auto azul", "Era un Phantom azul");
	const fallback = await degraded.search("auto azul");
	assert.equal(fallback.usedEmbeddings, false);
	assert.equal(fallback.mode, "lexical");
	assert.match(fallback.embeddingReason, /failed/);
	assert.ok(fallback.results.length >= 1);
});

test("MemoryStore: replaceWithSummary purga el índice y deja solo el resumen", async () => {
	const store = new MemoryStore({ mode: "lexical", config: {} });
	await store.addTurn("uno", "respuesta uno");
	await store.addTurn("dos", "respuesta dos");
	assert.equal(store.size, 2);
	await store.replaceWithSummary("Resumen del chat");
	assert.equal(store.size, 1);
	assert.equal(store.episodes[0].kind, "summary");
	assert.equal(store.episodes[0].content, "Resumen del chat");
});

test("ia.js: onThinking captura razonamiento real de los tres adaptadores", async () => {
	const {
		collectOpenAIStream,
		collectAnthropicStream,
		collectGeminiStream,
	} = __internalIAForTests;
	const openai = [];
	await collectOpenAIStream(
		[{ choices: [{ delta: { content: "hola", reasoning_content: "pienso en español" } }] }],
		null,
		{ provider: "openai" },
		(text) => openai.push(text),
	);
	assert.deepEqual(openai, ["pienso en español"]);

	const anthropic = [];
	await collectAnthropicStream([
		{ type: "content_block_start", index: 0, content_block: { type: "thinking" } },
		{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "analizo" } },
	], null, {}, (text) => anthropic.push(text));
	assert.deepEqual(anthropic, ["analizo"]);

	const gemini = [];
	await collectGeminiStream([{
		text: "respuesta",
		candidates: [{ content: { parts: [{ thought: true, text: "razonando" }] } }],
	}], null, {}, (text) => gemini.push(text));
	assert.deepEqual(gemini, ["razonando"]);
});

test("AgentSession: compactaciones sucesivas no anidan cabeceras ni duplican el turno entrante", async () => {
	const { session, events, calls } = makeSession({
		context: { limit: 100, thresholdPercent: 90, maxSummaryChars: 900 },
		askAgentFn: (request, turn) => ({ text: `respuesta-${turn}` }),
	});

	await session.ask("Vi una imagen de Quito, Ecuador");
	await session.ask("¿Qué viste?");
	for (let index = 0; index < 3; index += 1) {
		await session.ask(`Detalle ${index}: ${"a".repeat(100)}`);
	}
	events.length = 0;
	session.contextLimitOverride = 12;
	await session.ask("¿Y eso?");
	session.contextLimitOverride = 12;
	await session.ask("¿Y ahora?");

	const ends = events.filter((event) => event.type === "compaction_end");
	assert.equal(ends.length, 2);
	assert.ok(!ends[0].preview.includes("¿Y eso?"));
	assert.ok(!ends[1].preview.includes("¿Y ahora?"));
	assert.ok(!/Resumen anterior:|Turnos recientes:/.test(session.summary));
	assert.ok(session.summary.includes("Quito"));
	assert.ok(session.history[0].content.length < 1000);
	assert.ok(calls.slice(2).every((request) => request.history[0]?.role === "system"));
});

test("AgentSession: aporta entidades de memoria a la query web y estima la inyección", async () => {
	const { session, calls, events } = makeSession({
		context: { limit: 100000, thresholdPercent: 90 },
		askAgentFn: () => ({ text: "ok" }),
		webSearchFn: async ({ query, maxInjectedContextChars }) => ({
			ok: true,
			query,
			source: "fixture",
			results: [{
				title: "Quito: altitude y parques",
				url: "https://example.org/quito",
				snippet: "Quito está a 2850 m de altitud. El parque Itchimbía ofrece miradores.",
			}],
			context: `Quito altitud 2850 m parque Itchimbía ${"x".repeat(Math.max(0, (maxInjectedContextChars || 800) - 80))}`,
		}),
	});

	await session.ask("Vi una imagen de Quito, Ecuador.");
	await session.ask(
		"Busca en internet datos verificables sobre el lugar que viste en la imagen: altitud y parque.",
		{ preSearch: "always", webSearch: { maxInjectedContextChars: 800 } },
	);

	const last = calls.at(-1);
	assert.match(last.webSearch?.context ?? "", /Quito/);
	assert.equal(last.webSearch.query, undefined); // la query final la calcula la sesión
	assert.equal(last.preSearch, false, "la sesión ya buscó: askAgent no debe repetirlo");

	const thinking = events.filter((event) => event.type === "thinking" && event.phase === "request").at(-1);
	const done = events.filter((event) => event.type === "done").at(-1);
	assert.ok(thinking.injectedTokens >= 200);
	assert.ok(done.injectedTokens >= 200);
	const searched = events.filter((event) => event.type === "web_search").at(-1);
	assert.equal(searched.used, true);
	assert.equal(searched.source, "fixture");
	assert.match(searched.query, /Quito/i);
	assert.match(done.webSearch.query, /Quito/i);
});

test("AgentSession: la calibración conserva el delta negativo y aprende chars/token", async () => {
	const { session, events } = makeSession({
		askAgentFn: (_request, turn) => ({
			text: "ok",
			injectedContextChars: 800,
			usage: {
				prompt_tokens: turn === 1 ? 2 : 200,
				completion_tokens: 5,
				total_tokens: turn === 1 ? 7 : 205,
				context: { estimated: false, used_percent: 10 },
			},
		}),
	});

	await session.ask("hola");
	const done1 = events.filter((event) => event.type === "done").at(-1);
	assert.ok(done1.observedInjectionTokens < 0, "el proveedor estimó menos de lo previsto");
	assert.equal(session.calibration.samples, 1);
	assert.ok(session.calibration.delta < 0, "la sobreestimación debe aprenderse, no descartarse");
	assert.equal(session.stats().calibration.samples, 1);

	await session.ask("otra vez");
	const done2 = events.filter((event) => event.type === "done").at(-1);
	assert.ok(done2.observedInjectionTokens > 0);
	assert.ok(session.calibration.charsPerToken > 0);
	assert.ok(done2.calibration.charsPerToken > 0);
	assert.equal(done2.injectedContextChars, 800);
});

test("AgentSession: countTokens sustituye la heurística en la banda de incertidumbre", async () => {
	let counted = null;
	const { session, events } = makeSession({
		context: { limit: 25, thresholdPercent: 90 }, // 24 tokens estimados ≈ 96%
		countTokens: async (payload) => {
			counted = payload;
			return { tokens: 5 };
		},
		askAgentFn: () => ({ text: "ok" }),
	});

	await session.ask("hola");

	assert.ok(counted, "el contador debe ejecutarse antes de decidir");
	assert.equal(counted.messages.at(-1).content, "hola");
	const verified = events.find((event) => event.type === "context_verified");
	assert.equal(verified.exactTokens, 5);
	assert.equal(events.filter((event) => event.type === "compaction_start").length, 0);
});

test("AgentSession: la histeresis evita compactar el turno siguiente", async () => {
	const { session, events } = makeSession({
		context: {
			limit: 100000,
			thresholdPercent: 90,
			compactionCooldownTurns: 2,
			urgentCompactionPercent: 1000, // desactiva el atajo de "urgente"
		},
		askAgentFn: () => ({ text: "ok" }),
	});

	await session.ask("Hola, soy Ana y vivo en Quito.");
	await session.ask("¿Cómo me llamo?");
	events.length = 0;
	session.contextLimitOverride = 20;
	await session.ask("Gracias");
	await session.ask("¿Y eso?");

	assert.equal(events.filter((event) => event.type === "compaction_start").length, 1);
	const warnings = events.filter((event) => event.type === "context_warning");
	assert.ok(warnings.length >= 2);
	assert.equal(warnings.at(-1).reason, "compaction_cooldown");
	assert.equal(warnings.at(-1).compactionSkipped, true);
});

test("AgentSession: emite grounding cuando la respuesta contradice las fuentes", async () => {
	const { session, events } = makeSession({
		askAgentFn: () => ({
			text: "Quito tiene 3,165 m y el parque es Quito Central Park.",
			usedWeb: true,
			webResults: [{
				title: "Quito",
				snippet: "Quito está a 2.850 metros. Parque Itchimbía.",
			}],
		}),
	});

	await session.ask("busca datos de Quito");

	const grounding = events.find((event) => event.type === "grounding");
	assert.ok(grounding);
	assert.equal(grounding.ok, false);
	assert.ok(grounding.unsupported.includes("3165"));
	assert.ok(grounding.unsupported.some((item) => /Quito Central Park/i.test(item)));
	assert.ok(grounding.sourceChars > 0);
	assert.equal(session.stats().grounding.ok, false);
});

test("AgentSession: eventLevel compact acumula deltas en un solo answer_text", async () => {
	const { session, events } = makeSession({
		eventLevel: "compact",
		askAgentFn: ({ onTextDelta }) => {
			onTextDelta?.("hola", { provider: "fake-session" });
			onTextDelta?.(" mundo", { provider: "fake-session" });
			return { text: "hola mundo" };
		},
	});

	await session.ask("hi");

	assert.equal(events.some((event) => event.type === "answer_delta"), false);
	const answer = events.find((event) => event.type === "answer_text");
	assert.equal(answer.text, "hola mundo");
	assert.equal(answer.streamedChars, "hola mundo".length);
	assert.ok(events.some((event) => event.type === "done"));
});

test("AgentSession: eventLevel compact emite answer_text incluso sin deltas", async () => {
	const { session, events } = makeSession({
		eventLevel: "compact",
		askAgentFn: () => ({ text: "respuesta sin streaming" }),
	});

	await session.ask("hi");

	assert.equal(events.some((event) => event.type === "answer_delta"), false);
	const answer = events.find((event) => event.type === "answer_text");
	assert.ok(answer, "compact mode must always publish the final answer");
	assert.equal(answer.text, "respuesta sin streaming");
	assert.equal(answer.streamedChars, 0);
});

test("AgentSession: calibration.byType learns chars/token per injection type", async () => {
	const { session, events } = makeSession({
		askAgentFn: (_request, turn) => ({
			text: "ok",
			injectedContextChars: 1000,
			injectedContext: { web: 800, documents: 200 },
			usage: {
				prompt_tokens: 500,
				completion_tokens: 5,
				total_tokens: 505,
				context: { estimated: false, used_percent: 10 },
			},
		}),
	});

	await session.ask("hola");

	const web = session.calibration.byType.web;
	const documents = session.calibration.byType.documents;
	assert.equal(web.samples, 1);
	assert.equal(documents.samples, 1);
	assert.ok(web.charsPerToken > 0);
	assert.ok(documents.charsPerToken > 0);
	assert.equal(web.chars, 800);
	assert.equal(documents.chars, 200);
	assert.equal(session.calibration.byType.media.samples, 0);
	assert.equal(session.calibration.byType.tools.samples, 0);

	const done = events.filter((event) => event.type === "done").at(-1);
	assert.ok(done.calibration.byType.web.charsPerToken > 0);
	assert.deepEqual(done.calibration.byType, session.calibration.byType);
});

test("AgentSession: context_overflow se emite cuando el proveedor excede el límite", async () => {
	const { session, events } = makeSession({
		context: { limit: 2000, thresholdPercent: 90 },
		askAgentFn: () => ({
			text: "ok",
			usage: {
				prompt_tokens: 3000,
				completion_tokens: 5,
				total_tokens: 3005,
				context: { estimated: false, used_percent: 187.5 },
			},
		}),
	});

	await session.ask("hola");

	const overflow = events.find((event) => event.type === "context_overflow");
	assert.ok(overflow);
	assert.equal(overflow.usedPercent, 187.5);
	assert.match(overflow.message, /187\.5%/);
});

test("AgentSession: used_percent>100 con prompt dentro del límite no es overflow", async () => {
	const { session, events } = makeSession({
		context: { limit: 2048, thresholdPercent: 90 },
		askAgentFn: () => ({
			text: "ok",
			usage: {
				prompt_tokens: 1428,
				completion_tokens: 700,
				total_tokens: 2128,
				context: { estimated: false, used_percent: 103.91 },
			},
		}),
	});

	await session.ask("hola");

	assert.equal(events.filter((event) => event.type === "context_overflow").length, 0);
});

test("AgentSession: la inyección web se limita al contexto libre de cada turno", async () => {
	const { session, calls } = makeSession({
		context: { limit: 100, thresholdPercent: 90, injectionBudgetRatio: 0.5 },
		askAgentFn: () => ({ text: "ok" }),
		webSearchFn: async () => ({ ok: true, source: "fixture", results: [] }),
	});

	await session.ask("busca datos de Quito", {
		preSearch: "always",
		webSearch: { maxInjectedContextChars: 5000 },
	});

	const configured = calls[0].webSearch?.maxInjectedContextChars;
	assert.ok(configured > 0);
	assert.ok(configured < 5000, "the configured cap must be reduced to the free space");
});

test("resolveEmbeddings: auto-configura Ollama y respeta autoEmbeddings=false", () => {
	const config = {
		provider: { provider: "ollama", baseUrl: "http://127.0.0.1:11434" },
	};

	const auto = resolveEmbeddings({ config });
	assert.equal(auto.configured, true);
	assert.equal(auto.provider, "ollama");
	assert.equal(auto.model, "nomic-embed-text");
	assert.equal(typeof auto.embed, "function");

	const manual = resolveEmbeddings({ config, autoEmbeddings: false });
	assert.equal(manual.configured, false);
	assert.equal(manual.reason, "no embedding configuration");
});

test("compactMessagesWithSummary: keepLastMessages=0 no conserva turnos", async () => {
	const result = await compactMessagesWithSummary({
		messages: [
			{ role: "user", content: "pregunta uno" },
			{ role: "assistant", content: "respuesta uno" },
		],
		keepLastMessages: 0,
	});
	assert.equal(result.length, 1);
	assert.equal(result[0].role, "system");
	assert.match(result[0].content, /pregunta uno/);
});

test("ia.js: el adaptador nativo de Ollama conserva done_reason=length como finish_reason", async () => {
	const {
		OllamaNativeAdapter,
		nativeCompletionFromResponse,
		nativeFinishReason,
		collectOpenAIStream,
	} = __internalIAForTests;

	assert.equal(nativeFinishReason({ done_reason: "length" }), "length");
	assert.equal(nativeFinishReason({ done_reason: "stop" }), "stop");
	assert.equal(nativeFinishReason({ done_reason: "stop" }, true), "tool_calls");
	assert.equal(nativeFinishReason({ done_reason: "length" }, true), "length");

	const truncated = nativeCompletionFromResponse({
		model: "fake:model",
		done_reason: "length",
		message: { content: "respuesta cortada" },
	}, "otro:modelo");
	assert.equal(truncated.choices[0].finish_reason, "length");
	assert.equal(truncated.choices[0].message.content, "respuesta cortada");
	assert.equal(nativeCompletionFromResponse({ done_reason: "stop" }).choices[0].finish_reason, "stop");

	// El stream: la última fila NDJSON llega con done_reason=length.
	const adapter = new OllamaNativeAdapter({
		provider: "ollama",
		model: "fake:model",
		baseUrl: "http://ollama.test:11434",
	});
	const originalFetch = globalThis.fetch;
	const seen = [];
	try {
		globalThis.fetch = async (_url, init) => {
			const body = JSON.parse(init.body);
			seen.push(body);
			if (!body.stream) {
				return new Response(JSON.stringify({
					model: "fake:model",
					message: { content: "parte 1" },
					done: true,
					done_reason: "length",
				}), { status: 200 });
			}
			const ndjson = [
				JSON.stringify({ message: { content: "parte 1" }, done: false }),
				JSON.stringify({ message: { content: "" }, done: true, done_reason: "length" }),
			].join("\n") + "\n";
			return new Response(ndjson, { status: 200 });
		};

		const completion = await adapter.client.chat.completions.create({
			model: "fake:model",
			messages: [{ role: "user", content: "hola" }],
		});
		assert.equal(completion.choices[0].finish_reason, "length");
		assert.equal(completion.choices[0].message.content, "parte 1");

		const stream = adapter.client.chat.completions.create({
			model: "fake:model",
			messages: [{ role: "user", content: "hola" }],
			stream: true,
		});
		const chunks = [];
		for await (const chunk of stream) chunks.push(chunk);
		assert.equal(chunks.at(-1).choices[0].finish_reason, "length");
		assert.equal(chunks[0].choices[0].finish_reason, null);

		const collected = await collectOpenAIStream(chunks, null, { provider: "ollama-native" });
		assert.equal(collected.completion.choices[0].finish_reason, "length");
		assert.equal(collected.completion.choices[0].message.content, "parte 1");
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.equal(seen.length, 2);
	assert.equal(seen[0].model, "fake:model");
});
