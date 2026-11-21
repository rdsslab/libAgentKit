/**
 * System Prompts bilingües (ES/EN) para mejorar la comprensión del modelo.
 *
 * Muchos modelos (especialmente los más pequeños y los base) están entrenados
 * principalmente con instrucciones en inglés. Usar system prompts en inglés
 * para instrucciones técnicas puede mejorar significativamente la calidad y el
 * formato de las respuestas, manteniendo la respuesta final en el idioma del
 * usuario.
 *
 * Estrategia recomendada:
 *   - Instrucciones de formato y reglas → inglés (mejor comprendido por el modelo)
 *   - Idioma de la respuesta → español (o el que use el usuario)
 */

export const SYSTEM_PROMPTS_EN = {
  /** Chat general, respuestas conversacionales */
  chat: `You are a helpful, concise and friendly assistant. Respond in Spanish clearly and directly. Maintain coherence in multi-turn conversations.`,

  /** Generación de código (cualquier lenguaje) */
  code: `You are an expert programmer. Generate ONLY functional, well-commented code ready to use.

STRICT RULES:
1. Do not include explanations before or after the code, except comments within the code.
2. For a single function, return raw code without fences. When the task asks for separate or labeled files, use one markdown code block per file with its language tag (html, css, js).
3. Code must be valid, follow best practices, and not require external dependencies not mentioned.
4. Include error handling when appropriate.
5. Use descriptive variable and function names in Spanish or English as appropriate.`,

  /** Generación de HTML/CSS/JS (páginas web, landing pages) */
  web: `You are an expert web developer. Generate valid, semantic, production-ready HTML5, CSS and JavaScript files.

STRICT RULES:
1. HTML: semantic, include DOCTYPE, links to CSS and JS, accessible.
2. CSS: responsive (mobile-first), use CSS variables, box-sizing: border-box, media queries.
3. JavaScript: vanilla (no frameworks), event handling, form validation, DOM ready.
4. Do NOT return explanatory text outside the requested code.
5. Each file must be independent and functional.
6. When the task asks for separate files, emit one fenced block per file with its language tag (html, css, js) and no text between blocks.`,

  /** Contexto largo / resumen de muchos mensajes */
  longContext: `You are an assistant that maintains coherence in long conversations. Summarize key information and remember previous details when relevant.`,

  /** Razonamiento complejo / análisis */
  reasoning: `Analyze step by step, reason logically, and provide well-founded responses in Spanish.`,
};

export const SYSTEM_PROMPTS_ES = {
  /** Chat general, respuestas conversacionales */
  chat: "Eres un asistente útil, conciso y amigable. Responde en español de forma clara y directa. Mantén la coherencia en conversaciones multi-turno.",

  /** Generación de código (cualquier lenguaje) */
  code: `Eres un programador experto. Genera SOLO código funcional, bien comentado y listo para usar.

REGLAS ESTRICTAS:
1. No incluyas explicaciones previas ni postéricas salvo comentarios dentro del código.
2. Para una sola función devuelve el código sin cercos. Cuando la tarea pida archivos o bloques etiquetados, usa un bloque Markdown por archivo con su etiqueta (html, css, js).
3. El código debe ser válido, seguir buenas prácticas y no requerir dependencias externas no mencionadas.
4. Incluye manejo de errores cuando sea apropiado.
5. Usa nombres de variables y funciones descriptivos en español o inglés según el contexto.`,

  /** Generación de HTML/CSS/JS (páginas web, landing pages) */
  web: `Eres un desarrollador web experto. Genera archivos HTML5, CSS y JavaScript válidos, semánticos y listos para producción.

REGLAS ESTRICTAS:
1. HTML: semántico, incluye DOCTYPE, enlaces a CSS y JS, accesible.
2. CSS: responsive (mobile-first), usa variables CSS, box-sizing: border-box, media queries.
3. JavaScript: vanilla (sin frameworks), maneja eventos, validación de formularios, DOM ready.
4. NO devuelvas texto explicativo fuera del código solicitado.
5. Cada archivo debe ser independiente y funcional.
6. Cuando la tarea pida archivos separados, emite un bloque cercado por archivo con su etiqueta (html, css, js) y sin texto entre bloques.`,

  /** Contexto largo / resumen de muchos mensajes */
  longContext: "Eres un asistente que mantiene coherencia en conversaciones largas. Resume información clave y recuerda detalles anteriores cuando sea relevante.",

  /** Razonamiento complejo / análisis */
  reasoning: "Analiza paso a paso, razona lógicamente y proporciona respuestas bien fundamentadas en español.",
};

/**
 * Obtiene el system prompt para un tipo de tarea y idioma.
 *
 * @param {string} taskType - Tipo de tarea: "chat", "code", "web", "longContext", "reasoning"
 * @param {string} [idioma] - Idioma del system prompt: "en" o "es" (default: "en" para instrucciones técnicas, "es" para chat)
 * @returns {string} System prompt en el idioma solicitado
 */
// Los runners usan tipos de tarea finos ("js", "html", "css") mientras que
// los prompts están agrupados en "code" y "web". Sin este mapa, esos tipos
// caían silenciosamente al prompt genérico de chat.
const TASK_TYPE_ALIASES = {
  js: "code",
  javascript: "code",
  html: "web",
  css: "web",
};

const resolveTaskType = (taskType) => TASK_TYPE_ALIASES[String(taskType || "").toLowerCase()] || taskType;

/**
 * Detecta heurísticamente el idioma del prompt del usuario.
 * Devuelve `null` cuando no hay evidencia suficiente para no forzar un cambio.
 */
export function detectPromptLanguage(value) {
  const texto = String(value || "");
  if (!texto.trim()) return null;

  const spanish = (texto.match(/\b(?:hola|por favor|crea|crear|genera|generar|escribe|escribir|devuelve|devolver|función|funcion|archivo|página|pagina|valide|básico|basico|codigo|código|ayuda|necesito|quiero|dame|lista|siguiente|clínica|clinica|veterinaria)\b/gi) || []).length;
  const english = (texto.match(/\b(?:hello|please|create|generate|write|return|function|file|page|help|need|want|give|list|next|build|implement|email)\b/gi) || []).length;

  if (spanish > english) return "es";
  if (english > spanish) return "en";
  return null;
}

export function getSystemPrompt(taskType, idioma = "en") {
  const key = resolveTaskType(taskType);
  if (idioma === "es") {
    return SYSTEM_PROMPTS_ES[key] || SYSTEM_PROMPTS_ES.chat;
  }
  return SYSTEM_PROMPTS_EN[key] || SYSTEM_PROMPTS_EN.chat;
}

/**
 * Obtiene el system prompt en inglés (recomendado para instrucciones técnicas).
 *
 * @param {string} taskType - Tipo de tarea
 * @returns {string} System prompt en inglés
 */
export function getSystemPromptEN(taskType) {
  const key = resolveTaskType(taskType);
  return SYSTEM_PROMPTS_EN[key] || SYSTEM_PROMPTS_EN.chat;
}

/**
 * Obtiene el system prompt en español.
 *
 * @param {string} taskType - Tipo de tarea
 * @returns {string} System prompt en español
 */
export function getSystemPromptES(taskType) {
  const key = resolveTaskType(taskType);
  return SYSTEM_PROMPTS_ES[key] || SYSTEM_PROMPTS_ES.chat;
}

/**
 * Lista los tipos de tarea disponibles.
 *
 * @returns {Array<{key: string, descripcion: string}>}
 */
export function listTaskTypes() {
  return [
    { key: "chat", descripcion: "Chat general, respuestas conversacionales" },
    { key: "code", descripcion: "Generación de código, funciones, scripts" },
    { key: "web", descripcion: "HTML, CSS, JavaScript para páginas web" },
    { key: "longContext", descripcion: "Conversaciones largas, resumen, análisis de contexto extenso" },
    { key: "reasoning", descripcion: "Razonamiento complejo, análisis, resolución de problemas" },
  ];
}

export default {
  SYSTEM_PROMPTS_EN,
  SYSTEM_PROMPTS_ES,
  getSystemPrompt,
  getSystemPromptEN,
  getSystemPromptES,
  listTaskTypes,
};
