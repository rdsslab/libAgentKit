/**
 * Output Validator - Validación y auto-corrección de salidas de modelos de IA.
 *
 * Detecta problemas comunes en el código generado y permite al harness
 * solicitar correcciones automáticas al modelo.
 *
 * Capa de utilidad: no pertenece al núcleo del proveedor.
 */

/**
 * Valida si una respuesta de HTML es válida y no tiene contaminación.
 *
 * @param {string} contenido - Contenido HTML
 * @returns {{valido: boolean, puntuacion: number, problemas: string[]}}
 */
export function validarHTMLSalida(contenido) {
  const problemas = [];
  let puntuacion = 100;

  if (!/<!DOCTYPE\s+html>/i.test(contenido)) {
    problemas.push('Falta DOCTYPE html');
    puntuacion -= 15;
  }
  if (!/<html[^>]*>/i.test(contenido)) {
    problemas.push('Falta etiqueta <html>');
    puntuacion -= 15;
  }
  if (!/<body[^>]*>/i.test(contenido)) {
    problemas.push('Falta etiqueta <body>');
    puntuacion -= 15;
  }
  if (/<style[^>]*>/i.test(contenido)) {
    problemas.push('CSS embebido en HTML (debe ser archivo separado)');
    puntuacion -= 20;
  }
  if (/<script[^>]*>/i.test(contenido)) {
    problemas.push('JavaScript embebido en HTML (debe ser archivo separado)');
    puntuacion -= 20;
  }
  if (!/style\.css/.test(contenido)) {
    problemas.push('Falta enlace a style.css');
    puntuacion -= 10;
  }
  if (!/script\.js/.test(contenido)) {
    problemas.push('Falta enlace a script.js');
    puntuacion -= 5;
  }

  return {
    valido: problemas.length === 0,
    puntuacion: Math.max(0, puntuacion),
    problemas,
  };
}

/**
 * Valida si una respuesta de CSS es válida.
 *
 * @param {string} contenido - Contenido CSS
 * @returns {{valido: boolean, puntuacion: number, problemas: string[]}}
 */
export function validarCSSSalida(contenido) {
  const problemas = [];
  let puntuacion = 100;

  if (!/body\s*\{/.test(contenido)) {
    problemas.push('Falta estilo de body');
    puntuacion -= 15;
  }
  if (!/:hover/.test(contenido)) {
    problemas.push('Falta interacción :hover');
    puntuacion -= 10;
  }
  if (!/@media/.test(contenido)) {
    problemas.push('Falta media queries (responsive)');
    puntuacion -= 15;
  }
  if (!/#[0-9a-fA-F]{3,6}/.test(contenido)) {
    problemas.push('Falta colores hexadecimales');
    puntuacion -= 10;
  }
  if (!/--[\w-]+:/ .test(contenido)) {
    problemas.push('Falta variables CSS (:root)');
    puntuacion -= 10;
  }
  if (/<html|<body|<!DOCTYPE/i.test(contenido)) {
    problemas.push('HTML embebido en CSS');
    puntuacion -= 25;
  }

  return {
    valido: problemas.length === 0,
    puntuacion: Math.max(0, puntuacion),
    problemas,
  };
}

/**
 * Valida si una respuesta de JavaScript es válida y no tiene contaminación.
 *
 * @param {string} contenido - Contenido JavaScript
 * @returns {{valido: boolean, puntuacion: number, problemas: string[]}}
 */
export function validarJSSalida(contenido) {
  const problemas = [];
  let puntuacion = 100;

  if (/<!DOCTYPE\s+html>/i.test(contenido) || /<html[^>]*>/i.test(contenido)) {
    problemas.push('HTML embebido en JavaScript');
    puntuacion -= 40;
  }
  if (/<style[^>]*>/i.test(contenido)) {
    problemas.push('CSS embebido en JavaScript');
    puntuacion -= 30;
  }
  if (/\$\s*\(|jQuery/.test(contenido)) {
    problemas.push('Usa jQuery (no incluida)');
    puntuacion -= 20;
  }
  if (!/addEventListener/.test(contenido) && !/getElementById|querySelector/.test(contenido)) {
    problemas.push('Falta manipulación del DOM');
    puntuacion -= 20;
  }
  if (!/function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>/.test(contenido)) {
    problemas.push('Falta definición de funciones');
    puntuacion -= 20;
  }

  return {
    valido: problemas.length === 0,
    puntuacion: Math.max(0, puntuacion),
    problemas,
  };
}

/**
 * Valida código genérico (JS, Python, etc.) según indicadores.
 *
 * @param {string} contenido - Código
 * @param {Array<[nombre, RegExp]>} indicadores - Indicadores a verificar
 * @returns {{valido: boolean, puntuacion: number, problemas: string[]}}
 */
export function validarCodigoSalida(contenido, indicadores = []) {
  const problemas = [];
  const checks = {
    comentarios: /\/\/|\/\*[\s\S]*?\*\//.test(contenido),
    noPlaceholders: !/TODO|FIXME|placeholder|lorem ipsum/i.test(contenido),
    noTextoExplicativo: !/lo siento|no puedo|disculpe|i'm sorry/i.test(contenido.trim().split('\n')[0]),
  };

  for (const [nombre, regex] of indicadores) {
    checks[nombre] = regex.test(contenido);
  }

  const fallos = Object.entries(checks).filter(([, v]) => !v);
  let puntuacion = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);

  for (const [nombre] of fallos) {
    problemas.push(`Falta: ${nombre}`);
  }

  return {
    valido: fallos.length === 0,
    puntuacion,
    problemas,
  };
}

/**
 * Genera un prompt de corrección para enviar al modelo cuando la salida tiene problemas.
 *
 * @param {string} contenidoOriginal - Contenido original generado
 * @param {string} tipo - "html", "css", "js", "code"
 * @param {Array<string>} problemas - Lista de problemas detectados
 * @param {string} promptOriginal - Prompt original del usuario
 * @returns {string} Prompt de corrección
 */
export function generarPromptCorreccion(contenidoOriginal, tipo, problemas, promptOriginal) {
  const problemasTexto = problemas.map((p) => `- ${p}`).join('\n');

  return `El código generado previamente tiene los siguientes problemas que debes corregir:

${problemasTexto}

Código original generado:
\`\`\`
${contenidoOriginal}
\`\`\`

Solicitud original: ${promptOriginal}

Por favor, regenera el código corrigiendo TODOS los problemas listados arriba.
REGLAS ESTRICTAS:
1. SOLO código, sin explicaciones previas ni postéricas.
2. NO uses bloques de markdown \`\`\` a menos que se te pida explícitamente.
3. No repitas los errores identificados.
4. El código debe ser válido y funcional.`;
}

/**
 * Determina si una respuesta necesita corrección basada en problemas detectados.
 *
 * @param {{valido: boolean, puntuacion: number, problemas: string[]}} resultadoValidacion
 * @param {number} [umbralPuntuacion] - Puntuación mínima aceptable (default: 70)
 * @returns {boolean} true si necesita corrección
 */
export function necesitaCorreccion(resultadoValidacion, umbralPuntuacion = 70) {
  return !resultadoValidacion.valido || resultadoValidacion.puntuacion < umbralPuntuacion;
}

export default {
  validarHTMLSalida,
  validarCSSSalida,
  validarJSSalida,
  validarCodigoSalida,
  generarPromptCorreccion,
  necesitaCorreccion,
};
