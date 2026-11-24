/**
 * Stateful, self-compacting conversation session over the stateless `askAgent()`.
 *
 * `askAgent()` is a pure function: every turn must re-send the whole history.
 * `AgentSession` owns that history, searches it when the user asks about the
 * past, and compacts it at 90% of the context window. Every meaningful step is
 * reported through ONE `onEvent({ type, ...data })` callback.
 *
 * Typical use:
 *
 *   const session = new AgentSession({ provider, system, onEvent: (e) => ui(e) });
 *   const r1 = await session.ask("Hola, soy Ana");
 *   const r2 = await session.ask("¿Cómo me llamo?"); // history is internal
 *
 * Events (all include `type`, `at` and `turn`):
 *   context_warning  { reason, usedPercent, estimatedTokens, contextLimit, incomingShare, compactionSkipped, ... }
 *   context_verified { source: "countTokens", exactTokens, usedPercentBefore, usedPercent }
 *   grounding        { ok, unsupported, supported, sourceChars, checked }
 *   compaction_start { reason, usedPercent, estimatedTokens, contextLimit, messagesBefore, preview }
 *   compaction_end   { reason, summaryChars, removedMessages, messagesAfter, usedPercentAfter, indexEpisodes, preview }
 *   recall           { matches, mode, usedEmbeddings, embeddingReason, chars, scores, preview }
 *   thinking         { phase: "request"|"provider", text?, provider, model, ... }
 *   answer_delta     { text, provider, model, round }   (only when streaming is on)
 *   answer_text      { text, chars, streamedChars }     (only with eventLevel: "compact")
 *   tool             { phase: "start"|"finish", tool, server, ok?, durationMs?, ... }
 *   done             { text, chars, provider, model, usage, toolCount, mediaStrategy, ... }
 *   error            { code, message, phase }
 *   reset            { reason }
 */

import {
	askAgent as defaultAskAgent,
	estimateMessagesTokens,
	resolveContextLimit,
	withResolvedContextLimit,
} from "./agent.js";
import { MemoryStore } from "./memory.js";
import { checkGrounding, looksLikeRecall, looksLikeWebQuery, normalizeForMatch, short } from "./policies.js";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const finite = (value, fallback) => {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
};

const messageText = (message) => {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content.map((part) => {
			if (typeof part === "string") return part;
			if (part?.type === "text") return part.text || "";
			return "";
		}).filter(Boolean).join("\n");
	}
	try { return String(content ?? ""); } catch { return ""; }
};

const defaultSummarize = async (messages = []) => messages
	.map((message) => `- ${message?.role || "unknown"}: ${short(messageText(message), 320)}`)
	.join("\n");

const INJECTION_TYPES = ["media", "documents", "web", "tools"];
const DEFAULT_CHARS_PER_TOKEN = { media: 4, documents: 4, web: 2, tools: 2 };

const createEmptyTypeCalibration = () => Object.fromEntries(
	INJECTION_TYPES.map((type) => [type, { samples: 0, chars: 0, tokens: 0, charsPerToken: null }]),
);

/**
 * Stateful conversation session. See the module header for the event contract.
 * The constructor accepts the same options as `askAgent()` plus session-specific
 * `memory`, `context`, `countTokens` and `eventLevel` settings.
 */
export class AgentSession {
	/**
	 * @param {object} [options]
	 * @param {object} options.provider Provider config passed to `askAgent()`.
	 * @param {string} [options.system] System prompt prepended to every turn.
	 * @param {(event: object) => void} [options.onEvent] Receives one event per
	 *   meaningful step (`recall`, `grounding`, `compaction_start`, `done`, ...).
	 * @param {object|MemoryStore} [options.memory] Memory config or an existing store.
	 * @param {object} [options.context] `limit`, `thresholdPercent`, `maxSummaryChars`,
	 *   `injectionBudgetRatio`, `compactionCooldownTurns` and verification band.
	 * @param {(messages: Array, options: object) => Promise<string>} [options.summarize]
	 * @param {Function} [options.countTokens] `async ({text, provider, signal}) => number`.
	 * @param {"full"|"compact"} [options.eventLevel] `compact` buffers deltas into
	 *   one `answer_text` event; `full` is the default.
	 */
	constructor({
		provider,
		system = "",
		onEvent,
		memory = {},
		context = {},
		summarize,
		config,
		configOptions,
		askAgentFn = defaultAskAgent,
		streaming = true,
		countTokens,
		eventLevel = "full",
		...defaults
	} = {}) {
		this.provider = provider;
		this.system = system;
		this.onEvent = typeof onEvent === "function" ? onEvent : null;
		this.defaults = defaults;
		this.askAgentFn = askAgentFn;
		this.streaming = streaming !== false;
		this.summarize = typeof summarize === "function" ? summarize : null;
		this.config = config ?? null;
		this.configOptions = configOptions;

		this.contextOptions = isPlainObject(context) ? context : {};
		this.thresholdPercent = finite(this.contextOptions.thresholdPercent ?? 90, 90);
		this.maxSummaryChars = finite(this.contextOptions.maxSummaryChars ?? 2400, 2400);
		// Histeresis: no compactar dos turnos seguidos salvo que el uso sea
		// extremo. Evita la cascada de compactaciones que vimos con el modelo
		// pequeño cuando un turno largo disparaba el umbral una y otra vez.
		this.compactionCooldownTurns = finite(this.contextOptions.compactionCooldownTurns ?? 2, 2);
		this.urgentCompactionPercent = finite(this.contextOptions.urgentCompactionPercent ?? 150, 150);
		// Banda de incertidumbre: si el estimado cae aquí y hay un contador de
		// tokens del proveedor, se cuenta de verdad ANTES de decidir.
		this.verifyBandStartPercent = finite(
			this.contextOptions.verifyBandStartPercent ?? this.thresholdPercent - 20,
			this.thresholdPercent - 20,
		);
		this.verifyBandEndPercent = finite(
			this.contextOptions.verifyBandEndPercent ?? this.thresholdPercent + 40,
			this.thresholdPercent + 40,
		);
		// Fraction of the free context that may be filled by injected recaps.
		// The rest is reserved for the answer and for other injections (tools,
		// recall) that `askAgent()` appends after this decision.
		this.injectionBudgetRatio = Math.min(1, Math.max(0, finite(
			this.contextOptions.injectionBudgetRatio ?? 0.6,
			0.6,
		)));
		const counter = countTokens ?? this.contextOptions.countTokens;
		this.countTokens = typeof counter === "function" ? counter : null;
		this.eventLevel = eventLevel === "compact" ? "compact" : "full";
		this.contextLimitOverride = finite(
			this.contextOptions.limit ?? this.contextOptions.limitTokens ?? this.contextOptions.contextLength,
			null,
		);

		this.history = [];
		this.turn = 0;
		this.lastCompactionTurn = -Infinity;
		this.lastProviderUsedPercent = null;
		this.grounding = null;
		this.deltaBuffer = "";
		// Nombres de adjuntos vistos en turnos anteriores. El presupuesto del
		// recap de memoria puede recortar el primer turno, pero el filename es
		// la pista más fiable sobre el lugar de una imagen.
		this.entityHints = [];
		// Calibración del tokenizador: `delta = real − local` CON SIGNO. Guardar
		// solo `max(0, delta)` nos impedía aprender que sobreestimamos. `byType`
		// separa media/docs/web/tools porque su coste por carácter es muy
		// distinto (las URLs y el markdown de una búsqueda tokenizan mal).
		this.calibration = {
			samples: 0,
			delta: 0,
			charsPerToken: null,
			imageTokens: null,
			byType: createEmptyTypeCalibration(),
			last: null,
		};
		this.memory = memory instanceof MemoryStore
			? memory
			: new MemoryStore({
				...(isPlainObject(memory) ? memory : {}),
				config: memory?.config ?? config,
				configOptions: memory?.configOptions ?? configOptions,
			});
	}

	/** @returns {string|null} The compacted summary, or null before any compaction. */
	get summary() {
		const summaries = this.history
			.filter((message) => message?.role === "system")
			.map(messageText)
			.filter(Boolean);
		return summaries.length ? summaries.join("\n\n") : null;
	}

	/**
	 * Emits one aggregated event. In `compact` mode, answer deltas and provider
	 * thinking are buffered instead of forwarded.
	 *
	 * @param {string} type Event name.
	 * @param {object} [data] Event payload; `at` and `turn` are added here.
	 * @returns {object} The assembled event.
	 */
	emit(type, data = {}) {
		const event = { type, at: new Date().toISOString(), turn: this.turn, ...data };
		// Los deltas son útiles para la UI en vivo, pero inundan a cualquier
		// consumidor que solo quiere hitos. `eventLevel: "compact"` los acumula
		// y emite un único `answer_text` al terminar. El modo completo sigue
		// siendo el default para no romper integraciones existentes.
		if (this.eventLevel === "compact"
			&& (type === "answer_delta" || (type === "thinking" && data.phase === "provider"))) {
			if (type === "answer_delta" && typeof data.text === "string") this.deltaBuffer += data.text;
			return event;
		}
		if (typeof this.onEvent === "function") {
			try { this.onEvent(event); } catch {}
		}
		return event;
	}

	/** @returns {object} Turn count, history size, memory stats, calibration and last grounding. */
	stats() {
		return {
			turns: this.turn,
			historyMessages: this.history.length,
			memory: this.memory.stats(),
			calibration: { ...this.calibration },
			lastCompactionTurn: Number.isFinite(this.lastCompactionTurn) ? this.lastCompactionTurn : null,
			grounding: this.grounding ? { ok: this.grounding.ok, unsupported: this.grounding.unsupported } : null,
		};
	}

	/**
	 * Resolves the effective provider and its context limit.
	 *
	 * @param {object} provider Provider config.
	 * @param {AbortSignal} [signal]
	 * @returns {Promise<{provider: object, limit: number|null}>}
	 */
	async resolveProviderAndLimit(provider, signal) {
		const enriched = await withResolvedContextLimit(provider, { signal });
		const limit = this.contextLimitOverride ?? resolveContextLimit(enriched);
		return { provider: enriched, limit: finite(limit, null) };
	}

	/**
 * @param {string} type Injection type: `media`, `documents`, `web` or `tools`.
 * @returns {number} Learned chars/token or a conservative default.
 */
	typeCharsPerToken(type) {
		const learned = this.calibration.byType?.[type]?.charsPerToken;
		if (Number.isFinite(learned) && learned > 0) return learned;
		return DEFAULT_CHARS_PER_TOKEN[type] ?? 4;
	}

	/**
	 * Tokens that `estimateMessagesTokens()` cannot see: web/tool recaps,
	 * documents and image buffers are appended later by `askAgent()`.
	 *
	 * @param {string} text Incoming user text.
	 * @param {object} [askOptions] Per-turn `askAgent()` options.
	 * @returns {number} Predicted extra tokens.
	 */
	predictInjectionTokens(text, askOptions = {}) {
		const web = isPlainObject(askOptions.webSearch) ? askOptions.webSearch : {};
		const wantsWeb = askOptions.preSearch === true
			|| askOptions.preSearch === "always"
			|| looksLikeWebQuery(String(text ?? ""))
			|| web.preSearch === true;
		const webChars = wantsWeb ? finite(web.maxInjectedContextChars, 2200) : 0;
		const docChars = Math.min(4000, Array.isArray(askOptions.documents) ? askOptions.documents.length * 1200 : 0);
		const images = (Array.isArray(askOptions.images) ? askOptions.images.length : 0)
			+ (Array.isArray(askOptions.attachments)
				? askOptions.attachments.filter((item) => item?.kind === "image").length
				: 0);
		const imageTokens = Number.isFinite(this.calibration.imageTokens) && this.calibration.imageTokens > 0
			? this.calibration.imageTokens
			: 384;
		return Math.round(webChars / this.typeCharsPerToken("web"))
			+ Math.round(docChars / this.typeCharsPerToken("documents"))
			+ Math.round(images * imageTokens);
	}

	/**
 * @param {string} text Incoming user text.
 * @param {string} [systemText] Effective system prompt.
 * @param {boolean} [includeHistory=true]
 * @returns {number} Estimated tokens of the pre-injection prompt.
 */
	estimatePromptTokens(text, systemText = "", includeHistory = true) {
		const messages = [];
		if (systemText) messages.push({ role: "system", content: systemText });
		if (includeHistory) messages.push(...this.history);
		if (text != null && String(text) !== "") {
			messages.push({ role: "user", content: String(text) });
		}
		return estimateMessagesTokens(messages);
	}

	/**
	 * Estimates prompt usage before asking the model.
	 *
	 * @param {string} text Incoming user text.
	 * @param {string} systemText Effective system prompt.
	 * @param {number|null} limit Context limit.
	 * @param {number} [injectedTokens] Predicted recap/tool injection cost.
	 * @returns {object} `estimatedTokens`, `usedPercent`, `contextLimit` and `injectedTokens`.
	 */
	estimateUsage(text, systemText, limit, injectedTokens = 0) {
		const messages = [];
		if (systemText) messages.push({ role: "system", content: systemText });
		messages.push(...this.history);
		if (text != null && String(text) !== "") {
			messages.push({ role: "user", content: String(text) });
		}
		const injected = Math.max(0, finite(injectedTokens, 0));
		const estimatedTokens = estimateMessagesTokens(messages) + injected;
		const contextLimit = finite(limit, null);
		const usedPercent = contextLimit ? (estimatedTokens / contextLimit) * 100 : 0;
		return {
			estimatedTokens,
			contextLimit,
			usedPercent: Number(usedPercent.toFixed(2)),
			injectedTokens: injected,
			messageCount: messages.length,
		};
	}

	/** Counts the real prompt in the uncertainty band, before compacting. */
	/**
	 * Replaces the heuristic estimate with an exact count when `countTokens` is
	 * configured and the estimate falls in the uncertainty band. Agents should
	 * rely on the `context_verified` event to observe this decision.
	 *
	 * @param {object} options
	 * @param {object} options.usage Previous estimate.
	 * @param {string} options.text Incoming text.
	 * @param {string} options.systemText Effective system prompt.
	 * @param {object} options.provider Provider config.
	 * @param {AbortSignal} [options.signal]
	 * @returns {Promise<object>} The verified or original usage.
	 */
	async verifyUsageWithCounter({ usage, text, systemText, provider, signal }) {
		if (!this.countTokens || !usage.contextLimit) return usage;
		if (usage.usedPercent < this.verifyBandStartPercent || usage.usedPercent > this.verifyBandEndPercent) {
			return usage;
		}
		const messages = [];
		if (systemText) messages.push({ role: "system", content: systemText });
		messages.push(...this.history, { role: "user", content: String(text ?? "") });
		try {
			const counted = await this.countTokens({
				messages,
				text,
				system: systemText,
				provider,
				signal,
			});
			const tokens = finite(counted?.tokens ?? counted, null);
			if (!Number.isFinite(tokens) || tokens < 0) return usage;
			// `countTokens` only sees the messages we build here; `askAgent()`
			// appends recaps afterwards. Dropping `injectedTokens` here made a
			// verified turn look smaller than the prompt the provider receives.
			const injectedTokens = finite(usage.injectedTokens, 0);
			const estimatedTokens = tokens + injectedTokens;
			const usedPercent = Number(((estimatedTokens / usage.contextLimit) * 100).toFixed(2));
			this.emit("context_verified", {
				source: "countTokens",
				estimatedTokensBefore: usage.estimatedTokens,
				usedPercentBefore: usage.usedPercent,
				exactMessageTokens: tokens,
				injectedTokens,
				exactTokens: estimatedTokens,
				usedPercent,
			});
			return { ...usage, estimatedTokens, usedPercent, verified: true };
		} catch (error) {
			this.emit("context_verification_failed", {
				message: error?.message ?? String(error),
				fallback: "heuristic",
			});
			return usage;
		}
	}

	/**
	 * Learns from the provider's `prompt_tokens`. The delta keeps its sign so a
	 * persistent overestimate can be corrected too.
	 */
	recordCalibration({
		delta,
		injectedChars = 0,
		images = 0,
		estimatedByProvider = false,
		injectedContext = {},
	} = {}) {
		const calibration = this.calibration;
		if (!Number.isFinite(delta) || estimatedByProvider) return calibration;
		const previousDelta = calibration.samples ? calibration.delta : delta;
		calibration.delta = Number((0.3 * delta + 0.7 * previousDelta).toFixed(2));
		calibration.samples += 1;
		const breakdown = isPlainObject(injectedContext) ? injectedContext : {};
		const charsByType = Object.fromEntries(INJECTION_TYPES.map((type) => [
			type,
			finite(breakdown[type], 0),
		]));
		const totalChars = INJECTION_TYPES.reduce((sum, type) => sum + charsByType[type], 0);
		const effectiveChars = totalChars > 0 ? totalChars : finite(injectedChars, 0);
		calibration.last = { turn: this.turn, delta, injectedChars: effectiveChars, images, injectedContext: charsByType };

		if (effectiveChars > 0 && delta > 0) {
			const observed = effectiveChars / delta;
			calibration.charsPerToken = calibration.charsPerToken == null
				? observed
				: Number((0.3 * observed + 0.7 * calibration.charsPerToken).toFixed(3));
			// Reparto proporcional por tipo. No es una medición directa, pero
			// evita que una búsqueda con URLs contamine el coste de los documentos.
			for (const type of INJECTION_TYPES) {
				const chars = charsByType[type];
				if (chars <= 0) continue;
				const tokens = (delta * chars) / effectiveChars;
				if (!(tokens > 0)) continue;
				const observedType = chars / tokens;
				const entry = calibration.byType[type];
				entry.charsPerToken = entry.samples === 0
					? observedType
					: Number((0.3 * observedType + 0.7 * entry.charsPerToken).toFixed(3));
				entry.samples += 1;
				entry.chars += chars;
				entry.tokens = Number((entry.tokens + tokens).toFixed(1));
			}
		}
		if (images > 0 && delta > 0) {
			const textChars = charsByType.media > 0 ? charsByType.media : effectiveChars;
			const textTokens = textChars / this.typeCharsPerToken("media");
			const perImage = Math.max(0, (delta - textTokens) / images);
			calibration.imageTokens = calibration.imageTokens == null
				? perImage
				: Number((0.3 * perImage + 0.7 * calibration.imageTokens).toFixed(1));
		}
		return calibration;
	}

	/**
	 * Builds one flat, bounded summary message. Prior summaries are flattened,
	 * never nested, so repeated compactions do not grow without limit.
	 *
	 * @param {object} options
	 * @param {string} [options.text] Incoming turn to include.
	 * @param {Array<object>} options.turns Live history messages.
	 * @param {Array<string>} options.priorSummaries Older summary messages.
	 * @param {Function} [options.summarize] Custom summarizer; falls back to a deterministic one.
	 * @param {AbortSignal} [options.signal]
	 * @returns {Promise<string>} The summary text, capped at `context.maxSummaryChars`.
	 */
	async buildSummary({ text, turns, priorSummaries, summarize, signal }) {
		// Un resumen previo se reutiliza como texto, no como un turno más: si se
		// volviera a resumir aparecería "- user: Resumen anterior..." anidado en
		// cada compactación y el contenido original se perdería en pocos ciclos.
		// Both headers are accepted so summaries produced by older versions are
		// still flattened instead of nested on the next compaction.
		const headerRe = /^(?:Conversation summary \(compacted context\):|Previous summary:|Recent turns:|Resumen de la conversación \(contexto compactado\):|Resumen anterior:|Turnos recientes:)\s*/i;
		const lines = [];
		const seen = new Set();
		const addLines = (value) => {
			for (const raw of String(value || "").split(/\r?\n/)) {
				const line = short(raw.trim(), 360);
				if (!line) continue;
				// El mismo mensaje resumido en dos ciclos cambia solo el final
				// del truncamiento: compara el inicio normalizado para no
				// duplicarlo y que el resumen no crezca sin límite.
				const key = normalizeForMatch(line.slice(0, 100));
				if (seen.has(key)) continue;
				seen.add(key);
				lines.push(line);
			}
		};

		for (const prior of priorSummaries) {
			let cleaned = String(prior);
			// Cabeceras de compactaciones anteriores; se quitan en bucle porque
			// cada ciclo podía añadir una nueva capa.
			for (let pass = 0; pass < 4; pass += 1) {
				const next = cleaned.replace(headerRe, "");
				if (next === cleaned) break;
				cleaned = next;
			}
			addLines(cleaned);
		}

		const source = [
			...turns,
			...(text ? [{ role: "user", content: String(text) }] : []),
		];
		if (source.length) {
			const summarizer = typeof summarize === "function" ? summarize : defaultSummarize;
			let recent = "";
			try {
				recent = String(await summarizer(source, { signal }) || "").trim();
			} catch (error) {
				recent = `[Summary unavailable: ${error?.message || error}]`;
			}
			if (!recent) recent = await defaultSummarize(source);
			addLines(recent);
		}

		// Un único resumen plano y acotado: evita que cada compactación añada
		// secciones ("Resumen anterior" + "Turnos recientes") hasta duplicar
		// el tamaño. Si se excede el presupuesto se descartan las líneas
		// más antiguas, que son las menos útiles para el turno siguiente.
		let total = lines.reduce((sum, line) => sum + line.length + 1, 0);
		let first = 0;
		while (total > this.maxSummaryChars && first < lines.length) {
			total -= lines[first].length + 1;
			first += 1;
		}
		return lines.slice(first).join("\n");
	}

	/**
	 * Replaces the whole live history with one system message holding the
	 * summary, and purges the search index down to that single episode.
	 */
	/**
	 * Replaces live history with a single system message and purges the memory
	 * index down to that summary. Emits `compaction_start`/`compaction_end`.
	 *
	 * @param {object} [options]
	 * @param {string} [options.reason] `context_threshold`, `manual`, etc.
	 * @param {string} [options.text] Incoming turn to preserve in the summary.
	 * @param {string} [options.preview] Short preview for the start event.
	 * @param {object} [options.usage] Usage at the moment compaction was decided.
	 * @param {object} [options.provider]
	 * @param {AbortSignal} [options.signal]
	 * @param {Function} [options.summarize]
	 * @returns {Promise<object>} `{summary, removedMessages, indexEpisodes, usage}`.
	 */
	async runCompaction({ reason, text = "", preview, usage, provider, signal, summarize } = {}) {
		const priorSummaries = this.history
			.filter((message) => message?.role === "system")
			.map(messageText)
			.filter(Boolean);
		const turns = this.history.filter((message) => message?.role !== "system");
		const messagesBefore = this.history.length;
		this.lastCompactionTurn = this.turn;

		this.emit("compaction_start", {
			reason,
			usedPercent: usage?.usedPercent ?? 0,
			estimatedTokens: usage?.estimatedTokens ?? 0,
			contextLimit: usage?.contextLimit ?? null,
			messagesBefore,
			preview: short(String(preview ?? text ?? turns.at(-1)?.content ?? ""), 240),
			message: "Compaction started: only the conversation summary will be kept.",
		});

		const summaryText = await this.buildSummary({
			text,
			turns,
			priorSummaries,
			summarize: summarize ?? this.summarize,
			signal,
		});

		this.history = [{ role: "system", content: `Conversation summary (compacted context):\n${summaryText}` }];
		await this.memory.replaceWithSummary(summaryText, { createdAt: new Date().toISOString() });

		const afterUsage = this.estimateUsage("", this.system, usage?.contextLimit ?? null);
		this.emit("compaction_end", {
			reason,
			summaryChars: summaryText.length,
			removedMessages: messagesBefore,
			archivedTurns: turns.length,
			messagesAfter: this.history.length,
			estimatedTokensAfter: afterUsage.estimatedTokens,
			usedPercentAfter: afterUsage.usedPercent,
			contextLimit: afterUsage.contextLimit,
			indexEpisodes: this.memory.size,
			preview: short(summaryText, 240),
			message: "Compaction finished: the history is now reduced to the summary.",
		});

		return {
			summary: summaryText,
			removedMessages: messagesBefore,
			indexEpisodes: this.memory.size,
			usage: afterUsage,
		};
	}

	/**
	 * Manually compacts the current history.
	 *
	 * @param {object} [options] `reason`, `text`, `provider`, `signal`, `summarize`.
	 * @returns {Promise<object>} The same payload emitted in `compaction_end`.
	 */
	async compact(options = {}) {
		const { provider: providerOverride, signal } = options;
		const provider = providerOverride ?? this.provider;
		const resolved = await this.resolveProviderAndLimit(provider, signal);
		const usage = this.estimateUsage(options.text ?? "", this.system, resolved.limit);
		return this.runCompaction({
			reason: options.reason ?? "manual",
			text: options.text ?? "",
			usage,
			provider: resolved.provider,
			signal,
			summarize: options.summarize,
		});
	}

	/**
	 * Clears history, turn counter and memory index, then emits a `reset` event.
	 *
	 * @param {string} [reason] Why the session was reset.
	 * @returns {void}
	 */
	reset(reason = "manual") {
		this.history = [];
		this.turn = 0;
		this.memory.reset();
		this.emit("reset", { reason, message: "History and memory reset." });
	}

	/**
	 * Processes one turn: optional recall, context compaction, web pre-search,
	 * the model call, grounding and history/memory updates.
	 *
	 * `history`, `prompt`, `messages` and callback options are ignored here,
	 * because the session owns them; all other `askAgent()` options pass through.
	 *
	 * @param {string} text User message.
	 * @param {object} [options]
	 * @param {boolean} [options.recall=true] Search memory before the model call.
	 * @param {object} [options.provider] Per-turn provider override.
	 * @param {boolean|"always"} [options.preSearch] Force deterministic web search.
	 * @param {Array<object>} [options.attachments] Images/documents/audio/video.
	 * @param {AbortSignal} [options.signal]
	 * @returns {Promise<object>} The full `askAgent()` envelope (text, web/tools,
	 *   media, usage, diagnostics). Errors emit an `error` event and are rethrown.
	 */
	async ask(text, options = {}) {
		this.turn += 1;
		const {
			provider: providerOverride,
			system: systemOverride,
			history: _ignoredHistory,
			prompt: _ignoredPrompt,
			messages: _ignoredMessages,
			onEvent: _ignoredOnEvent,
			onTextDelta: _ignoredTextDelta,
			onThinking: _ignoredThinking,
			onToolStart: _ignoredToolStart,
			onToolFinish: _ignoredToolFinish,
			recall = true,
			...askOptions
		} = options;

		try {
			const provider = providerOverride ?? this.provider;
			const resolved = await this.resolveProviderAndLimit(provider, askOptions.signal);
			const baseSystem = [this.system, systemOverride].filter(Boolean).join("\n\n");
			// Cap web injections to the space actually free in this turn. The
			// old fixed limit let a 2k-char recap push the provider past its
			// context window even when the pre-call estimate looked safe.
			const webPrefsForBudget = isPlainObject(askOptions.webSearch) ? askOptions.webSearch : {};
			const wantsWebForBudget = askOptions.preSearch === true
				|| askOptions.preSearch === "always"
				|| looksLikeWebQuery(String(text ?? ""))
				|| webPrefsForBudget.preSearch === true;
			if (wantsWebForBudget && resolved.limit) {
				const messageTokens = this.estimatePromptTokens(text, baseSystem);
				const freeTokens = Math.max(0, resolved.limit - messageTokens);
				const budgetChars = Math.floor(
					freeTokens * this.typeCharsPerToken("web") * this.injectionBudgetRatio,
				);
				const configuredChars = finite(webPrefsForBudget.maxInjectedContextChars, null);
				const cap = Number.isFinite(configuredChars) && configuredChars > 0
					? Math.min(configuredChars, budgetChars)
					: budgetChars;
				if (cap > 0) {
					askOptions.webSearch = { ...webPrefsForBudget, maxInjectedContextChars: cap };
				}
			}
			const predictedInjection = this.predictInjectionTokens(text, askOptions);
			let usage = this.estimateUsage(text, baseSystem, resolved.limit, predictedInjection);
			usage = await this.verifyUsageWithCounter({
				usage,
				text,
				systemText: baseSystem,
				provider: resolved.provider,
				signal: askOptions.signal,
			});

			if (resolved.limit && usage.usedPercent >= this.thresholdPercent) {
				const historyTokens = this.estimatePromptTokens("", baseSystem);
				const incomingTokens = this.estimatePromptTokens(text, "", false);
				const messageTokens = Math.max(1, usage.estimatedTokens - usage.injectedTokens);
				const incomingShare = incomingTokens / messageTokens;
				const thresholdTokens = (resolved.limit * this.thresholdPercent) / 100;
				const coolingDown = (this.turn - this.lastCompactionTurn) < this.compactionCooldownTurns;
				const urgent = usage.usedPercent >= this.urgentCompactionPercent
					|| (this.lastProviderUsedPercent != null && this.lastProviderUsedPercent >= 98);
				// Si el culpables es el turno entrante, compactar el historial
				// apenas libera tokens: avisar pero no destruir el resumen.
				const reason = incomingShare >= 0.7 && incomingTokens >= thresholdTokens * 0.5
					? "incoming_turn_too_large"
					: (coolingDown && !urgent ? null : "context_threshold");

				const shouldCompact = reason === "context_threshold";
				this.emit("context_warning", {
					reason: reason ?? "compaction_cooldown",
					usedPercent: usage.usedPercent,
					estimatedTokens: usage.estimatedTokens,
					contextLimit: resolved.limit,
					thresholdPercent: this.thresholdPercent,
					incomingTokens,
					historyTokens,
					incomingShare: Number(incomingShare.toFixed(2)),
					compactionSkipped: !shouldCompact,
					verified: usage.verified === true,
					preview: short(String(text ?? ""), 240),
					message: reason === "incoming_turn_too_large"
						? "The incoming turn fills most of the context; compacting the history would not help."
						: reason
							? `Context at ${usage.usedPercent}% of the limit (${this.thresholdPercent}%); compacting before the answer.`
							: `Context at ${usage.usedPercent}% of the limit (${this.thresholdPercent}%); compaction postponed by hysteresis.`,
				});

				if (shouldCompact) {
					await this.runCompaction({
						reason,
						// El turno entrante NO va al resumen: se reenvía como prompt y
						// se guardará como turno normal justo después de la respuesta.
						text: "",
						preview: String(text ?? ""),
						usage,
						provider: resolved.provider,
						signal: askOptions.signal,
					});
					usage = this.estimateUsage(text, baseSystem, resolved.limit, predictedInjection);
				}
			}

			let recallSystem = "";
			if (recall && looksLikeRecall(String(text ?? "")) && this.memory.size > 0) {
				const found = await this.memory.search(text, {
					topK: options.memoryTopK,
					budget: options.memoryBudget,
				});
				if (found.results.length > 0 && found.recap) {
					recallSystem = [
						"Memory from previous conversations (use it only if it answers the current question):",
						found.recap,
					].join("\n\n");
					this.emit("recall", {
						matches: found.results.length,
						mode: found.mode,
						usedEmbeddings: found.usedEmbeddings,
						embeddingReason: found.embeddingReason,
						chars: found.recap.length,
						scores: found.scored.map((item) => item.score),
						// `preview` is the head of the whole recap, which may be
						// dominated by one long episode. Per-match previews let a
						// consumer verify that a specific fact was retrieved.
						matchesPreview: found.scored.map((item) => short(messageText(item.episode), 240)),
						preview: short(found.recap, 240),
						message: `Recovered ${found.results.length} previous episodes from memory.`,
					});
				}
			}

			// "Busca datos de lo que viste en la imagen" no nombra el lugar; el
			// recap de memoria aporta los sustantivos propios para la query web.
			let webOptions = askOptions.webSearch;
			const webPrefs = isPlainObject(webOptions) ? webOptions : {};
			const wantsWeb = askOptions.preSearch === true
				|| askOptions.preSearch === "always"
				|| looksLikeWebQuery(String(text ?? ""))
				|| webPrefs.preSearch === true;
			const attachments = Array.isArray(askOptions.attachments) ? askOptions.attachments : [];
			for (const attachment of attachments) {
				const name = String(attachment?.name ?? "");
				if (name && !this.entityHints.includes(name)) this.entityHints.push(name);
			}
			if (wantsWeb && !webPrefs.query && (this.memory.size > 0 || this.entityHints.length)) {
				const contextHit = this.memory.size > 0
					? await this.memory.search(text, { topK: 2, budget: 600 })
					: { recap: "" };
				const contextParts = [...this.entityHints.slice(-4), contextHit.recap].filter(Boolean);
				if (contextParts.length) webOptions = { ...webPrefs, context: contextParts.join("\n") };
			}

			const recallTokens = Math.round(recallSystem.length / 4);
			if (recallTokens) {
				const estimatedTokens = usage.estimatedTokens + recallTokens;
				usage = {
					...usage,
					estimatedTokens,
					usedPercent: usage.contextLimit
						? Number(((estimatedTokens / usage.contextLimit) * 100).toFixed(2))
						: 0,
					injectedTokens: usage.injectedTokens + recallTokens,
				};
			}

			const systemParts = [this.system, systemOverride, recallSystem].filter(Boolean);
			const requestMeta = {
				provider: resolved.provider?.provider ?? resolved.provider?.modelProvider ?? null,
				model: resolved.provider?.model ?? null,
			};

			this.emit("thinking", {
				phase: "request",
				reason: this.streaming ? "streaming_started" : "request_started",
				...requestMeta,
				estimatedTokens: usage.estimatedTokens,
				usedPercent: usage.usedPercent,
				contextLimit: usage.contextLimit,
				injectedTokens: usage.injectedTokens,
				preview: short(String(text ?? ""), 200),
				message: "The model is processing the question.",
			});

			const result = await this.askAgentFn({
				provider: resolved.provider,
				system: systemParts.join("\n\n"),
				history: [...this.history],
				prompt: text,
				autoCompact: false,
				...this.defaults,
				...askOptions,
				...(webOptions !== undefined ? { webSearch: webOptions } : {}),
				onTextDelta: this.streaming
					? (delta, meta) => this.emit("answer_delta", { text: delta, ...(meta || {}) })
					: undefined,
				onThinking: this.streaming
					? (delta, meta) => this.emit("thinking", {
						phase: "provider",
						text: delta,
						...(meta || {}),
					})
					: undefined,
				onToolStart: (event) => this.emit("tool", { phase: "start", ...(event || {}) }),
				onToolFinish: (event) => this.emit("tool", { phase: "finish", ...(event || {}) }),
			});

			const answer = typeof result === "string" ? result : String(result?.text ?? "");
			// ANTES de añadir el turno al historial: si se calcula después, el
			// mensaje entrante se cuenta dos veces y el delta sale negativo.
			const localPromptTokens = this.estimatePromptTokens(text, systemParts.join("\n\n"));
			const providerUsage = isPlainObject(result) ? result.usage ?? null : null;
			const realPromptTokens = finite(providerUsage?.prompt_tokens, null);
			const estimatedByProvider = providerUsage?.context?.estimated === true;
			// Delta CON SIGNO: una sobreestimación también es información útil.
			const observedInjection = realPromptTokens != null && !estimatedByProvider
				? realPromptTokens - localPromptTokens
				: null;
			const injectedChars = finite(result?.injectedContextChars, 0);
			const imageCount = (Array.isArray(result?.media?.processed)
				? result.media.processed.filter((item) => item?.strategy === "native-image").length
				: 0) + (Array.isArray(askOptions.images) ? askOptions.images.length : 0);
			this.recordCalibration({
				delta: observedInjection,
				injectedChars,
				images: imageCount,
				estimatedByProvider,
				injectedContext: result?.injectedContext,
			});
			this.lastProviderUsedPercent = finite(providerUsage?.context?.used_percent, null);
			// Some providers compute `used_percent` over (prompt + reserved
			// completion) tokens, so it can exceed 100% while the prompt itself
			// still fits. Only report an overflow when the real prompt token
			// count also exceeds the known limit (or no limit is known and we
			// have to trust the provider's percentage).
			const promptExceedsLimit = resolved.limit != null
				&& realPromptTokens != null
				&& realPromptTokens > resolved.limit;
			if (this.lastProviderUsedPercent != null
				&& this.lastProviderUsedPercent > 100
				&& (resolved.limit == null || promptExceedsLimit)) {
				this.emit("context_overflow", {
					usedPercent: this.lastProviderUsedPercent,
					promptTokens: realPromptTokens,
					contextLimit: resolved.limit,
					injectedContextChars: injectedChars,
					injectedContext: isPlainObject(result?.injectedContext) ? result.injectedContext : null,
					message: `Provider prompt used ${this.lastProviderUsedPercent}% of the ${resolved.limit}-token context.`,
				});
			}

			this.history.push(
				{ role: "user", content: String(text ?? "") },
				{ role: "assistant", content: answer },
			);
			await this.memory.addTurn(text, answer, {
				createdAt: new Date().toISOString(),
				...requestMeta,
			});

			// Verificación determinista: el modelo pequeño afirmó 3165 m y
			// "Quito Central Park" aunque las fuentes decían 2850 m e Itchimbía.
			this.grounding = checkGrounding({ text: answer, webResults: result?.webResults });
			if (result?.usedWeb) {
				this.emit("grounding", {
					ok: this.grounding.ok,
					unsupported: this.grounding.unsupported,
					supported: this.grounding.supported,
					sourceChars: this.grounding.sourceChars,
					checked: this.grounding.checked,
					coverage: this.grounding.coverage,
					confidence: this.grounding.confidence,
					preview: short(answer, 240),
					message: this.grounding.ok
						? "All figures and proper nouns in the answer appear in the injected sources."
						: `Unsupported by the sources: ${this.grounding.unsupported.join(", ")}`,
				});
			}

			if (this.eventLevel === "compact") {
				// Always emit, even when the provider sent no deltas (non-streaming
				// fallback): a compact-mode consumer must never lose the answer.
				this.emit("answer_text", {
					text: answer,
					chars: answer.length,
					streamedChars: this.deltaBuffer.length,
				});
				this.deltaBuffer = "";
			}

			const afterUsage = this.estimateUsage(
				"",
				systemParts.join("\n\n"),
				resolved.limit,
				usage.injectedTokens,
			);
			this.emit("done", {
				text: answer,
				chars: answer.length,
				...requestMeta,
				usage: providerUsage,
				// El proveedor conoce el prompt real (incluye recap web/tools); nuestra
				// estimación solo ve mensajes. Publicamos ambos para que la UI no
				// subestime el consumo cuando hay inyecciones de contexto.
				providerUsedPercent: this.lastProviderUsedPercent,
				providerTokensEstimated: providerUsage?.context?.estimated ?? null,
				injectedTokens: afterUsage.injectedTokens,
				injectedContextChars: injectedChars,
				observedInjectionTokens: observedInjection,
				calibration: { ...this.calibration },
				grounding: this.grounding.ok === null ? null : {
					ok: this.grounding.ok,
					unsupported: this.grounding.unsupported,
				},
				toolCount: Array.isArray(result?.toolExecutions) ? result.toolExecutions.length : 0,
				mediaStrategy: result?.media?.strategy ?? null,
				estimatedTokens: afterUsage.estimatedTokens,
				usedPercent: afterUsage.usedPercent,
				contextLimit: afterUsage.contextLimit,
				historyMessages: this.history.length,
				preview: short(answer, 240),
			});

			return result;
		} catch (error) {
			this.emit("error", {
				code: error?.code ?? "SESSION_ERROR",
				message: error?.message ?? String(error),
				phase: "ask",
			});
			throw error;
		}
	}
}

/**
 * Factory equivalent to `new AgentSession(options)`.
 *
 * @param {object} [options] Same options as the `AgentSession` constructor.
 * @returns {AgentSession}
 */
export const createAgentSession = (options = {}) => new AgentSession(options);

export default AgentSession;
