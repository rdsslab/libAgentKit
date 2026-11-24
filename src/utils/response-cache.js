/**
 * Caché en memoria opcional para respuestas deterministas (temperatura baja /
 * seed fijo). No se activa automáticamente desde el core.
 */

const stableStringify = (value) => {
	if (value == null) return "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
};

/** Las credenciales no forman parte de la identidad de una respuesta. */
const sanitizeProviderForKey = (provider) => {
	if (!provider || typeof provider !== "object" || Array.isArray(provider)) return provider ?? null;
	const { apiKey, api_key, azureApiKey, azure_api_key, headers, ...publicConfig } = provider;
	return publicConfig;
};

/**
 * Builds a stable identity for a request, excluding credentials and callbacks.
 *
 * @param {object} [options] `askAgent()`-style options.
 * @returns {string} Deterministic cache key.
 */
export function createCacheKey(options = {}) {
	// Los hooks de validación son funciones: no pueden formar parte de la clave
	// serializada. Se identifica con `validarComportamientoId` (o el nombre).
	const { validarComportamiento, ...rest } = options;
	const comportamientoId = options.validarComportamientoId
		?? (typeof validarComportamiento === "function" ? (validarComportamiento.name || "anonima") : null);
	const relevant = {
		provider: sanitizeProviderForKey(rest.provider),
		messages: rest.messages,
		prompt: rest.prompt,
		system: rest.system,
		history: rest.history,
		taskType: rest.taskType,
		lenguaje: rest.lenguaje,
		idiomaSystemPrompt: rest.idiomaSystemPrompt,
		autoCorrect: rest.autoCorrect,
		maxCorrectionAttempts: rest.maxCorrectionAttempts,
		umbralPuntuacion: rest.umbralPuntuacion,
		validarSintaxis: rest.validarSintaxis,
		validarComportamientoId: comportamientoId,
		responseProcessing: rest.responseProcessing,
		postProcess: rest.postProcess,
		autoCompact: rest.autoCompact,
	};
	return stableStringify(relevant);
}

/** In-memory LRU cache with TTL for deterministic responses. */
export class ResponseCache {
	/**
	 * @param {object} [options]
	 * @param {number} [options.maxEntries=64]
	 * @param {number} [options.ttlMs=600000]
	 */
	constructor({ maxEntries = 64, ttlMs = 10 * 60 * 1000 } = {}) {
		this.maxEntries = Math.max(1, Number(maxEntries) || 64);
		this.ttlMs = Number(ttlMs) > 0 ? Number(ttlMs) : 10 * 60 * 1000;
		this.entries = new Map();
		this.hits = 0;
		this.misses = 0;
	}

	/** @param {string} key @returns {*} Cached value, or undefined on miss/expiry. */
	get(key) {
		const entry = this.entries.get(key);
		if (!entry) {
			this.misses += 1;
			return undefined;
		}
		if (entry.expiresAt && Date.now() > entry.expiresAt) {
			this.entries.delete(key);
			this.misses += 1;
			return undefined;
		}
		this.hits += 1;
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	/**
	 * @param {string} key
	 * @param {*} value
	 * @returns {*} The stored value.
	 */
	set(key, value) {
		this.entries.delete(key);
		this.entries.set(key, {
			value,
			expiresAt: this.ttlMs ? Date.now() + this.ttlMs : null,
		});
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			this.entries.delete(oldest);
		}
		return value;
	}

	/** @returns {void} */
	clear() {
		this.entries.clear();
	}

	/** @returns {{size: number, hits: number, misses: number, maxEntries: number, ttlMs: number}} */
	stats() {
		return {
			size: this.entries.size,
			hits: this.hits,
			misses: this.misses,
			maxEntries: this.maxEntries,
			ttlMs: this.ttlMs,
		};
	}
}

export default { createCacheKey, ResponseCache };
