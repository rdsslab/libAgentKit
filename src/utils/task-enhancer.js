/**
 * Task Enhancer - Inyección automática de system prompts y few-shot por tipo de tarea.
 *
 * Mejora la calidad de las respuestas proporcionando instrucciones específicas
 * y ejemplos de salida esperada para cada tipo de tarea.
 *
 * Ahora soporta system prompts en inglés o español mediante el módulo
 * system-prompts-en.js. Los system prompts en inglés pueden mejorar la
 * comprensión del modelo para instrucciones técnicas.
 *
 * Capa de utilidad: no pertenece al núcleo del proveedor.
 */

import { getSystemPrompt as getSystemPromptBilingüe, listTaskTypes as listTaskTypesBilingüe } from "./system-prompts-en.js";

const FEW_SHOT_EXAMPLES = {
  code: {
    javascript: `Entrada: "Escribe una función que sume dos números"
Salida esperada:
function sumar(a, b) {
    return a + b;
}`,
    python: `Entrada: "Escribe una función que sume dos números"
Salida esperada:
def sumar(a, b):
    return a + b`,
  },
  html: {
    html: `Entrada: "Crea un HTML simple con un título y un párrafo"
Salida esperada:
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Mi Página</title>
</head>
<body>
    <h1>Título</h1>
    <p>Contenido del párrafo.</p>
</body>
</html>`,
  },
  css: {
    css: `Entrada: "Crea CSS para centrar un div con fondo azul"
Salida esperada:
.div-centrado {
    background-color: blue;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
}`,
  },
  js: {
    javascript: `Entrada: "Crea un botón que muestre una alerta al hacer clic"
Salida esperada:
document.getElementById('miBoton').addEventListener('click', () => {
    alert('¡Hola!');
});`,
  },
};

/**
 * Obtiene el system prompt optimizado para un tipo de tarea.
 *
 * @param {string} taskType - "chat", "code", "html", "css", "js", "web"
 * @param {string} [lenguaje] - Lenguaje de programación (ej. "javascript", "python")
 * @param {string} [idiomaSystemPrompt] - Idioma del system prompt: "en" o "es" (default: "en")
 * @returns {string} System prompt específico
 */
export function getSystemPrompt(taskType, lenguaje = null, idiomaSystemPrompt = "en") {
  return getSystemPromptBilingüe(taskType, idiomaSystemPrompt);
}

/**
 * Obtiene un ejemplo few-shot para un tipo de tarea y lenguaje.
 *
 * @param {string} taskType - "code", "html", "css", "js"
 * @param {string} [lenguaje] - Lenguaje de programación
 * @returns {string|null} Ejemplo few-shot o null si no hay
 */
export function getFewShotExample(taskType, lenguaje = null) {
  const ejemplos = FEW_SHOT_EXAMPLES[taskType];
  if (!ejemplos) return null;
  if (lenguaje && ejemplos[lenguaje]) return ejemplos[lenguaje];
  const primeraClave = Object.keys(ejemplos)[0];
  return ejemplos[primeraClave] || null;
}

/**
 * Enriquece los mensajes del prompt con system prompt y few-shot según el tipo de tarea.
 *
 * @param {Array<{role: string, content: any}>} messages - Mensajes originales
 * @param {string} taskType - Tipo de tarea inferida
 * @param {string} [lenguaje] - Lenguaje de programación
 * @param {string} [idiomaSystemPrompt] - Idioma del system prompt: "en" o "es" (default: "en")
 * @returns {Array<{role: string, content: string}>} Mensajes enriquecidos
 */
export function enriquecerMensajes(messages, taskType, lenguaje = null, idiomaSystemPrompt = "en") {
  const enriquecidos = [...messages];
  const systemPrompt = getSystemPrompt(taskType, lenguaje, idiomaSystemPrompt);
  const fewShot = getFewShotExample(taskType, lenguaje);

  const partes = [];
  if (!systemPrompt || !enriquecidos.some((m) => m?.role === 'system' && String(m.content || '').includes(systemPrompt))) {
    partes.push(systemPrompt);
  }
  if (fewShot && !enriquecidos.some((m) => m?.role === 'system' && String(m.content || '').includes(fewShot))) {
    partes.push(`EJEMPLO DE SALIDA ESPERADA:\n${fewShot}`);
  }
  const addition = partes.filter(Boolean).join('\n\n');
  if (!addition) return enriquecidos;

  const ultimoSystem = enriquecidos.findLastIndex((m) => m?.role === 'system');
  if (ultimoSystem < 0) {
    enriquecidos.unshift({ role: 'system', content: addition });
  } else {
    const actual = enriquecidos[ultimoSystem];
    enriquecidos[ultimoSystem] = {
      ...actual,
      content: [String(actual.content || '').trim(), addition].filter(Boolean).join('\n\n'),
    };
  }

  return enriquecidos;
}

/**
 * Lista los tipos de tarea disponibles.
 *
 * @returns {Array<{key: string, descripcion: string}>}
 */
export function listTaskTypes() {
  return listTaskTypesBilingüe();
}

export default { getSystemPrompt, getFewShotExample, enriquecerMensajes, listTaskTypes };
