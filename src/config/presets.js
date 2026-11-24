/**
 * Presets de configuración de modelo por tipo de tarea.
 *
 * Los parámetros de muestreo se pasan en `provider`. El `systemPrompt` se
 * devuelve tanto en `provider.system` (compatibilidad con runners antiguos)
 * como en el nivel superior `system`, que es donde `askAgent()` lo consume.
 *
 * El core es agnóstico al lenguaje de programación: no valida código,
 * solo provee la configuración óptima para cada tipo de tarea.
 */

/** Per-task sampling defaults and system prompts. @type {Record<string, object>} */
export const MODEL_PRESETS = {
  /** General chat, conversational answers */
  chat: {
    description: "General chat, conversational answers",
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: null,
    maxTokens: 1024,
    num_ctx: 8192,
    systemPrompt: "You are a helpful, concise and friendly assistant. Answer clearly and directly.",
  },

  /** Code generation (any language) */
  code: {
    description: "Code generation, functions, scripts",
    temperature: 0.2,          // more deterministic
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: 42,                  // fixed seed for reproducibility
    maxTokens: 4096,
    num_ctx: 16384,
    systemPrompt: `You are an expert programmer. Generate ONLY functional, well-commented, ready-to-use code.
Do not include explanations before or after it, except for comments inside the code.
For a single function, return the code without fences; when files or labelled blocks are requested, use one Markdown block per file with its tag (html, css, js).
The code must be valid, follow best practices and require no external dependencies that were not mentioned.`,
  },

  /** HTML/CSS/JS generation (web pages, landing pages) */
  web: {
    description: "HTML, CSS, JavaScript for web pages",
    temperature: 0.3,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: 42,
    maxTokens: 6144,
    num_ctx: 16384,
    systemPrompt: `You are an expert web developer. Generate valid, semantic, production-ready HTML5, CSS and JavaScript files.

STRICT RULES:
1. HTML: semantic, include DOCTYPE, links to CSS and JS, accessible.
2. CSS: responsive (mobile-first), use CSS variables, box-sizing: border-box, media queries.
3. JavaScript: vanilla (no frameworks), handle events, form validation, DOM ready.
4. Do NOT return explanatory text outside the requested code.
5. Each file must be self-contained and functional.
6. If separate files are requested, emit one fenced block per file with its tag (html, css, js) and no text between blocks.`,
  },

  /** Long context / summarising many messages */
  longContext: {
    description: "Long conversations, summarisation, extensive context analysis",
    temperature: 0.5,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: null,
    maxTokens: 2048,
    num_ctx: 32768,
    systemPrompt: "You are an assistant that stays coherent in long conversations. Summarise key information and recall earlier details when relevant.",
  },

  /** Complex reasoning / analysis */
  reasoning: {
    description: "Complex reasoning, analysis, problem solving",
    temperature: 0.4,
    top_p: 0.9,
    top_k: 50,
    repeat_penalty: 1.1,
    seed: null,
    maxTokens: 4096,
    num_ctx: 16384,
    systemPrompt: "Analyse step by step, reason logically and provide well-founded answers.",
  },
};

/**
 * Obtiene la configuración completa de provider para un modelo y tipo de tarea.
 *
 * @param {string} model - Nombre del modelo (ej. "qwen2.5-coder:3b")
 * @param {string} taskType - Tipo de tarea: "chat", "code", "web", "longContext", "reasoning"
 * @param {object} overrides - Sobrescripciones opcionales (temperatura, maxTokens, etc.)
 * @param {string} baseUrl - URL base de Ollama
 * @returns {object} Configuración plana de provider; `system` se lee desde askAgent()
 */
export function getModelConfig(model, taskType = "chat", overrides = {}, baseUrl = "http://127.0.0.1:11434") {
  const preset = MODEL_PRESETS[taskType];
  if (!preset) {
    throw new Error(`Task type "${taskType}" not found. Available: ${Object.keys(MODEL_PRESETS).join(", ")}`);
  }

  return {
    provider: "ollama",
    model,
    baseUrl,
    temperature: preset.temperature,
    top_p: preset.top_p,
    top_k: preset.top_k,
    repeat_penalty: preset.repeat_penalty,
    seed: preset.seed,
    maxTokens: preset.maxTokens,
    num_ctx: preset.num_ctx,
    ...overrides,
    // askAgent() consume esta propiedad del provider y la convierte en mensaje system.
    system: overrides.system ?? preset.systemPrompt,
  };
}

/**
 * Lists available task types with their descriptions.
 *
 * @returns {Array<{key: string, description: string}>}
 */
export function listTaskTypes() {
  return Object.entries(MODEL_PRESETS).map(([key, value]) => ({
    key,
    description: value.description,
  }));
}

export default { MODEL_PRESETS, getModelConfig, listTaskTypes };