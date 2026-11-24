/**
 * Provider token counters used by `AgentSession` in the uncertainty band.
 *
 * `countTokens` receives the same message list that will be sent to the
 * provider before `askAgent()` appends media/document/web recaps. The counter
 * returns the exact token count of those messages; the session adds its own
 * predicted injections on top.
 */

const serializeMessages = (messages = []) => (Array.isArray(messages) ? messages : [])
	.map((message) => {
		const content = typeof message?.content === "string"
			? message.content
			: JSON.stringify(message?.content ?? "");
		return `${message?.role ?? "user"}:\n${content}`;
	})
	.join("\n\n");

/**
 * Exact token count for an Ollama model.
 *
 * Ollama 0.40.x does not expose `/api/tokenize`; in that case we read
 * `prompt_eval_count` from `/api/generate` with `num_predict: 1`, which only
 * tokenizes the prompt and emits a single token.
 *
 * @param {{baseUrl?: string, model?: string, fetchImpl?: Function, timeoutMs?: number}} [options]
 * @returns {(payload?: {messages?: Array, text?: string, model?: string, signal?: AbortSignal}) => Promise<{tokens: number, source: string}>}
 */
export const createOllamaTokenCounter = ({
	baseUrl = "http://localhost:11434",
	model,
	fetchImpl,
	timeoutMs = 15000,
} = {}) => async ({ messages, text, model: modelOverride, signal } = {}) => {
	const targetModel = modelOverride ?? model;
	if (!targetModel) throw new Error("createOllamaTokenCounter requires a model name");
	const prompt = messages ? serializeMessages(messages) : String(text ?? "");
	const doFetch = typeof fetchImpl === "function" ? fetchImpl : (...args) => fetch(...args);
	const requestSignal = signal
		? (typeof AbortSignal.any === "function"
			? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
			: signal)
		: AbortSignal.timeout(timeoutMs);
	const post = (path, body) => doFetch(`${String(baseUrl).replace(/\/$/, "")}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ model: targetModel, ...body }),
		signal: requestSignal,
	});

	const direct = await post("/api/tokenize", { text: prompt });
	if (direct.ok) {
		const data = await direct.json();
		const raw = Array.isArray(data.tokens) ? data.tokens.length : data.tokens;
		const tokens = Number(raw);
		if (!Number.isFinite(tokens)) throw new Error("Ollama tokenize returned no token count");
		return { tokens, source: "tokenize" };
	}
	if (direct.status !== 404) throw new Error(`Ollama tokenize HTTP ${direct.status}`);

	const generated = await post("/api/generate", {
		prompt,
		stream: false,
		options: { num_predict: 1 },
	});
	if (!generated.ok) throw new Error(`Ollama generate HTTP ${generated.status}`);
	const data = await generated.json();
	const tokens = Number(data.prompt_eval_count);
	if (!Number.isFinite(tokens)) throw new Error("Ollama generate returned no prompt_eval_count");
	return { tokens, source: "prompt_eval_count" };
};

export default createOllamaTokenCounter;
