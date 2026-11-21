/**
 * Timeouts adaptativos para pruebas E2E y clientes con modelos lentos.
 */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Sugiere un timeout a partir de una observación real y del trabajo esperado.
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

/** Política con estado que recuerda duraciones recientes por modelo. */
export class TimeoutPolicy {
	constructor(options = {}) {
		this.options = options;
		this.samples = new Map();
	}

	record(model, durationMs, tokensPerSecond) {
		const list = this.samples.get(model) || [];
		list.push({ durationMs: Number(durationMs) || 0, tokensPerSecond: Number(tokensPerSecond) || 0 });
		if (list.length > 5) list.shift();
		this.samples.set(model, list);
	}

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
