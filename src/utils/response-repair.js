/**
 * Reparación determinista de respuestas de modelos.
 *
 * Es una capa del harness, no del proveedor: no conoce dominios, tareas ni
 * prompts. Solo trabaja con la FORMA de la respuesta (cercos Markdown,
 * envolventes HTML y repetición), que es un problema universal de los modelos
 * pequeños. No corrige semántica: si después de reparar la salida sigue siendo
 * inválida, el llamador decide si reintenta.
 */

const LENGUAJES_CODIGO = new Set([
  "code", "js", "javascript", "node", "mjs", "cjs", "ts", "typescript",
  "python", "py", "html", "htm", "css", "json", "web",
]);

const FENCE_LINE = /^\s*```/;
const WRAPPER_TAG = /^<(style|script)\b[^>]*>([\s\S]*)<\/\1\s*>$/i;
/**
 * @param {string} [texto]
 * @returns {number} Number of Markdown fence lines.
 */
export function countFenceLines(texto = "") {
  return String(texto || "")
    .split(/\r?\n/)
    .filter((linea) => FENCE_LINE.test(linea)).length;
}

/**
 * @param {string} [texto]
 * @returns {0|1} 1 when the number of fence lines is odd.
 */
export function fenceBalance(texto = "") {
  return countFenceLines(texto) % 2;
}

/**
 * Quita un envolvente `<style>...</style>` o `<script>...</script>` cuando
 * occupies the whole response. The model returns the file inside its HTML tag.
 *
 * @param {string} [texto]
 * @returns {string}
 */
export function unwrapTag(texto = "") {
  const valor = String(texto || "").trim();
  const partido = valor.match(WRAPPER_TAG);
  return partido ? partido[2].trim() : valor;
}

/**
 * Descarta prosa previa al primer cerco cuando la respuesta claramente debía
 * empezar con código. Conserva comentarios de código y no toca respuestas sin
 * fences (for example, chat).
 *
 * @param {string} [texto]
 * @returns {string}
 */
export function stripPreamble(texto = "") {
  const valor = String(texto || "");
  const lineas = valor.split(/\r?\n/);
  const indiceFence = lineas.findIndex((linea) => FENCE_LINE.test(linea));
  if (indiceFence <= 0) return valor;

  const prefijo = lineas.slice(0, indiceFence).join("\n").trim();
  if (!prefijo) return valor;

  // Un comentario inicial es código legítimo, no prosa del modelo.
  if (/^(\/\/|#|\/\*|<!--)/.test(prefijo)) return valor;
  // Si el prefijo contiene construcciones de código, puede ser código real
  // que precede al bloque (por ejemplo una explicación con `x = 1`).
  if (/[;{}()]/.test(prefijo)) return valor;
  // Solo se elimina texto en lenguaje natural y corto: "Aquí tienes:", etc.
  if (prefijo.length > 400 || !/[\p{L}]/u.test(prefijo)) return valor;

  return lineas.slice(indiceFence).join("\n");
}

/**
 * Corta un bucle de repetición al final de la respuesta. Los modelos pequeños
 * que alcanzan su límite de tokens suelen repetir las mismas 1-4 líneas. Deja
 * one copy and reports whether anything was removed.
 *
 * @param {string} [texto]
 * @returns {{text: string, repetido: boolean}}
 */
export function trimRepeatedTail(texto = "") {
  const valor = String(texto || "");
  const lineas = valor.split(/\r?\n/);
  if (lineas.length < 6) return { text: valor, repetido: false };

  for (let tamano = 1; tamano <= 4; tamano += 1) {
    if (lineas.length < tamano * 3) continue;
    const cola = lineas.slice(-tamano).map((linea) => linea.trim());
    if (cola.some((linea) => !linea)) continue;

    let repeticiones = 1;
    let inicio = lineas.length - tamano;
    while (inicio - tamano >= 0) {
      const previa = lineas.slice(inicio - tamano, inicio).map((linea) => linea.trim());
      if (previa.some((linea, indice) => linea !== cola[indice])) break;
      repeticiones += 1;
      inicio -= tamano;
    }
    if (repeticiones >= 3) {
      const conservadas = lineas.slice(0, inicio + tamano);
      return { text: conservadas.join("\n"), repetido: true };
    }
  }
  return { text: valor, repetido: false };
}

/**
 * Los modelos que alcanzan su techo repiten un fragmento DENTRO de una
 * palabra (`ToggleToggleToggleToggle`). Solo se detecta: reescribir el
 * identificador puede colisionar con otro nombre legítimo del mismo archivo,
 * so the fix is left to a retry with a higher token limit.
 *
 * @param {string} [texto]
 * @returns {{repetido: boolean}}
 */
export function detectarIdentificadorRepetido(texto = "") {
  const repetido = /([A-Za-z]{3,}?)\1{3,}/.test(String(texto || ""));
  return { repetido };
}

/** @param {string} [linea] @returns {boolean} */
function esDeclaracionIncompleta(linea = "") {
  return /^\s*(?:export\s+)?(?:async\s+)?function\s+[\w$]+\s*\([^)]*\)\s*:?\s*$/.test(linea)
    || /^\s*(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*$/.test(linea);
}

/**
 * @param {string} [texto]
 * @returns {{text: string, incompleta: boolean}}
 */
export function dropIncompleteTail(texto = "") {
  const valor = String(texto || "");
  const lineas = valor.split(/\r?\n/);
  let ultima = lineas.length - 1;
  while (ultima >= 0 && !lineas[ultima].trim()) ultima -= 1;
  if (ultima < 0 || !esDeclaracionIncompleta(lineas[ultima])) {
    return { text: valor, incompleta: false };
  }
  return { text: lineas.slice(0, ultima).join("\n"), incompleta: true };
}

/**
 * Elimina declaraciones de función idénticas repetidas. Los modelos pequeños
 * que se quedan sin contexto suelen reemitir el mismo bloque varias veces;
 * en JS/TS un nombre declarado dos veces es directamente un error de sintaxis.
 * Solo se elimina una copia BYTE-IDÉNTICA de una anterior: nunca se toca una
 * reimplementación distinta del mismo nombre.
 */
const BLOQUE_FUNCION = /^((?:export\s+)?(?:async\s+)?function\s+[\w$]+\s*\([^)]*\)\s*\{[\s\S]*?^\})/gm;

/**
 * @param {string} [texto]
 * @returns {{text: string, eliminados: number}}
 */
export function dropDuplicateBlocks(texto = "") {
  const vistos = new Set();
  let eliminados = 0;
  const resultado = String(texto || "").replace(BLOQUE_FUNCION, (todo) => {
    const clave = todo.replace(/\s+/g, " ").trim();
    if (vistos.has(clave)) {
      eliminados += 1;
      return "";
    }
    vistos.add(clave);
    return todo;
  });
  return { text: resultado, eliminados };
}

/**
 * @param {string} [texto]
 * @returns {boolean} True when more braces open than close.
 */
export function balanceLlaves(texto = "") {
  const abiertas = (texto.match(/\{/g) || []).length;
  const cerradas = (texto.match(/\}/g) || []).length;
  return abiertas > cerradas;
}

/**
 * Señales genéricas de que la salida fue cortada por el límite de tokens.
 * None is conclusive alone; they are returned to the caller for a retry decision.
 *
 * @param {string} [texto]
 * @param {object} [options] `repetido`, `tokenRepetido`, `incompleta`.
 * @returns {{truncado: boolean, senales: string[]}}
 */
export function detectarTruncamiento(texto = "", options = {}) {
  const { repetido = false, tokenRepetido = false, incompleta = false } = options;
  const senales = [];
  if (fenceBalance(texto) === 1) senales.push("cerco_sin_cerrar");
  if (repetido) senales.push("bucle_repeticion");
  if (tokenRepetido) senales.push("identificador_repetido");
  if (incompleta) senales.push("declaracion_incompleta");
  // El desequilibrio de llaves es universal en los lenguajes con bloques y no
  // depende de la etiqueta concreta que use el llamador.
  if (balanceLlaves(texto)) senales.push("llaves_sin_cerrar");
  return { truncado: senales.length > 0, senales };
}

/**
 * Aplica todas las reparaciones deterministas en un orden seguro.
 *
 * @param {string} texto - Respuesta cruda o ya extraída de un bloque.
 * @param {{language?: string}} [options]
 * @returns {{text: string, reparaciones: string[], truncado: boolean, senales: string[]}}
 */
export function repararRespuesta(texto = "", options = {}) {
  const language = String(options.language || "").toLowerCase();
  // En chat, un cerco o un `<style>` pueden ser parte legítima de la
  // explicación. La reparación solo es segura cuando se espera código.
  if (!LENGUAJES_CODIGO.has(language)) {
    return { text: String(texto ?? ""), reparaciones: [], truncado: false, senales: [] };
  }

  const reparaciones = [];
  let resultado = String(texto ?? "");

  const sinPreambulo = stripPreamble(resultado);
  if (sinPreambulo !== resultado) {
    resultado = sinPreambulo;
    reparaciones.push("prologo_eliminado");
  }

  const sinEnvolvente = unwrapTag(resultado);
  if (sinEnvolvente !== resultado) {
    resultado = sinEnvolvente;
    reparaciones.push("envolvente_eliminado");
  }

  const sinRepeticion = trimRepeatedTail(resultado);
  if (sinRepeticion.repetido) {
    resultado = sinRepeticion.text;
    reparaciones.push("repeticion_recortada");
  }

  const tokenRepetido = detectarIdentificadorRepetido(resultado).repetido;

  const sinCola = dropIncompleteTail(resultado);
  if (sinCola.incompleta) {
    resultado = sinCola.text;
    reparaciones.push("cola_incompleta_recortada");
  }

  const sinDuplicados = dropDuplicateBlocks(resultado);
  if (sinDuplicados.eliminados) {
    resultado = sinDuplicados.text;
    reparaciones.push(`bloques_duplicados_eliminados:${sinDuplicados.eliminados}`);
  }

  // Se mide ANTES de cerrar el cerco: el desequilibrio es la señal de que el
  // modelo se cortó, y cerrarlo no debe borrar esa información para el retry.
  const { truncado, senales } = detectarTruncamiento(resultado, {
    repetido: sinRepeticion.repetido,
    tokenRepetido,
    incompleta: sinCola.incompleta,
  });
  if (fenceBalance(resultado) === 1) {
    resultado = `${resultado.replace(/\s+$/, "")}\n\`\`\``;
    reparaciones.push("cerco_cerrado");
  }

  return { text: resultado, reparaciones, truncado, senales };
}

export default {
  countFenceLines,
  fenceBalance,
  unwrapTag,
  stripPreamble,
  trimRepeatedTail,
  detectarIdentificadorRepetido,
  dropIncompleteTail,
  dropDuplicateBlocks,
  balanceLlaves,
  detectarTruncamiento,
  repararRespuesta,
};
