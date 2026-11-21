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

export const MODEL_PRESETS = {
  /** Chat general, respuestas conversacionales */
  chat: {
    description: "Chat general, respuestas conversacionales",
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: null,
    maxTokens: 1024,
    num_ctx: 8192,
    systemPrompt: "Eres un asistente útil, conciso y amigable. Responde en español de forma clara y directa.",
  },

  /** Generación de código (cualquier lenguaje) */
  code: {
    description: "Generación de código, funciones, scripts",
    temperature: 0.2,          // más determinista
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: 42,                  // semilla fija para reproducibilidad
    maxTokens: 4096,
    num_ctx: 16384,
    systemPrompt: `Eres un programador experto. Genera SOLO código funcional, bien comentado y listo para usar.
No incluyas explicaciones previas ni postéricas salvo comentarios dentro del código.
Para una sola función devuelve el código sin cercos; cuando se pidan archivos o bloques etiquetados, usa un bloque Markdown por archivo con su etiqueta (html, css, js).
El código debe ser válido, seguir buenas prácticas y no requerir dependencias externas no mencionadas.`,
  },

  /** Generación de HTML/CSS/JS (páginas web, landing pages) */
  web: {
    description: "HTML, CSS, JavaScript para páginas web",
    temperature: 0.3,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: 42,
    maxTokens: 6144,
    num_ctx: 16384,
    systemPrompt: `Eres un desarrollador web experto. Genera archivos HTML5, CSS y JavaScript válidos, semánticos y listos para producción.

REGLAS ESTRICTAS:
1. HTML: semántico, incluye DOCTYPE, enlaces a CSS y JS, accesible.
2. CSS: responsive (mobile-first), usa variables CSS, box-sizing: border-box, media queries.
3. JavaScript: vanilla (sin frameworks), maneja eventos, validación de formularios, DOM ready.
4. NO devuelvas texto explicativo fuera del código solicitado.
5. Cada archivo debe ser independiente y funcional.
6. Si se piden archivos separados, emite un bloque cercado por archivo con su etiqueta (html, css, js) y sin texto entre bloques.`,
  },

  /** Contexto largo / resumen de muchos mensajes */
  longContext: {
    description: "Conversaciones largas, resumen, análisis de contexto extenso",
    temperature: 0.5,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: null,
    maxTokens: 2048,
    num_ctx: 32768,
    systemPrompt: "Eres un asistente que mantiene coherencia en conversaciones largas. Resume información clave y recuerda detalles anteriores cuando sea relevante.",
  },

  /** Razonamiento complejo / análisis */
  reasoning: {
    description: "Razonamiento complejo, análisis, resolución de problemas",
    temperature: 0.4,
    top_p: 0.9,
    top_k: 50,
    repeat_penalty: 1.1,
    seed: null,
    maxTokens: 4096,
    num_ctx: 16384,
    systemPrompt: "Analiza paso a paso, razona lógicamente y proporciona respuestas bien fundamentadas en español.",
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
 * Lista los tipos de tarea disponibles con sus descripciones.
 */
export function listTaskTypes() {
  return Object.entries(MODEL_PRESETS).map(([key, value]) => ({
    key,
    description: value.description,
  }));
}

export default { MODEL_PRESETS, getModelConfig, listTaskTypes };