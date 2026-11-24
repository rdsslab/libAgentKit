const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/**
 * @param {string} [baseUrl]
 * @returns {string} Base URL without trailing slashes.
 */
export const normalizeOllamaBaseUrl = (baseUrl) => {
	const raw = String(baseUrl || "http://127.0.0.1:11434").trim();
	return raw.replace(/\/+$/, "");
};

/**
 * Lists installed models through Ollama's `/api/tags` endpoint.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @param {Function} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Array<{name: string, model: string, size: number|null,
 *   modifiedAt: string|null, details: object|null, capabilities: string[],
 *   contextLength: number|null}>>}
 */
export const listOllamaModels = async ({ baseUrl, fetchImpl = globalThis.fetch, signal } = {}) => {
	const url = `${normalizeOllamaBaseUrl(baseUrl)}/api/tags`;
	const res = await (fetchImpl || fetch)(url, { method: "GET", signal });
	if (!res.ok) {
		throw new Error(`Ollama /api/tags failed: HTTP ${res.status}`);
	}
	const data = await res.json().catch(() => ({}));
	const models = Array.isArray(data?.models) ? data.models : [];
	return models.map((m) => ({
		name: m?.name || m?.model || "",
		model: m?.model || m?.name || "",
		size: m?.size ?? null,
		modifiedAt: m?.modified_at || null,
		details: isPlainObject(m?.details) ? m.details : null,
		capabilities: Array.isArray(m?.capabilities) ? m.capabilities : [],
		contextLength: m?.details?.context_length ?? null,
	})).filter((m) => m.name);
};

/**
 * Returns the full `/api/show` payload for a model.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @param {string} [options.model]
 * @param {Function} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>}
 */
export const showOllamaModel = async ({ baseUrl, model, fetchImpl = globalThis.fetch, signal } = {}) => {
	const url = `${normalizeOllamaBaseUrl(baseUrl)}/api/show`;
	const res = await (fetchImpl || fetch)(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model }),
		signal,
	});
	if (!res.ok) {
		throw new Error(`Ollama /api/show failed: HTTP ${res.status}`);
	}
	return res.json().catch(() => ({}));
};
