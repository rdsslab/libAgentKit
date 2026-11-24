/**
 * In-memory conversation memory with hybrid (lexical + embeddings) recall.
 *
 * `AgentSession` owns the live `history` that is re-sent to the model on every
 * turn. This store is a SEPARATE, searchable index of "episodes" (a user turn
 * plus its answer, or a compaction summary). It exists so that a recall like
 * "¿recuerdas el auto azul que te mostré?" can find the right turn even after
 * the live history has been compacted down to a single summary message.
 *
 * Design rules:
 * - Lexical search always works: accents are stripped with `normalizeForMatch`.
 * - Embeddings are optional. If no provider is configured, or a request fails,
 *   search degrades to lexical and reports why (`embeddingReason`).
 * - Embedding config comes from the constructor first, then from the effective
 *   config (`emb.providers`, `embeddings.providers`, `memory.embeddings`).
 * - With an Ollama provider and no explicit config, a local
 *   `nomic-embed-text` embedder is configured automatically (disable with
 *   `autoEmbeddings: false`). A failing request still degrades to lexical.
 * - `env:VAR` secret references are resolved with `resolveConfigSecrets`.
 */

import { loadEffectiveConfig, resolveConfigSecrets } from "./config.js";
import { formatHistoryRecap, normalizeForMatch, short } from "./policies.js";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const tokenize = (value) => normalizeForMatch(value).match(/[a-z0-9]+/g) || [];

const cosine = (a = [], b = []) => {
	if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i += 1) {
		const x = Number(a[i]) || 0;
		const y = Number(b[i]) || 0;
		dot += x * y;
		normA += x * x;
		normB += y * y;
	}
	if (!normA || !normB) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const lexicalScore = (query, document) => {
	const q = tokenize(query);
	const d = tokenize(document);
	if (!q.length || !d.length) return 0;
	const querySet = new Set(q);
	const docSet = new Set(d);
	let hits = 0;
	for (const token of querySet) if (docSet.has(token)) hits += 1;
	const overlap = hits / Math.sqrt(querySet.size * Math.max(1, docSet.size));
	const cleanQuery = normalizeForMatch(query).slice(0, 120);
	const phrase = cleanQuery.length >= 8 && normalizeForMatch(document).includes(cleanQuery) ? 0.25 : 0;
	return Math.min(1, overlap + phrase);
};

const recencyScore = (index, total) => (
	total <= 1 ? 1 : 0.5 + 0.5 * (index / (total - 1))
);

const postJson = async ({ url, headers = {}, body, fetchImpl, signal }) => {
	const implementation = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
	if (typeof implementation !== "function") throw new Error("fetch is not available for embeddings");
	const response = await implementation(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
		signal,
	});
	if (!response?.ok) throw new Error(`Embeddings HTTP ${response?.status ?? "desconocido"}`);
	return response.json();
};

const selectFromProviders = (providers) => {
	if (!isPlainObject(providers)) return null;
	const name = providers.defaultProvider ?? providers.default ?? null;
	const named = name ? providers[name] : null;
	const selected = isPlainObject(named) ? named : Object.values(providers).find(isPlainObject);
	if (!selected) return null;
	return {
		...selected,
		provider: selected.provider ?? selected.type ?? selected.name ?? (isPlainObject(named) ? name : undefined),
	};
};

const buildRemoteEmbedder = (selected, { fetchImpl, signal }) => {
	const provider = String(selected.provider ?? selected.type ?? "").trim().toLowerCase();
	const model = selected.model ?? selected.modelName;
	const apiKey = selected.apiKey ?? selected.api_key;
	const baseUrl = selected.baseUrl ?? selected.baseURL;

	if (provider === "ollama") {
		if (!model) return { embed: null, reason: "no Ollama embedding model configured" };
		const url = `${String(baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "")}/api/embed`;
		return {
			embed: async (text) => {
				const data = await postJson({ url, body: { model, input: text }, fetchImpl, signal });
				const vector = data?.embeddings?.[0] ?? data?.embedding ?? null;
				if (!Array.isArray(vector)) throw new Error("Ollama did not return an embedding");
				return vector;
			},
			provider,
			model,
		};
	}

	if (provider === "google" || provider === "gemini" || provider === "google-gemini") {
		if (!model) return { embed: null, reason: "no Google embedding model configured" };
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`
			+ (apiKey ? `?key=${encodeURIComponent(apiKey)}` : "");
		return {
			embed: async (text) => {
				const data = await postJson({
					url,
					body: { content: { parts: [{ text }] } },
					fetchImpl,
					signal,
				});
				const vector = data?.embedding?.values ?? null;
				if (!Array.isArray(vector)) throw new Error("Google did not return an embedding");
				return vector;
			},
			provider,
			model,
		};
	}

	if (!provider || ["openai", "openai-compatible", "azure", "azure-openai"].includes(provider)) {
		if (!model) return { embed: null, reason: "no embedding model configured" };
		const url = `${String(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/embeddings`;
		return {
			embed: async (text) => {
				const data = await postJson({
					url,
					headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
					body: { model, input: text },
					fetchImpl,
					signal,
				});
				const vector = data?.data?.[0]?.embedding ?? null;
				if (!Array.isArray(vector)) throw new Error("The embedding provider did not return a vector");
				return vector;
			},
			provider: provider || "openai-compatible",
			model,
		};
	}

	return { embed: null, reason: `unknown embedding provider: ${provider}` };
};

/**
 * Resolves an `embed(text) => number[]` function from an explicit constructor
 * option or from the effective config. Never throws: failures are reported in
 * `reason` so callers can degrade to lexical search.
 *
 * @param {object} [options]
 * @param {object} [options.embeddings] Explicit embedding config or injected `embed`/`embedFn`.
 * @param {object} [options.config] Effective config; used when `embeddings` is absent.
 * @param {object} [options.configOptions] Options for `loadEffectiveConfig()`.
 * @param {Function} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.autoEmbeddings=true] Auto-configure Ollama's `nomic-embed-text`.
 * @returns {{embed: Function|null, configured: boolean, provider?: string, model?: string, reason?: string|null}}
 */
export const resolveEmbeddings = ({
	embeddings,
	config,
	configOptions,
	fetchImpl,
	signal,
	autoEmbeddings = true,
} = {}) => {
	let selected = isPlainObject(embeddings) ? { ...embeddings } : null;
	let effective = config;

	if (!selected) {
		try {
			effective = config ?? loadEffectiveConfig(configOptions).config;
		} catch (error) {
			return { embed: null, configured: false, reason: `config unavailable: ${error?.message || error}` };
		}

		const emb = effective?.emb ?? effective?.embeddings;
		if (isPlainObject(emb?.providers)) {
			selected = selectFromProviders(emb.providers);
		} else if (isPlainObject(emb) && (emb.provider || emb.model || emb.embed || emb.embedFn)) {
			selected = { ...emb };
		}
		if (!selected && isPlainObject(effective?.memory?.embeddings)) {
			const memoryConfig = effective.memory.embeddings;
			selected = isPlainObject(memoryConfig.providers)
				? selectFromProviders(memoryConfig.providers)
				: { ...memoryConfig };
		}
	}

	if (!selected && autoEmbeddings
		&& String(effective?.provider?.provider ?? "").toLowerCase() === "ollama") {
		// Ollama hosts are the common local setup: reuse their endpoint with a
		// small embedding model instead of silently degrading to lexical search.
		// A missing model degrades through the same embeddingReason path.
		selected = {
			provider: "ollama",
			model: "nomic-embed-text",
			baseUrl: effective.provider.baseUrl ?? "http://localhost:11434",
		};
	}

	if (!selected) {
		return { embed: null, configured: false, reason: "no embedding configuration" };
	}

	try {
		selected = resolveConfigSecrets(selected);
	} catch (error) {
		return { embed: null, configured: true, reason: `invalid embedding secrets: ${error?.message || error}` };
	}

	if (typeof selected.embed === "function" || typeof selected.embedFn === "function") {
		const embed = typeof selected.embed === "function" ? selected.embed : selected.embedFn;
		return {
			embed: async (text) => embed(text),
			configured: true,
			provider: selected.provider ?? "injected",
			model: selected.model,
		};
	}

	const built = buildRemoteEmbedder(selected, { fetchImpl, signal });
	return {
		embed: built.embed,
		configured: true,
		provider: built.provider,
		model: built.model,
		reason: built.reason ?? null,
	};
};

/**
 * In-memory index of conversation episodes. Lexical search always works; cosine
 * similarity is added when an embedding provider is available. No filesystem or
 * database is used.
 */
export class MemoryStore {
	/**
	 * @param {object} [options]
	 * @param {"lexical"|"embeddings"|"hybrid"} [options.mode=hybrid]
	 * @param {number} [options.topK=5] Maximum episodes returned by `search()`.
	 * @param {number} [options.budget=1800] Character budget of the generated recap.
	 * @param {object} [options.embeddings] Explicit embedding configuration.
	 * @param {object} [options.config] Effective config for automatic embeddings.
	 * @param {boolean} [options.autoEmbeddings=true]
	 * @param {Function} [options.fetchImpl]
	 * @param {AbortSignal} [options.signal]
	 * @param {Function} [options.embedResolver] Test seam; defaults to `resolveEmbeddings`.
	 */
	constructor({
		mode = "hybrid",
		topK = 5,
		budget = 1800,
		embeddings,
		config,
		configOptions,
		fetchImpl,
		signal,
		autoEmbeddings = true,
		embedResolver = resolveEmbeddings,
	} = {}) {
		const normalizedMode = String(mode || "hybrid").trim().toLowerCase();
		this.mode = ["lexical", "embeddings", "hybrid"].includes(normalizedMode) ? normalizedMode : "hybrid";
		this.topK = Math.max(1, Number(topK) || 5);
		this.budget = Math.max(1, Number(budget) || 1800);
		this.fetchImpl = fetchImpl;
		this.signal = signal;
		this.episodes = [];
		this.vectors = [];
		this.embedding = embedResolver({
			embeddings,
			config,
			configOptions,
			fetchImpl,
			signal,
			autoEmbeddings,
		});
		this.embeddingReason = this.embedding.reason ?? null;
	}

	/** @returns {void} Clears all episodes and vectors; keeps the embedding config. */
	reset() {
		this.episodes = [];
		this.vectors = [];
		this.embeddingReason = this.embedding.reason ?? null;
	}

	/** @returns {number} Number of indexed episodes. */
	get size() {
		return this.episodes.length;
	}

	/**
	 * @returns {object} Episode count, mode, embedding provider/model and any
	 *   `embeddingReason` explaining why embeddings are unavailable.
	 */
	stats() {
		return {
			episodes: this.size,
			mode: this.mode,
			embeddingsConfigured: Boolean(this.embedding.configured && this.embedding.embed),
			embeddingProvider: this.embedding.provider ?? null,
			embeddingModel: this.embedding.model ?? null,
			embeddingReason: this.embeddingReason,
		};
	}

	/** @param {object} episode @returns {string} User and assistant text joined. */
	episodeText(episode) {
		return [episode?.content, episode?.next?.content].filter(Boolean).join("\n");
	}

	/**
	 * Adds one episode and its embedding when available.
	 *
	 * @param {object} [episode] `{role, kind, content, next: {role, content}}`.
	 * @param {object} [meta] `createdAt` and optional `kind` override.
	 * @returns {Promise<object|null>} Stored row, or null when both texts are empty.
	 */
	async add(episode = {}, meta = {}) {
		const row = {
			created_at: meta.createdAt ?? new Date().toISOString(),
			role: episode.role ?? "user",
			...(episode.kind ? { kind: episode.kind } : {}),
			content: String(episode.content ?? ""),
			...(isPlainObject(episode.next) ? {
				next: {
					role: episode.next.role ?? "assistant",
					content: String(episode.next.content ?? ""),
				},
			} : {}),
		};
		if (!row.content && !row.next?.content) return null;

		const index = this.episodes.push(row) - 1;
		let vector = null;
		if (this.embedding.embed && this.mode !== "lexical") {
			try {
				vector = await this.embedding.embed(short(this.episodeText(row), 2000));
			} catch (error) {
				this.embeddingReason = `embedding failed: ${error?.message || error}`;
				vector = null;
			}
		}
		this.vectors[index] = vector;
		return row;
	}

	/**
	 * Convenience wrapper for a user/assistant pair.
	 *
	 * @param {string} userText
	 * @param {string} assistantText
	 * @param {object} [meta]
	 * @returns {Promise<object|null>} Stored episode.
	 */
	async addTurn(userText, assistantText, meta = {}) {
		return this.add({
			role: "user",
			kind: meta.kind ?? "turn",
			content: String(userText ?? ""),
			next: { role: "assistant", content: String(assistantText ?? "") },
		}, meta);
	}

	/**
	 * Purges the whole index and leaves only the compacted summary.
	 *
	 * @param {string} summaryText
	 * @param {object} [meta]
	 * @returns {Promise<object|null>} Stored summary episode.
	 */
	async replaceWithSummary(summaryText, meta = {}) {
		this.reset();
		if (!summaryText) return null;
		return this.add({
			role: "system",
			kind: meta.kind ?? "summary",
			content: String(summaryText),
		}, meta);
	}

	/**
	 * @param {string} query
	 * @returns {Promise<number[]|null>} Query vector, or null in lexical mode or
	 *   when the embedding provider fails.
	 */
	async embedQuery(query) {
		if (!this.embedding.embed || this.mode === "lexical") return null;
		try {
			const vector = await this.embedding.embed(short(query, 2000));
			return Array.isArray(vector) ? vector : null;
		} catch (error) {
			this.embeddingReason = `embedding failed: ${error?.message || error}`;
			return null;
		}
	}

	/**
	 * Searches the index. Lexical scoring is always used; vector scoring is
	 * added when the query can be embedded.
	 *
	 * @param {string} query Natural-language query.
	 * @param {object} [options] `topK` and `budget` overrides.
	 * @returns {Promise<{results: Array<object>, recap: string, usedEmbeddings: boolean,
	 *   embeddingReason: string|null, scores: number[], mode: string}>}
	 */
	async search(query, options = {}) {
		const text = String(query ?? "");
		const limit = Math.max(1, Number(options.topK ?? this.topK) || this.topK);
		const recapBudget = Math.max(1, Number(options.budget ?? this.budget) || this.budget);
		const queryVector = await this.embedQuery(text);
		const usedEmbeddings = Boolean(queryVector && this.embedding.embed && this.mode !== "lexical");
		const effectiveMode = usedEmbeddings ? this.mode : "lexical";

		const scored = this.episodes.map((episode, index) => {
			const document = this.episodeText(episode);
			const lexical = lexicalScore(text, document);
			const vector = usedEmbeddings ? cosine(queryVector, this.vectors[index]) : 0;
			const recency = recencyScore(index, this.episodes.length);
			let score;
			if (this.mode === "embeddings" && usedEmbeddings) {
				score = 0.85 * vector + 0.15 * recency;
			} else if (usedEmbeddings) {
				score = 0.55 * lexical + 0.35 * vector + 0.10 * recency;
			} else {
				score = 0.85 * lexical + 0.15 * recency;
			}
			return { episode, score: Number(score.toFixed(4)), lexical, vector };
		}).filter((item) => item.score > 0.05)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		const results = scored.map((item) => item.episode);
		const recap = formatHistoryRecap({ results }, { budget: recapBudget });
		return {
			results,
			scored,
			recap,
			mode: effectiveMode,
			usedEmbeddings,
			embeddingReason: usedEmbeddings ? null : this.embeddingReason,
		};
	}
}

export default MemoryStore;
