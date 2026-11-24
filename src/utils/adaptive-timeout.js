/**
 * Timeouts adaptativos para pruebas E2E y clientes con modelos lentos.
 */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Suggests a timeout from a real observation and the expected work.
 *
 * @param {object} [options]
 * @param {number} [options.observedMs] Recent observed duration.
 * @param {number} [options.maxTokens] Expected generation length.
 * @param {number} [options.tokensPerSecond] Measured generation rate.
 * @param {number} [options.minMs=15000]
 * @param {number} [options.maxMs=240000]
 * @param {number} [options.factor=1.8]
 * @param {number} [options.headroomMs=5000]
 * @returns {number} Clamped timeout in milliseconds.
 */
export function suggestTimeoutMs({
	observedMs,
	maxTokens,
	tokensPerSecond,
	minMs = 15000,
	maxMs = 240000,
	factor = 1.8,
	headroomMs = 5000,
} = {}) {
	const observed = Number(observedMs) > 0 ? Number(observedMs) : 0;
	const tokens = Number(maxTokens) > 0 ? Number(maxTokens) : 0;
	const rate = Number(tokensPerSecond) > 0 ? Number(tokensPerSecond) : 0;

	const fromObservation = observed * factor + headroomMs;
	const fromTokens = tokens && rate ? (tokens / rate) * 1000 * factor + headroomMs : 0;
	const candidate = Math.max(fromObservation, fromTokens, minMs);
	return Math.round(clamp(candidate, minMs, maxMs));
}

/** Stateful policy that remembers recent durations per model. */
export class TimeoutPolicy {
	/** @param {object} [options] Defaults forwarded to `suggestTimeoutMs()`. */
	constructor(options = {}) {
		this.options = options;
		this.samples = new Map();
	}

	/**
	 * Records one sample, keeping at most the last five per model.
	 *
	 * @param {string} model
	 * @param {number} durationMs
	 * @param {number} [tokensPerSecond]
	 * @returns {void}
	 */
	record(model, durationMs, tokensPerSecond) {
		const list = this.samples.get(model) || [];
		list.push({ durationMs: Number(durationMs) || 0, tokensPerSecond: Number(tokensPerSecond) || 0 });
		if (list.length > 5) list.shift();
		this.samples.set(model, list);
	}

	/**
	 * @param {string} model
	 * @param {object} [options]
	 * @param {number} [options.maxTokens]
	 * @returns {number} Suggested timeout in milliseconds.
	 */
	get(model, { maxTokens } = {}) {
		const list = this.samples.get(model) || [];
		const observedMs = list.length
			? list.reduce((sum, sample) => sum + sample.durationMs, 0) / list.length
			: undefined;
		const rates = list.map((sample) => sample.tokensPerSecond).filter((rate) => rate > 0);
		const tokensPerSecond = rates.length
			? rates.reduce((sum, rate) => sum + rate, 0) / rates.length
			: undefined;
		return suggestTimeoutMs({ ...this.options, observedMs, tokensPerSecond, maxTokens });
	}
}

export default { suggestTimeoutMs, TimeoutPolicy };
