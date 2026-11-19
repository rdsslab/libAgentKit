/**
 * High-level agent orchestration.
 *
 * `askAgent` is the entry point most callers want:
 *
 *   const result = await askAgent({
 *     provider: { provider: "ollama", model: "llama3.2", baseUrl: "http://host:11434" },
 *     system: "Eres un asistente breve.",
 *     messages: [{ role: "user", content: "Busca el clima en Quito" }],
 *     tools: { web_search: true },
 *   });
 *
 * It adds the pieces `ia.js` does not decide by itself:
 *
 * - deterministic pre-search for small models that refuse to call tools,
 * - local tools (web search, optional document resolver) through `toolHandlers`,
 * - in-memory document text extraction (PDF/DOCX/text) before the model call,
 * - one `{ text, usedWeb, webQuery, webResults, ... }` envelope for every provider.
 *
 * Media helpers (transcription, TTS, frames) are exposed separately in
 * `media.js`: they are not part of every chat turn and must stay opt-in.
 */

import { extractDocumentText } from "./documents.js";
import {
	cleanWebQuery,
	formatWebRecap,
	looksLikeWebQuery,
	short,
	trimWebResults,
} from "./policies.js";
import { webSearch } from "./websearch.js";
import {
	applyCapabilitiesToToolHandlers,
	capabilityDeniedResult,
	defaultCapabilitiesFor,
	normalizeCapabilities,
	resolveToolCapability,
} from "./capabilities.js";
import { listOllamaModels } from "./ollama.js";

const DEFAULT_MAX_TOOL_ROUNDS = 4;
const DEFAULT_MAX_INJECTED_CONTEXT_CHARS = 12000;
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

const userInputUnavailableResult = ({ tool = "request_user_input", message } = {}) => ({
	ok: false,
	error: "user_input_unavailable",
	code: "USER_INPUT_UNAVAILABLE",
	tool,
	message: message || "No hay un manejador de entrada de usuario disponible para responder esta solicitud.",
	userMessage: message || "No hay un manejador de entrada de usuario disponible para responder esta solicitud.",
});

export class AgentError extends Error {
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
 * @param {object} [options.tools] `{ web_search: true, read_document: true, [custom]: {...} }`.
 * @param {object} [options.toolHandlers] Extra local tool handlers (same shape as ia.js).
 * @param {Function} [options.documentResolver] Optional `async ({name,id}) => document` for `read_document`.
 * @param {Array<object>} [options.mcpServers]
 * @param {Function} [options.approveToolCall] Approval hook for the tools of untrusted MCP servers.
 * @param {boolean|"auto"|"always"} [options.preSearch] Deterministic web search before the model.
 * @param {object} [options.webSearch] Options forwarded to `webSearch()` (providers, maxResults...).
 * @param {number} [options.maxToolRounds]
 * @param {boolean} [options.includeDiagnostics]
 * @param {AbortSignal} [options.signal]
 * @param {(delta: string, meta: object) => void} [options.onTextDelta] Optional streaming callback. When absent the provider uses its non-streaming path.
 * @param {(event: object) => void} [options.onToolStart] Optional tool-start notification.
 * @param {(event: object) => void} [options.onToolFinish] Optional tool-finish notification.
 * @returns {Promise<{text: string, usedWeb: boolean, webQuery: string, webResults: Array, webSource: string|null, documents: Array, toolExecutions: Array, diagnostics: object}>}
 */
export const askAgent = async ({
	provider,
	messages,
	prompt,
	system,
	history,
	images,
	documents = [],
	tools = {},
	toolHandlers = {},
	documentResolver,
	mcpServers = [],
	approveToolCall,
	preSearch = "auto",
	webSearch: webSearchOptions = {},
	maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
	includeDiagnostics = false,
	signal,
	capabilities,
	interactive = false,
	mode = "build",
	onUserInputRequest,
	onTextDelta,
	onToolStart,
	onToolFinish,
	onCompactionStart,
	onCompactionEnd,
	onModelLoading,
	onProviderError,
	onMetrics,
	usage = true,
} = {}) => {
	if (!provider) {
		throw new AgentError("askAgent requires a provider configuration.", {
			code: "AGENT_PROVIDER_REQUIRED",
			userMessage: "Falta la configuracion del proveedor de IA.",
		});
	}

	// Notificar al UI que el modelo se está cargando/iniciando
	if (typeof onModelLoading === "function") {
		try { onModelLoading({ provider: provider?.provider || provider?.modelProvider || provider?.name || "desconocido", model: provider?.model || "" }); } catch {}
	}

	const conversation = normalizeMessageList([
		...(Array.isArray(history) ? history : []),
		...(prompt != null ? [{ role: "user", content: prompt }] : []),
		...normalizeMessageList(messages),
	]);

	if (!conversation.length) {
		throw new AgentError("askAgent requires at least one message.", {
			code: "AGENT_MESSAGES_REQUIRED",
			userMessage: "Falta el mensaje del usuario.",
		});
	}

	const promptMessages = [];
	if (system) {
		promptMessages.push({ role: "system", content: String(system) });
	}
	promptMessages.push(...conversation);

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
					message: `Modo Plan: se requiere autorización del usuario para ejecutar "${commandLine || command}", pero no hay un manejador de entrada de usuario disponible.`,
				}),
				capability: "terminal",
			};
		}

		try {
			const response = await requestUserInput({
				id: `plan_run_command_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
				type: "select",
				question: `El agente quiere ejecutar un comando en modo Plan: ${commandLine || command}`,
				description: "En modo Plan, run_command requiere autorización explícita. Las demás restricciones destructivas se mantienen.",
				options: [
					{ label: "Permitir solo este comando", value: "allow_once" },
					{ label: "Permitir run_command para toda la sesión (mantener Plan)", value: "allow_session" },
					{ label: "Denegar", value: "deny" },
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
				message: `Ejecución de comando denegada por el usuario: ${commandLine || command}`,
			});
		} catch (error) {
			return capabilityDeniedResult({
				capability: "terminal",
				tool: "run_command",
				message: `No se pudo solicitar autorización para ejecutar el comando: ${error?.message || error}`,
			});
		}
	};

	// Documents are read before the model call: the sandbox has no filesystem, so
	// a model-driven "read this file" tool would have nothing to open.
	const documentResults = [];
	const documentsAllowed = resolveToolCapability("read_document", caps).allowed && caps.documents !== false;
	if (Array.isArray(documents) && documents.length && documentsAllowed) {
		for (const document of documents) {
			const extracted = await extractDocumentText(document);
			documentResults.push(extracted);
		}

		const recap = truncateInjectedText(
			buildDocumentRecap(documentResults),
			Number(webSearchOptions?.maxInjectedContextChars ?? DEFAULT_MAX_INJECTED_CONTEXT_CHARS),
			"document context",
		);
		if (recap) {
			const merged = appendTextToLastUserMessage(promptMessages, recap);
			promptMessages.length = 0;
			promptMessages.push(...merged);
		}
	}

	// Web search: deterministic pre-search for weak models plus an optional tool.
	const wantsWebTool = Boolean(configuredTools.web_search);
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
	const shouldPreSearch = preSearch === true
		|| preSearch === "always"
		|| (preSearch === "auto" && looksLikeWebQuery(lastUserText))
		|| (isPlainObject(configuredTools.web_search) && configuredTools.web_search.preSearch === true);

	if (shouldPreSearch && lastUserText) {
		webQuery = cleanWebQuery(lastUserText);
		const found = await webSearch({ ...webConfig, query: webQuery, signal });
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
			const merged = appendTextToLastUserMessage(promptMessages, recap);
			promptMessages.length = 0;
			promptMessages.push(...merged);
		}
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
				const query = String(args?.query || "").trim() || lastUserText;
				const found = await webSearch({ ...webConfig, query, signal });
				return {
					...trimWebResults(found, { maxResults: Number(webConfig.maxResults ?? 4) }),
					query,
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
			return capabilityDeniedResult({ capability: "terminal", tool: "run_command", message: "Herramienta run_command inválida." });
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

	// Minimal presentation hooks. They observe the already-secured handlers and
	// never change a tool's verdict, arguments or result.
	const observedHandlers = (() => {
		if (typeof onToolStart !== "function" && typeof onToolFinish !== "function") {
			return securedHandlers;
		}
		const observed = {};
		for (const [name, definition] of Object.entries(securedHandlers)) {
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

	const effectiveMcpServers = caps.mcp === false ? [] : mcpServers;

	// Auto-compactación: si está activada y el contexto supera el umbral, compactar antes de llamar al modelo
	if (caps.autoCompact !== false && caps.compactionThresholdPercent != null) {
		const contextUsage = diagnostics?.context?.used_percent ?? 0;
		if (contextUsage >= caps.compactionThresholdPercent && conversation.length > 2) {
			if (typeof onCompactionStart === "function") {
				try { onCompactionStart({ threshold: caps.compactionThresholdPercent, current: contextUsage }); } catch {}
			}
			try {
				const { compactMessages } = await import("./compaction.js");
				const compacted = await compactMessages({
					messages: conversation,
					strategy: caps.compactionStrategy || "summary",
					keepLastMessages: caps.compactionKeepLastMessages ?? 12,
					summarize: async (toSummarize) => {
						const summaryPrompt = `Summarize this conversation for context continuity. Preserve goals, decisions, constraints, facts, files, commands, results, errors, pending tasks.\n\n` +
							toSummarize.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n");
						const summaryResult = await askAgent({
							provider: effectiveProvider,
							prompt: summaryPrompt,
							system: "You are a concise conversation summarizer.",
							interactive: true,
							capabilities: { terminal: false, web: false, mcp: false, documents: false, artifacts: false, filesystem: false },
							includeDiagnostics: false,
						});
						return summaryResult.text || "";
					},
				});
				conversation.length = 0;
				conversation.push(...compacted);
			} finally {
				if (typeof onCompactionEnd === "function") {
					try { onCompactionEnd({ threshold: caps.compactionThresholdPercent }); } catch {}
				}
			}
		}
	}

	const hasTools = Object.keys(securedHandlers).length > 0;

	// Best-effort: enrich Ollama provider with model context length for metrics.
	let effectiveProvider = provider;
	try {
		const p = isPlainObject(provider) ? provider : (typeof provider === "string" ? { provider } : null);
		const providerName = String(p?.provider || p?.modelProvider || p?.name || "").toLowerCase();
		const hasContextLimit = p && (p.contextLength || p.context_length || p.num_ctx || p.maxContextTokens);
		if (p && providerName.includes("ollama") && !hasContextLimit && p.model) {
			const baseUrl = p.baseUrl || p.baseURL || "http://127.0.0.1:11434";
			const models = await listOllamaModels({ baseUrl, signal }).catch(() => []);
			const match = models.find((m) => m.name === p.model || m.model === p.model);
			if (match?.contextLength) {
				effectiveProvider = { ...p, contextLength: match.contextLength };
			}
		}
	} catch {}

	// The provider layer is loaded on demand: importing the package must not
	// pull the OpenAI/Anthropic/Google/MCP SDKs when the caller only needs the
	// policies, the buffers or the web search. The module instance is the same
	// one the host imported from "@rdsslab/agentkit/ia" (Node caches by URL).
	const { askIAWithProviderMCP } = await import("./ia.js");
	const startTime = Date.now();
	let result;
	try {
		result = await askIAWithProviderMCP({
			provider: effectiveProvider,
			mcpServers: effectiveMcpServers,
			toolHandlers: observedHandlers,
			approveToolCall,
			onTextDelta,
			prompts: promptMessages,
			images,
			maxToolRounds,
			includeDiagnostics: true,
			signal,
		});
	} catch (providerError) {
		if (typeof onProviderError === "function") {
			try { onProviderError({ provider: effectiveProvider?.provider || effectiveProvider?.modelProvider || effectiveProvider?.name || "desconocido", model: effectiveProvider?.model || "", error: providerError?.message || String(providerError), aborted: signal?.aborted === true }); } catch {}
		}
		throw providerError;
	}
	const responseTimeMs = Date.now() - startTime;

	const diagnostics = isPlainObject(result) ? result : { text: String(result ?? "") };
	const text = typeof diagnostics.text === "string" ? diagnostics.text : "";
	const toolExecutionsRaw = Array.isArray(diagnostics.toolExecutions) ? diagnostics.toolExecutions : [];
	const usageInfo = isPlainObject(diagnostics.usage) ? diagnostics.usage : null;

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

	if (!includeDiagnostics) {
		if (typeof onMetrics === "function") {
			try {
				onMetrics({
					responseTimeMs,
					context: diagnostics?.context ?? { used_tokens: 0, limit_tokens: 0, used_percent: 0 },
					usage: usageInfo ?? null,
					tokens: {
						prompt: usageInfo?.prompt_tokens ?? 0,
						completion: usageInfo?.completion_tokens ?? 0,
						total: usageInfo?.total_tokens ?? 0,
					},
					toolExecutions: toolExecutionsRaw.length,
					model: effectiveProvider?.model ?? "",
					providerName: effectiveProvider?.provider || effectiveProvider?.modelProvider || effectiveProvider?.name || "",
				});
			} catch {}
		}
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
			toolExecutions: toolExecutionsRaw.map((execution) => ({
				tool: execution.toolName,
				server: execution.serverName,
				ok: !execution.isError,
				deduplicated: Boolean(execution.deduplicated),
			})),
			hasTools,
			mode: effectiveMode,
			usage: usageInfo,
			...extra,
		};
	}

	if (typeof onMetrics === "function") {
		try {
			onMetrics({
				responseTimeMs,
				context: diagnostics?.context ?? { used_tokens: 0, limit_tokens: 0, used_percent: 0 },
				usage: usageInfo ?? null,
				tokens: {
					prompt: usageInfo?.prompt_tokens ?? 0,
					completion: usageInfo?.completion_tokens ?? 0,
					total: usageInfo?.total_tokens ?? 0,
				},
				toolExecutions: toolExecutionsRaw.length,
				model: effectiveProvider?.model ?? "",
				providerName: effectiveProvider?.provider || effectiveProvider?.modelProvider || effectiveProvider?.name || "",
			});
		} catch {}
	}

	return {
		text,
		usedWeb: finalUsedWeb,
		webQuery: finalWebQuery,
		webResults: finalWebResults,
		webSource: finalWebSource,
		webErrors: finalWebErrors,
		documents: documentResults,
		hasTools,
		mode: effectiveMode,
		usage: usageInfo,
		diagnostics,
		...extra,
	};
};

/** Same as `askAgent` but returns only the assistant text. */
export const askAgentText = async (options = {}) => {
	const result = await askAgent(options);
	return result.text;
};

export default askAgent;
