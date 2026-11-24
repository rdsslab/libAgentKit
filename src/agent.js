/**
 * High-level agent orchestration.
 *
 * `askAgent` is the entry point most callers want:
 *
 *   const result = await askAgent({
 *     provider: { provider: "ollama", model: "llama3.2", baseUrl: "http://host:11434" },
 *     system: "You are a concise assistant.",
 *     messages: [{ role: "user", content: "Search for the weather in Quito" }],
 *     tools: { web_search: true },
 *   });
 *
 * It adds the pieces `ia.js` does not decide by itself:
 *
 * - deterministic pre-search for small models that refuse to call tools,
 * - local tools (web search, optional document resolver) through `toolHandlers`,
 * - in-memory document text extraction (PDF/DOCX/text) before the model call,
 * - automatic media attachments (images, audio, video, documents) through
 *   `media-context.js`, with STT resolved from effective config and graceful
 *   degradation when no transcription server is available,
 * - one `{ text, usedWeb, webQuery, webResults, media, ... }` envelope for every
 *   provider.
 *
 * Native audio/video is opt-in: if the provider declares it in `media` or
 * `capabilities.media` and its adapter supports it, the bytes are forwarded as
 * native parts; otherwise audio/video degrade to transcript text + JPEG frames.
 */

import { extractDocumentText } from "./documents.js";
import { prepareMediaContext } from "./media-context.js";
import {
	cleanWebQuery,
	formatWebRecap,
	shouldRunPreSearch,
	short,
	trimWebResults,
} from "./policies.js";
import { webSearch } from "./websearch.js";
import {
	applyCapabilitiesToToolHandlers,
	capabilityDeniedResult,
	capabilityEnabled,
	defaultCapabilitiesFor,
	normalizeCapabilities,
	resolveToolCapability,
} from "./capabilities.js";
import { listOllamaModels } from "./ollama.js";
import { compactMessages, shouldAutoCompact } from "./compaction.js";
import { extractCodeBlock, detectRefusal, validateMinimumContent } from "./utils/response-cleaner.js";
import { repararRespuesta } from "./utils/response-repair.js";
import { normalizeToolArguments } from "./utils/tool-arguments.js";

const DEFAULT_MAX_TOOL_ROUNDS = 4;
const DEFAULT_MAX_INJECTED_CONTEXT_CHARS = 12000;
// A model-driven `web_search` result is injected as a tool message. URLs and
// markdown tokenize poorly, so budget 2 chars/token and leave half the free
// context for the answer and for any other tool rounds.
const WEB_TOOL_CHARS_PER_TOKEN = 2;
const WEB_TOOL_INJECTION_RATIO = 0.5;
const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/** Observers are best-effort: a broken UI callback must never break a turn. */
const notify = (callback, event) => {
	if (typeof callback !== "function") return;
	try {
		callback(event);
	} catch {}
};

const truncateInjectedText = (text, maxChars = DEFAULT_MAX_INJECTED_CONTEXT_CHARS, label = "context") => {
	const value = typeof text === "string" ? text : String(text ?? "");
	const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Number(maxChars) : DEFAULT_MAX_INJECTED_CONTEXT_CHARS;
	if (value.length <= limit) return value;
	return `${value.slice(0, limit)}\n\n...[${label} truncated: ${value.length} chars total]`;
};

/**
 * Normaliza las opciones de post-procesamiento. Por defecto NO se modifica el
 * texto devuelto por el modelo: extraer markdown era destructivo en respuestas
 * de chat que incluían ejemplos de código.
 */
const normalizeResponseProcessing = (value, taskType) => {
	const defaults = {
		extractCodeBlocks: false,
		detectRefusal: true,
		validateMinimumContent: true,
		repair: false,
	};

	if (value === true) {
		return { ...defaults, extractCodeBlocks: true };
	}
	if (value === false) {
		return {
			extractCodeBlocks: false,
			detectRefusal: false,
			validateMinimumContent: false,
			repair: false,
		};
	}

	const config = isPlainObject(value) ? value : {};
	return {
		extractCodeBlocks: config.extractCodeBlocks ?? config.extractCode ?? config.stripMarkdown ?? defaults.extractCodeBlocks,
		detectRefusal: config.detectRefusal ?? defaults.detectRefusal,
		validateMinimumContent: config.validateMinimumContent ?? defaults.validateMinimumContent,
		repair: config.repair ?? config.repairResponse ?? defaults.repair,
		language: config.language ?? (["code", "js", "javascript", "html", "css", "web"].includes(taskType) ? taskType : undefined),
	};
};

/**
 * Rough token estimate used only for compaction decisions, never for billing.
 * Counts four characters per token over the serialized messages.
 *
 * @param {Array<object>} [messages] Chat messages in askAgent format.
 * @returns {number} Estimated tokens, or 0 when the input cannot be serialized.
 */
export const estimateMessagesTokens = (messages = []) => {
	try {
		return Math.max(1, Math.ceil(JSON.stringify(messages).length / 4));
	} catch {
		return 0;
	}
};

/**
 * Reads the context window from the common provider aliases.
 *
 * @param {object} config Provider configuration (`contextLength`, `context_length`,
 *   `num_ctx` or `maxContextTokens`).
 * @returns {number|null} Positive token limit, or null when unknown.
 */
export const resolveContextLimit = (config) => {
	const value = Number(
		config?.contextLength
		?? config?.context_length
		?? config?.num_ctx
		?? config?.maxContextTokens,
	);
	return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * Best-effort: enrich an Ollama provider with the real `contextLength` of its
 * model. Exported so `AgentSession` can compute the same 90% threshold without
 * duplicating the discovery logic. Failures (no server, unknown model) leave
 * the provider untouched; callers then degrade to "no known limit".
 *
 * @param {object|string} provider Provider config to enrich.
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<object|string>} The provider, with `contextLength` added when Ollama reports it.
 */
export const withResolvedContextLimit = async (provider, { signal } = {}) => {
	try {
		const p = isPlainObject(provider) ? provider : (typeof provider === "string" ? { provider } : null);
		const providerName = String(p?.provider || p?.modelProvider || p?.name || "").toLowerCase();
		const hasContextLimit = p && (p.contextLength || p.context_length || p.num_ctx || p.maxContextTokens);
		if (p && providerName.includes("ollama") && !hasContextLimit && p.model) {
			const baseUrl = p.baseUrl || p.baseURL || "http://127.0.0.1:11434";
			const models = await listOllamaModels({ baseUrl, signal }).catch(() => []);
			const match = models.find((m) => m.name === p.model || m.model === p.model);
			if (match?.contextLength) {
				return { ...p, contextLength: match.contextLength };
			}
		}
	} catch {}
	return provider;
};

const userInputUnavailableResult = ({ tool = "request_user_input", message } = {}) => ({
	ok: false,
	error: "user_input_unavailable",
	code: "USER_INPUT_UNAVAILABLE",
	tool,
	message: message || "No user-input handler is available to answer this request.",
	userMessage: message || "No user-input handler is available to answer this request.",
});

/**
 * Error thrown by `askAgent()` with a stable machine code and a safe message
 * that can be shown to an end user.
 *
 * @param {string} message Internal diagnostic message.
 * @param {{code?: string, userMessage?: string}} [options]
 */
export class AgentError extends Error {
	/**
	 * @param {string} message Internal diagnostic message.
	 * @param {{code?: string, userMessage?: string}} [options]
	 */
	constructor(message, { code = "AGENT_ERROR", userMessage } = {}) {
		super(message);
		this.name = "AgentError";
		this.code = code;
		this.userMessage = userMessage || message;
	}
}

const normalizeMessageList = (input) => {
	if (input == null) {
		return [];
	}

	const values = Array.isArray(input) ? input : [input];
	const messages = [];

	for (const value of values) {
		if (typeof value === "string") {
			messages.push({ role: "user", content: value });
			continue;
		}
		if (isPlainObject(value) && typeof value.role === "string") {
			messages.push({
				role: value.role,
				content: value.content ?? value.text ?? "",
				...(value.name ? { name: value.name } : {}),
			});
		}
	}

	return messages;
};

const getLastUserText = (messages) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role !== "user") {
			continue;
		}
		const content = messages[index].content;
		if (typeof content === "string") {
			return content;
		}
		if (Array.isArray(content)) {
			return content
				.filter((part) => typeof part === "string" || part?.type === "text")
				.map((part) => (typeof part === "string" ? part : part.text || ""))
				.join("\n");
		}
	}

	return "";
};

const appendTextToLastUserMessage = (messages, text) => {
	if (!text) {
		return messages;
	}

	const output = [...messages];

	for (let index = output.length - 1; index >= 0; index -= 1) {
		if (output[index].role !== "user") {
			continue;
		}
		const content = output[index].content;
		const base = typeof content === "string"
			? content
			: Array.isArray(content)
				? content.filter((part) => part?.type === "text").map((part) => part.text).join("\n")
				: String(content || "");

		output[index] = {
			...output[index],
			content: [base, text].filter(Boolean).join("\n\n"),
		};
		return output;
	}

	output.push({ role: "user", content: text });
	return output;
};

const buildDocumentRecap = (documents) => {
	if (!documents.length) {
		return "";
	}

	const parts = [];

	for (const document of documents) {
		const label = document.fileName || document.mimeType || "documento";
		const pages = document.pages ? `, ${document.pages} pagina(s)` : "";
		parts.push(
			`DOCUMENTO ADJUNTO: ${label} (${document.kind}${pages})`
			+ (document.truncated ? " [texto truncado]" : "")
			+ `\n"""\n${document.text}\n"""`,
		);
	}

	return parts.join("\n\n");
};

const normalizeToolConfig = (tools) => {
	if (!isPlainObject(tools)) {
		return {};
	}

	const normalized = {};

	for (const [name, value] of Object.entries(tools)) {
		if (value === false || value == null) {
			continue;
		}

		if (value === true) {
			normalized[name] = {};
			continue;
		}

		if (typeof value === "function") {
			normalized[name] = { handler: value };
			continue;
		}

		if (isPlainObject(value)) {
			normalized[name] = { ...value };
		}
	}

	return normalized;
};

const trimDocumentForTool = (document, maxChars = 20000) => ({
	ok: true,
	kind: document.kind,
	fileName: document.fileName,
	chars: document.chars,
	truncated: document.truncated || document.text.length > maxChars,
	text: document.text.length > maxChars ? `${document.text.slice(0, maxChars)}\n[...truncado]` : document.text,
});

/**
 * @param {object} options
 * @param {object|string} options.provider Provider config accepted by ia.js (or preset name).
 * @param {Array<{role: string, content: any}>|string} [options.messages]
 * @param {string} [options.prompt] Shorthand for one user message.
 * @param {string} [options.system]
 * @param {Array<{role: string, content: any}>} [options.history] Prior conversation, oldest first.
 * @param {Array<any>} [options.images] Buffers, base64 strings, data URLs or `{mimeType,data}`.
 * @param {Array<any>} [options.documents] In-memory documents; their text is injected into the prompt.
 * @param {Array<object>} [options.attachments] `{kind, data, mimeType, name}` items. Kinds: image, audio, video, document, file.
 * @param {object} [options.media] Media options: `{maxFrames, frameWidth, timeoutMs, language, onError, stt}`. Native audio/video is declared on `provider.media` / `provider.capabilities.media`.
 * @param {object} [options.config] Effective config override; STT is read from `stt` or `media.stt`.
 * @param {object} [options.configOptions] Options forwarded to `loadEffectiveConfig()` when `config` is absent.
 * @param {object} [options.tools] `{ web_search: true, read_document: true, [custom]: {...} }`.
 * @param {object} [options.toolHandlers] Extra local tool handlers (same shape as ia.js).
 * @param {Function} [options.documentResolver] Optional `async ({name,id}) => document` for `read_document`.
 * @param {Array<object>} [options.mcpServers]
 * @param {Function} [options.approveToolCall] Approval hook for the tools of untrusted MCP servers.
 * @param {boolean|"auto"|"always"} [options.preSearch] Deterministic web search before the model.
 * @param {object} [options.webSearch] Options forwarded to `webSearch()` (providers, maxResults...).
 * @param {(options: object) => Promise<object>} [options.webSearchFn] Search injection for tests/CI; receives the merged search config.
 * @param {number} [options.maxToolRounds]
 * @param {boolean} [options.includeDiagnostics]
 * @param {boolean|object} [options.autoCompact] Compact the history before calling the provider.
 * @param {number} [options.compactionThresholdPercent] Default threshold (25).
 * @param {number} [options.compactionKeepLastMessages] Recent messages to keep.
 * @param {boolean|object} [options.responseProcessing] Post-procesamiento opcional de la respuesta.
 * @param {AbortSignal} [options.signal]
 * @param {(delta: string, meta: object) => void} [options.onTextDelta] Optional streaming callback. When absent the provider uses its non-streaming path.
 * @param {(event: object) => void} [options.onToolStart] Optional tool-start notification.
 * @param {(event: object) => void} [options.onToolFinish] Optional tool-finish notification.
 * @param {object} options.provider Provider configuration passed to the IA layer.
 * @param {string} options.provider.provider Provider name ("ollama", "openai-compatible", "anthropic", "google-gemini").
 * @param {string} options.provider.model Model name (e.g., "qwen2.5-coder:3b", "llama3.2:3b").
 * @param {string} options.provider.baseUrl Base URL of the provider (default: "http://127.0.0.1:11434").
 * @param {string} [options.provider.apiKey] API key (optional for Ollama).
 *
 *   ## Generation parameters (optional, passed through to the provider):
 *
 *   - provider.temperature: Sampling temperature (0.0-2.0, default: 0.7)
 *   - provider.top_p: Nucleus sampling probability (0.0-1.0, default: 0.9)
 *   - provider.top_k: Top-k sampling (default: 40)
 *   - provider.repeat_penalty: Repetition penalty (default: 1.1)
 *   - provider.seed: Random seed for deterministic output
 *   - provider.maxTokens / provider.max_tokens: Maximum tokens to generate
 *   - provider.num_ctx / provider.contextLength / provider.context_length / provider.maxContextTokens: Context window size
 *   - provider.toolChoice / provider.tool_choice: Tool choice mode ("auto", "required", "none")
 *
 * Example:
 *
 *   const result = await askAgent({
 *     provider: {
 *       provider: "ollama",
 *       model: "qwen2.5-coder:3b",
 *       baseUrl: "http://127.0.0.1:11434",
 *       temperature: 0.2,
 *       top_p: 0.9,
 *       top_k: 40,
 *       repeat_penalty: 1.1,
 *       seed: 42,
 *       num_ctx: 32768,
 *       maxTokens: 2048,
 *     },
 *     messages: [{ role: "user", content: "Write a JavaScript function" }],
 *   });
 *
 * @returns {Promise<object>} Envelope with `text`, `usedWeb`, `webQuery`,
 *   `webResults`, `webSource`, `webErrors`, `documents`, `media`,
 *   `toolExecutions`, `hasTools`, `mode`, `usage`, `injectedContextChars`,
 *   `injectedContext` and, when requested, `diagnostics`.
 */
export const askAgent = async ({
	provider,
	messages,
	prompt,
	system,
	history,
	images,
	documents = [],
	attachments = [],
	media = {},
	config,
	configOptions,
	tools = {},
	toolHandlers = {},
	documentResolver,
	mcpServers = [],
	approveToolCall,
	preSearch = "auto",
	webSearch: webSearchOptions = {},
	// Inyección opcional para harness/CI: fixtures deterministas sin red.
	webSearchFn,
	maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
	includeDiagnostics = false,
	autoCompact = false,
	compactionThresholdPercent = 25,
	compactionKeepLastMessages = 12,
	compactionStrategy = "summary",
	responseProcessing = false,
	postProcess,
	signal,
	capabilities,
	interactive = false,
	mode = "build",
	onUserInputRequest,
	onTextDelta,
	onThinking,
	onToolStart,
	onToolFinish,
	usage = true,
} = {}) => {
	if (!provider) {
		throw new AgentError("askAgent requires a provider configuration.", {
			code: "AGENT_PROVIDER_REQUIRED",
			userMessage: "The AI provider configuration is missing.",
		});
	}

	// Attachments are prepared before any prompt is assembled. When no STT is
	// configured this returns warnings instead of throwing, and the model still
	// receives frames/images and an explicit note about the missing transcript.
	const mediaContext = await prepareMediaContext({
		attachments,
		images,
		documents,
		provider,
		stt: media?.stt,
		config,
		configOptions,
		media,
		signal,
	});
	const effectiveImages = mediaContext.images;
	const effectiveDocuments = mediaContext.documents;

	const conversation = normalizeMessageList([
		...(mediaContext.history || []),
		...(Array.isArray(history) ? history : []),
		...(prompt != null ? [{ role: "user", content: prompt }] : []),
		...normalizeMessageList(messages),
	]);

	if (!conversation.length) {
		throw new AgentError("askAgent requires at least one message.", {
			code: "AGENT_MESSAGES_REQUIRED",
			userMessage: "The user message is missing.",
		});
	}

	// El system prompt puede venir en el nivel superior, dentro del provider
	// (los presets de harness lo dejan ahí) o como mensajes `system` en el
	// historial. Se consolidan en UN solo mensaje: varios mensajes system
	// consecutivos hacen que algunos chat templates de modelos pequeños
	// devuelvan contenido vacío, además de desperdiciar ventana de contexto.
	const providerObject = isPlainObject(provider) ? provider : null;
	const providerSystem = providerObject?.system ?? providerObject?.systemPrompt;
	const systemParts = [];
	const addSystemPart = (value) => {
		if (value == null) return;
		const text = String(value).trim();
		if (text && !systemParts.includes(text)) systemParts.push(text);
	};
	addSystemPart(system);
	addSystemPart(providerSystem);

	const conversationMessages = [];
	for (const message of conversation) {
		if (message.role === "system") {
			addSystemPart(message.content);
			continue;
		}
		conversationMessages.push(message);
	}

	const promptMessages = [];
	if (systemParts.length) {
		promptMessages.push({ role: "system", content: systemParts.join("\n\n") });
	}
	promptMessages.push(...conversationMessages);

	// Caracteres que `askAgent()` añade DESPUÉS de que la sesión construyera el
	// prompt. El proveedor los cuenta; la estimación local no los ve. Se
	// publican en el envelope para poder calibrar el estimador con datos reales.
	const injectedBreakdown = { media: 0, documents: 0, web: 0, tools: 0 };

	if (mediaContext.promptText) {
		injectedBreakdown.media = mediaContext.promptText.length;
		if (promptMessages.some((message) => message.role === "user")) {
			promptMessages.splice(0, promptMessages.length,
				...appendTextToLastUserMessage(promptMessages, mediaContext.promptText));
		} else {
			promptMessages.push({ role: "user", content: mediaContext.promptText });
		}
	}

	const configuredTools = normalizeToolConfig(tools);
	const handlers = { ...toolHandlers };

	const effectiveMode = String(mode || "build").toLowerCase() === "plan" ? "plan" : "build";
	let caps = normalizeCapabilities(capabilities, { interactive });
	// Mode is both preset and restriction. Plan blocks destructive actions.
	if (effectiveMode === "plan") {
		caps = {
			...caps,
			artifacts: false,
			filesystem: isPlainObject(caps.filesystem) ? { ...caps.filesystem, enabled: false, write: false } : false,
			mode: "plan",
		};
	}

	let planAllowRunCommandForSession = false;
	const requestUserInput = typeof onUserInputRequest === "function" ? onUserInputRequest : null;

	const requestPlanRunCommandAuthorization = async ({ command, args, cwd, binary }) => {
		const commandLine = [command, ...(Array.isArray(args) ? args : [])].map((v) => String(v)).join(" ").trim();
		if (!requestUserInput) {
			return {
				...userInputUnavailableResult({
					tool: "run_command",
					message: `Plan mode: user authorization is required to run "${commandLine || command}", but no user-input handler is available.`,
				}),
				capability: "terminal",
			};
		}

		try {
			const response = await requestUserInput({
				id: `plan_run_command_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
				type: "select",
				question: `The agent wants to run a command in Plan mode: ${commandLine || command}`,
				description: "In Plan mode, run_command requires explicit authorization. All other destructive restrictions still apply.",
				options: [
					{ label: "Allow this command only", value: "allow_once" },
					{ label: "Allow run_command for the whole session (stay in Plan mode)", value: "allow_session" },
					{ label: "Deny", value: "deny" },
				],
				required: true,
				context: { mode: "plan", tool: "run_command", command, args, cwd, binary },
			});

			const value = isPlainObject(response) ? (response.value ?? response.answer ?? response) : response;
			if (value === "allow_session") {
				planAllowRunCommandForSession = true;
				return { authorized: true, scope: "session" };
			}
			if (value === "allow_once") {
				return { authorized: true, scope: "once" };
			}
			return capabilityDeniedResult({
				capability: "terminal",
				tool: "run_command",
				message: `Command execution denied by the user: ${commandLine || command}`,
			});
		} catch (error) {
			return capabilityDeniedResult({
				capability: "terminal",
				tool: "run_command",
				message: `Could not request authorization to run the command: ${error?.message || error}`,
			});
		}
	};

	// Documents are read before the model call: the sandbox has no filesystem, so
	// a model-driven "read this file" tool would have nothing to open.
	const documentResults = [];
	const documentsAllowed = resolveToolCapability("read_document", caps).allowed && caps.documents !== false;
	if (effectiveDocuments.length && documentsAllowed) {
		for (const document of effectiveDocuments) {
			const extracted = await extractDocumentText(document);
			documentResults.push(extracted);
		}

		const recap = truncateInjectedText(
			buildDocumentRecap(documentResults),
			Number(webSearchOptions?.maxInjectedContextChars ?? DEFAULT_MAX_INJECTED_CONTEXT_CHARS),
			"document context",
		);
		if (recap) {
			injectedBreakdown.documents = recap.length;
			const merged = appendTextToLastUserMessage(promptMessages, recap);
			promptMessages.length = 0;
			promptMessages.push(...merged);
		}
	}

	// Web search: deterministic pre-search for weak models plus an optional tool.
	const wantsWebTool = Boolean(configuredTools.web_search);
	const runWebSearch = typeof webSearchFn === "function" ? webSearchFn : webSearch;
	const webConfig = {
		...webSearchOptions,
		...(isPlainObject(configuredTools.web_search) ? configuredTools.web_search : {}),
	};

	let usedWeb = false;
	let webQuery = "";
	let webResults = [];
	let webSource = null;
	let webErrors = [];

	const lastUserText = getLastUserText(conversation);
	const webAllowed = resolveToolCapability("web_search", caps).allowed;
	const shouldPreSearch = shouldRunPreSearch({
		preSearch,
		lastUserText,
		webAllowed,
		webSearchConfig: configuredTools.web_search,
	});

	if (shouldPreSearch && lastUserText) {
		// An explicit query wins; otherwise focus the verbose instruction using
		// proper nouns from the memory recap supplied by AgentSession.
		const explicitQuery = typeof webConfig.query === "string" ? webConfig.query.trim() : "";
		webQuery = explicitQuery || cleanWebQuery(lastUserText, { context: webConfig.context });
		const found = await runWebSearch({ ...webConfig, query: webQuery, signal });
		webResults = found.results || [];
		webSource = found.source;
		webErrors = found.errors || [];
		usedWeb = Boolean(found.ok && webResults.length);

		const recap = usedWeb
			? truncateInjectedText(
				formatWebRecap(found),
				Number(webConfig.maxInjectedContextChars ?? DEFAULT_MAX_INJECTED_CONTEXT_CHARS),
				"web search context",
			)
			: "";
		if (recap) {
			injectedBreakdown.web = recap.length;
			const merged = appendTextToLastUserMessage(promptMessages, recap);
			promptMessages.length = 0;
			promptMessages.push(...merged);
		}
	}

	// Bound the text the model sees after a model-driven web_search call. The
	// raw object is still returned (the envelope reads `ok/results/source` from
	// it); adding `content` makes ia.js format that short recap instead of the
	// whole unpaginated JSON payload.
	const configuredWebChars = Number(webConfig.maxInjectedContextChars ?? webConfig.maxResultChars);
	let webToolBudgetChars = Number.isFinite(configuredWebChars) && configuredWebChars > 0
		? configuredWebChars
		: DEFAULT_MAX_INJECTED_CONTEXT_CHARS;
	const webContextLimit = resolveContextLimit(providerObject);
	if (webContextLimit) {
		const promptTokens = estimateMessagesTokens(promptMessages);
		const freeTokens = Math.max(0, webContextLimit - promptTokens);
		const freeChars = Math.floor(freeTokens * WEB_TOOL_CHARS_PER_TOKEN * WEB_TOOL_INJECTION_RATIO);
		webToolBudgetChars = freeChars > 0
			? Math.min(webToolBudgetChars, freeChars)
			: Math.min(webToolBudgetChars, 600);
	}

	if (wantsWebTool && resolveToolCapability("web_search", caps).allowed) {
		handlers.web_search = {
			description: "Search the web and return titles, URLs and snippets. Use it when the answer needs current or external information.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "Search query." },
				},
				required: ["query"],
				additionalProperties: false,
			},
			policy: { oneShot: true },
			handler: async (args) => {
				const query = String(normalizeToolArguments(args).query || "").trim() || lastUserText;
				const found = await runWebSearch({ ...webConfig, query, signal });
				const trimmed = trimWebResults(found, { maxResults: Number(webConfig.maxResults ?? 4) });
				return {
					...trimmed,
					query,
					content: truncateInjectedText(
						formatWebRecap(trimmed),
						webToolBudgetChars,
						"web tool result",
					),
				};
			},
		};
	}

	if (documentResolver && configuredTools.read_document !== false && resolveToolCapability("read_document", caps).allowed) {
		handlers.read_document = {
			description: "Read an attached document by name or id and return its plain text.",
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string", description: "Document name or id." },
				},
				required: ["name"],
				additionalProperties: false,
			},
			policy: { oneShot: true },
			handler: async (args) => {
				const source = await documentResolver({ name: args?.name, id: args?.id });
				const extracted = await extractDocumentText(source);
				return trimDocumentForTool(extracted);
			},
		};
	}

	// Standard agent↔user form/input request mechanism.
	// Exposed when a handler is available, or when explicitly requested via tools config.
	const wantsRequestUserInput = configuredTools.request_user_input === true
		|| (configuredTools.request_user_input !== false && typeof requestUserInput === "function");
	if (wantsRequestUserInput) {
		handlers.request_user_input = {
			description: "Request structured input from the user (text, select, multiselect, confirmation). Use when you need a decision or missing information.",
			inputSchema: {
				type: "object",
				properties: {
					question: { type: "string", description: "Question to show the user." },
					description: { type: "string", description: "Additional context." },
					type: { type: "string", enum: ["text", "select", "multiselect", "confirm"], description: "Input type." },
					options: {
						type: "array",
						items: {
							type: "object",
							properties: {
								label: { type: "string" },
								value: { type: "string" },
							},
							required: ["label", "value"],
							additionalProperties: true,
						},
					},
					multiple: { type: "boolean" },
					required: { type: "boolean" },
				},
				required: ["question"],
				additionalProperties: true,
			},
			handler: async (args) => {
				if (typeof requestUserInput !== "function") {
					return userInputUnavailableResult();
				}
				const req = {
					id: `user_input_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
					question: String(args?.question || "Input required"),
					description: args?.description ? String(args.description) : "",
					type: String(args?.type || "text"),
					options: Array.isArray(args?.options) ? args.options : [],
					multiple: Boolean(args?.multiple),
					required: args?.required !== false,
				};
				if (req.type === "confirm" && req.options.length === 0) {
					req.options = [
						{ label: "Yes", value: "yes" },
						{ label: "No", value: "no" },
					];
					req.type = "select";
				}
				try {
					const response = await requestUserInput(req);
					return { ok: true, request: req, response };
				} catch (error) {
					return { ok: false, error: "user_input_failed", code: "USER_INPUT_FAILED", message: String(error?.message || error) };
				}
			},
		};
	}

	for (const [name, definition] of Object.entries(configuredTools)) {
		if (name === "web_search" || name === "read_document") {
			continue;
		}
		if (isPlainObject(definition) && typeof (definition.handler ?? definition.run ?? definition.execute) === "function") {
			handlers[name] = definition;
		}
	}

	// Wrap run_command for Plan mode authorization flow and capability checks.
	if (handlers.run_command) {
		const original = handlers.run_command;
		const callOriginal = async (args) => {
			if (typeof original === "function") return original(args);
			const fn = original?.handler ?? original?.run ?? original?.execute;
			if (typeof fn === "function") return fn(args);
			return capabilityDeniedResult({ capability: "terminal", tool: "run_command", message: "Invalid run_command tool." });
		};
		const wrapped = async (args) => {
			const verdict = resolveToolCapability("run_command", caps);
			if (!verdict.allowed) {
				return capabilityDeniedResult({ capability: verdict.capability, tool: "run_command" });
			}

			if (effectiveMode === "plan" && !planAllowRunCommandForSession) {
				const auth = await requestPlanRunCommandAuthorization({
					command: args?.command,
					args: args?.args,
					cwd: args?.cwd,
				});
				if (auth && auth.authorized === true) {
					return callOriginal(args);
				}
				return auth;
			}

			return callOriginal(args);
		};
		if (typeof original === "function") {
			handlers.run_command = wrapped;
		} else if (isPlainObject(original)) {
			handlers.run_command = { ...original, handler: wrapped };
		}
	}

	// Apply generic capability enforcement to all handlers.
	const securedHandlers = applyCapabilitiesToToolHandlers(handlers, caps);

	// Defensa en profundidad: el proveedor ya normaliza los argumentos, pero
	// los handlers inyectados por el llamador también deben recibir valores limpios.
	const normalizedHandlers = Object.fromEntries(
		Object.entries(securedHandlers).map(([name, definition]) => {
			const fn = typeof definition === "function"
				? definition
				: (definition?.handler ?? definition?.run ?? definition?.execute);
			if (typeof fn !== "function") return [name, definition];
			const normalized = async (args, context) => fn(normalizeToolArguments(args), context);
			return [name, typeof definition === "function" ? normalized : { ...definition, handler: normalized }];
		}),
	);

	// Minimal presentation hooks. They observe the already-secured handlers and
	// never change a tool's verdict, arguments or result.
	const observedHandlers = (() => {
		if (typeof onToolStart !== "function" && typeof onToolFinish !== "function") {
			return normalizedHandlers;
		}
		const observed = {};
		for (const [name, definition] of Object.entries(normalizedHandlers)) {
			const fn = typeof definition === "function"
				? definition
				: (definition?.handler ?? definition?.run ?? definition?.execute);
			if (typeof fn !== "function") {
				observed[name] = definition;
				continue;
			}
			const base = { tool: name, server: definition?.serverName || "local" };
			const wrapped = async (args, context) => {
				const startedAt = Date.now();
				notify(onToolStart, { ...base, arguments: args });
				try {
					const result = await fn(args, context);
					notify(onToolFinish, {
						...base,
						arguments: args,
						ok: result?.ok !== false && result?.isError !== true,
						durationMs: Date.now() - startedAt,
						result,
					});
					return result;
				} catch (error) {
					notify(onToolFinish, {
						...base,
						arguments: args,
						ok: false,
						durationMs: Date.now() - startedAt,
						error,
					});
					throw error;
				}
			};
			observed[name] = typeof definition === "function"
				? wrapped
				: { ...definition, handler: wrapped };
		}
		return observed;
	})();

	const effectiveMcpServers = capabilityEnabled(caps, "mcp") ? mcpServers : [];

	const hasTools = Object.keys(securedHandlers).length > 0;

	// Best-effort: enrich Ollama provider with model context length for metrics.
	const effectiveProvider = await withResolvedContextLimit(provider, { signal });

	// Compactación opcional del historial. Se decide ANTES de la llamada para
	// que el proveedor reciba realmente menos mensajes (no solo un diagnóstico).
	let compactionInfo = null;
	if (autoCompact) {
		const compactConfig = autoCompact === true ? {} : (isPlainObject(autoCompact) ? autoCompact : {});
		const thresholdPercent = Number(
			compactConfig.thresholdPercent ?? compactionThresholdPercent ?? 25,
		);
		const contextLimit = resolveContextLimit(effectiveProvider);
		const estimatedTokens = estimateMessagesTokens(promptMessages);
		const usedPercent = contextLimit ? (estimatedTokens / contextLimit) * 100 : 0;

		if (shouldAutoCompact({ context: { used_percent: usedPercent } }, thresholdPercent)) {
			const before = promptMessages.length;
			const compacted = await compactMessages({
				messages: promptMessages,
				strategy: compactConfig.strategy ?? compactionStrategy,
				keepLastMessages: Number(
					compactConfig.keepLastMessages ?? compactionKeepLastMessages ?? 12,
				),
				summarize: compactConfig.summarize,
			});
			promptMessages.length = 0;
			promptMessages.push(...compacted);
			compactionInfo = {
				triggered: true,
				thresholdPercent,
				contextLimit,
				estimatedTokens,
				usedPercent: Number(usedPercent.toFixed(2)),
				before,
				after: promptMessages.length,
				strategy: compactConfig.strategy ?? compactionStrategy,
			};
		} else {
			compactionInfo = {
				triggered: false,
				thresholdPercent,
				contextLimit,
				estimatedTokens,
				usedPercent: Number(usedPercent.toFixed(2)),
				before: promptMessages.length,
				after: promptMessages.length,
			};
		}
	}

	// The provider layer is loaded on demand: importing the package must not
	// pull the OpenAI/Anthropic/Google/MCP SDKs when the caller only needs the
	// policies, the buffers or the web search. The module instance is the same
	// one the host imported from "@rdsslab/agentkit/ia" (Node caches by URL).
	const { askIAWithProviderMCP } = await import("./ia.js");
	const result = await askIAWithProviderMCP({
		provider: effectiveProvider,
		mcpServers: effectiveMcpServers,
		toolHandlers: observedHandlers,
		approveToolCall,
		onTextDelta,
		onThinking,
		prompts: promptMessages,
		images: effectiveImages,
		audio: mediaContext.audio,
		video: mediaContext.video,
		maxToolRounds,
		includeDiagnostics,
		signal,
	});

	const diagnostics = isPlainObject(result) ? result : { text: String(result ?? "") };
	let text = typeof diagnostics.text === "string" ? diagnostics.text : "";
	const toolExecutionsRaw = Array.isArray(diagnostics.toolExecutions) ? diagnostics.toolExecutions : [];
	const usageInfo = isPlainObject(diagnostics.usage) ? diagnostics.usage : null;
	injectedBreakdown.tools = toolExecutionsRaw.reduce(
		(sum, execution) => sum + String(execution?.textResult ?? "").length,
		0,
	);
	const injectedContextChars = Object.values(injectedBreakdown).reduce((sum, value) => sum + value, 0);

	// Post-procesamiento OPCIONAL: extraer markdown solo cuando se pide
	// explícitamente (típicamente tareas de código/web). En chat se conserva
	// el texto original aunque contenga bloques de código legítimos.
	const taskType = _inferTaskTypeFromPrompt(promptMessages);
	const processing = normalizeResponseProcessing(
		postProcess ?? responseProcessing,
		taskType,
	);
	if (text) {
		// Reparación determinista y genérica: cerrar cercos, quitar envolventes
		// y recortar bucles de repetición antes de extraer código. No cambia el
		// significado de la respuesta y evita gastar un reintento del modelo.
		if (processing.repair) {
			const reparado = repararRespuesta(text, { language: processing.language ?? taskType });
			text = reparado.text;
			if (isPlainObject(diagnostics)) {
				if (reparado.reparaciones.length) diagnostics.reparacionesAplicadas = reparado.reparaciones;
				if (reparado.truncado) diagnostics.respuestaTruncada = reparado.senales;
			}
		}

		if (processing.extractCodeBlocks) {
			const cleaned = extractCodeBlock(text, processing.language ?? taskType);
			if (cleaned && cleaned.length > 0) {
				text = cleaned;
			}
		}

		const refusal = processing.detectRefusal ? detectRefusal(text, taskType) : { refused: false };
		if (refusal.refused) {
			if (isPlainObject(diagnostics)) {
				diagnostics.modelRefusal = true;
				diagnostics.refusalReason = refusal.reason;
			}
		} else if (refusal.reason) {
			if (isPlainObject(diagnostics)) {
				diagnostics.contentContamination = refusal.reason;
			}
		}

		if (processing.validateMinimumContent) {
			const minContent = validateMinimumContent(text, 20);
			if (!minContent.valid) {
				if (isPlainObject(diagnostics)) {
					diagnostics.incompleteContent = true;
					diagnostics.incompleteReason = minContent.reason;
				}
			}
		}
	}

	let finalUsedWeb = usedWeb;
	let finalWebQuery = webQuery;
	let finalWebResults = webResults;
	let finalWebSource = webSource;
	let finalWebErrors = webErrors;

	const webExecution = [...toolExecutionsRaw]
		.reverse()
		.find((execution) => (execution.toolName === "web_search" || execution.toolAlias === "web_search") && !execution.isError);

	if (webExecution) {
		const executionResult = isPlainObject(webExecution.rawResult)
			? webExecution.rawResult
			: (() => {
				try {
					return JSON.parse(String(webExecution.textResult || "{}"));
				} catch {
					return {};
				}
			})();

		const queryFromArgs = isPlainObject(webExecution.arguments) && typeof webExecution.arguments.query === "string"
			? webExecution.arguments.query.trim()
			: "";
		const queryFromResult = typeof executionResult.query === "string" ? executionResult.query.trim() : "";
		const executionResults = Array.isArray(executionResult.results) ? executionResult.results : [];

		finalUsedWeb = finalUsedWeb || Boolean(executionResult.ok && executionResults.length);
		if (!finalWebQuery && (queryFromArgs || queryFromResult)) {
			finalWebQuery = queryFromArgs || queryFromResult;
		}
		if (!finalWebSource && typeof executionResult.source === "string") {
			finalWebSource = executionResult.source;
		}
		if (!finalWebResults.length && executionResults.length) {
			finalWebResults = executionResults;
		}
		if (!finalWebErrors.length && Array.isArray(executionResult.errors)) {
			finalWebErrors = executionResult.errors;
		}
	}

	const extra = {};
	for (const key of ["incomplete", "reason", "stoppedAfterToolSuccess", "automaticToolFallbackUsed", "assistantDumpedToolCatalog", "lowConfidenceWebRetryUsed"]) {
		if (diagnostics[key] != null) extra[key] = diagnostics[key];
	}
	if (compactionInfo) {
		extra.compaction = compactionInfo;
	}

	if (!includeDiagnostics) {
		return {
			text,
			usedWeb: finalUsedWeb,
			webQuery: finalWebQuery,
			webResults: finalWebResults,
			webSource: finalWebSource,
			webErrors: finalWebErrors,
			documents: documentResults.map((document) => ({
				kind: document.kind,
				fileName: document.fileName,
				chars: document.chars,
				pages: document.pages,
				truncated: document.truncated,
			})),
			media: mediaContext.media,
			toolExecutions: toolExecutionsRaw.map((execution) => ({
				tool: execution.toolName,
				server: execution.serverName,
				ok: !execution.isError,
				deduplicated: Boolean(execution.deduplicated),
			})),
			hasTools,
			mode: effectiveMode,
			usage: usageInfo,
			injectedContextChars,
			injectedContext: injectedBreakdown,
			...extra,
		};
	}

	return {
		text,
		usedWeb: finalUsedWeb,
		webQuery: finalWebQuery,
		webResults: finalWebResults,
		webSource: finalWebSource,
		webErrors: finalWebErrors,
		documents: documentResults,
		media: mediaContext.media,
		hasTools,
		mode: effectiveMode,
		usage: usageInfo,
		injectedContextChars,
		injectedContext: injectedBreakdown,
		diagnostics,
		...extra,
	};
};

/**
 * Infiere el tipo de tarea a partir de los mensajes del prompt.
 * Se usa para aplicar post-procesamiento específico (ej. limpiar bloques de código).
 *
 * @param {Array<{role: string, content: any}>} prompts
 * @returns {string} "code", "web", "html", "css", "js", "chat" u otro
 */
function _inferTaskTypeFromPrompt(prompts = []) {
	const lastUser = [...prompts].reverse().find((m) => m.role === 'user');
	if (!lastUser) return 'chat';
	const content = typeof lastUser.content === 'string' ? lastUser.content : String(lastUser.content ?? '');
	const lower = content.toLowerCase();

	if (/landing page|html5|<html|<body|<header|<form/i.test(lower)) return 'html';
	if (/css\b|stylesheet|:hover|@media|background-color/i.test(lower)) return 'css';
	if (/javascript\b|addEventListener|getElementById|function\s+\w+/i.test(lower)) return 'js';
	if (/escribe una función|código|script|programa|algoritmo/i.test(lower)) return 'code';
	return 'chat';
}

/**
 * Convenience wrapper around `askAgent()`.
 *
 * @param {object} [options] Same options as `askAgent()`.
 * @returns {Promise<string>} Only the assistant answer; diagnostics, web results
 *   and tool executions are discarded. Use `askAgent()` when an agent needs them.
 */
export const askAgentText = async (options = {}) => {
	const result = await askAgent(options);
	return result.text;
};

export default askAgent;
