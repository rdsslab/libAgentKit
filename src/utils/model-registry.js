/**
 * Registro de recomendaciones de modelos basado en resultados E2E reales.
 * Es informativo: el llamador decide qué modelo usar.
 */

/** Informational model scores from real E2E runs. @type {Array<object>} */
export const MODEL_RECOMMENDATIONS = [
	{
		model: "qwen2.5:1.5b-instruct",
		environment: "remote",
		tasks: ["chat", "reasoning"],
		reason: "Fast, coherent answers; sufficient for short conversations.",
		score: 82,
	},
	{
		model: "qwen2.5-coder:3b",
		environment: "remote",
		tasks: ["code", "reasoning"],
		reason: "Best validated JavaScript code quality; Python is acceptable.",
		score: 88,
	},
	{
		model: "lfm3-omni:2b",
		environment: "local",
		tasks: ["web", "code", "chat"],
		reason: "Best balance for complete HTML/CSS/JS without local timeouts.",
		score: 85,
	},
	{
		model: "lfm3-omni:latest",
		environment: "remote",
		tasks: ["chat", "code"],
		reason: "Useful for short answers; long generations may time out on a server without a GPU.",
		score: 74,
	},
];

/**
 * Ranks models by score for a task and environment.
 *
 * @param {object} [options]
 * @param {string} [options.taskType=chat]
 * @param {string} [options.environment=local] `local`, `remote` or `any`.
 * @param {number} [options.limit=3]
 * @returns {Array<object>} Matching recommendations, highest score first.
 */
export function recommendModels({ taskType = "chat", environment = "local", limit = 3 } = {}) {
	return MODEL_RECOMMENDATIONS
		.filter((entry) => entry.tasks.includes(taskType))
		.filter((entry) => environment === "any" || entry.environment === environment)
		.sort((left, right) => right.score - left.score)
		.slice(0, Math.max(1, Number(limit) || 3));
}

/**
 * @param {object} [options] Same options as `recommendModels()`.
 * @returns {object|null} Best recommendation, or null when none matches.
 */
export function recommendModel(options = {}) {
	return recommendModels(options)[0] || null;
}

export default { MODEL_RECOMMENDATIONS, recommendModels, recommendModel };
