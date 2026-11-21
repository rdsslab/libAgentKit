/**
 * Registro de recomendaciones de modelos basado en resultados E2E reales.
 * Es informativo: el llamador decide qué modelo usar.
 */

export const MODEL_RECOMMENDATIONS = [
	{
		model: "qwen2.5:1.5b-instruct",
		environment: "remote",
		tasks: ["chat", "reasoning"],
		reason: "Respuestas rápidas y coherentes; suficiente para conversación corta.",
		score: 82,
	},
	{
		model: "qwen2.5-coder:3b",
		environment: "remote",
		tasks: ["code", "reasoning"],
		reason: "Mejor calidad de código JavaScript validado; Python aceptable.",
		score: 88,
	},
	{
		model: "lfm3-omni:2b",
		environment: "local",
		tasks: ["web", "code", "chat"],
		reason: "Mejor equilibrio para HTML/CSS/JS completos sin timeouts locales.",
		score: 85,
	},
	{
		model: "lfm3-omni:latest",
		environment: "remote",
		tasks: ["chat", "code"],
		reason: "Útil para respuestas cortas; generaciones largas pueden exceder timeout en el servidor sin GPU.",
		score: 74,
	},
];

export function recommendModels({ taskType = "chat", environment = "local", limit = 3 } = {}) {
	return MODEL_RECOMMENDATIONS
		.filter((entry) => entry.tasks.includes(taskType))
		.filter((entry) => environment === "any" || entry.environment === environment)
		.sort((left, right) => right.score - left.score)
		.slice(0, Math.max(1, Number(limit) || 3));
}

export function recommendModel(options = {}) {
	return recommendModels(options)[0] || null;
}

export default { MODEL_RECOMMENDATIONS, recommendModels, recommendModel };
