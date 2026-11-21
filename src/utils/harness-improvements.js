/**
 * Harness Improvements - Funciones mejoradas para askAgent.
 *
 * Combina task-enhancer (system prompts + few-shot) y output-validator
 * (validación + auto-corrección) para ayudar al modelo a entregar mejores respuestas.
 *
 * Uso:
 *   import { enhancedAskAgent } from "./src/utils/harness-improvements.js";
 *   const resultado = await enhancedAskAgent({
 *     provider: { provider: "ollama", model: "qwen2.5-coder:3b", baseUrl: "..." },
 *     messages: [{ role: "user", content: "Escribe una función JS..." }],
 *     taskType: "code",
 *     lenguaje: "javascript",
 *     autoCorrect: true,       // Reintentar si hay problemas
 *     maxCorrectionAttempts: 2, // Máximo de intentos de corrección
 *   });
 */

import { askAgent } from "../agent.js";
import { enriquecerMensajes } from "./task-enhancer.js";
import {
  validarHTMLSalida,
  validarCSSSalida,
  validarJSSalida,
  validarCodigoSalida,
  generarPromptCorreccion,
  necesitaCorreccion,
} from "./output-validator.js";
import { extractCodeBlock, extractCodeBlocks, detectRefusal } from "./response-cleaner.js";
import { validateSyntax } from "./syntax-validator.js";
import { createCacheKey } from "./response-cache.js";
import { detectPromptLanguage } from "./system-prompts-en.js";

const VALIDADORES_POR_TIPO = {
  html: validarHTMLSalida,
  css: validarCSSSalida,
  js: validarJSSalida,
  javascript: validarJSSalida,
  code: validarCodigoSalida,
};

function ultimoTextoUsuario(mensajes = []) {
  for (let index = mensajes.length - 1; index >= 0; index -= 1) {
    const mensaje = mensajes[index];
    if (mensaje?.role !== "user") continue;
    if (typeof mensaje.content === "string") return mensaje.content;
    if (Array.isArray(mensaje.content)) {
      return mensaje.content
        .filter((parte) => typeof parte === "string" || parte?.type === "text")
        .map((parte) => (typeof parte === "string" ? parte : parte.text || ""))
        .join("\n");
    }
  }
  return "";
}

/**
 * Los reintentos reconstruyen el turno sin mensajes `tool` (el proveedor no
 * acepta tool_results huérfanos), pero conservan un resumen compacto de lo que
 * ya se ejecutó para que el modelo no pierda el contexto ni repita la tool.
 */
function resumirContextoHerramientas(diagnosticos = {}, maxChars = 2400) {
  const lineas = [];
  for (const execution of diagnosticos.toolExecutions || []) {
    if (execution?.isError) continue;
    const nombre = execution.toolName || execution.toolAlias || "tool";
    const resultado = execution.textResult
      || (execution.rawResult ? JSON.stringify(execution.rawResult) : "");
    if (resultado) lineas.push(`HERRAMIENTA ${nombre}: ${String(resultado).slice(0, 900)}`);
  }
  for (const resultado of diagnosticos.webResults || []) {
    const titulo = resultado?.title || "";
    const url = resultado?.url || "";
    const texto = resultado?.snippet || resultado?.content || "";
    if (titulo || url || texto) {
      lineas.push(`WEB: ${[titulo, url, String(texto).slice(0, 400)].filter(Boolean).join(" — ")}`);
    }
  }
  return lineas.join("\n").slice(0, maxChars);
}

/** Los reintentos deben reconstruir el turno sin mensajes de herramientas. */
function construirMensajesRetry(mensajes = [], promptCorreccion, contextoHerramientas = "") {
  const base = mensajes
    .filter((m) => m.role === 'system' || m.role === 'user')
    .map((m) => ({ role: m.role, content: m.content }));
  const contenido = contextoHerramientas
    ? `${promptCorreccion}\n\nCONTEXTO DE HERRAMIENTAS YA EJECUTADAS (no vuelvas a llamarlas):\n${contextoHerramientas}`
    : promptCorreccion;
  return [...base, { role: 'user', content: contenido }];
}

function primerosProblemasFuncionales(comportamiento = {}) {
  const detalles = (Array.isArray(comportamiento.casos) ? comportamiento.casos : [])
    .filter((caso) => caso?.passed === false)
    .slice(0, 3)
    .map((caso) => `caso funcional "${caso.name}" falló${caso.detail ? `: ${caso.detail}` : ""}`);
  const problemas = Array.isArray(comportamiento.problemas)
    ? comportamiento.problemas.slice(0, 3)
    : [];
  if (comportamiento.ok === false && detalles.length === 0 && problemas.length === 0) {
    detalles.push("la validación funcional falló");
  }
  return [...detalles, ...problemas];
}

function temperaturaParaRetry(provider) {
  const valor = Number(provider?.temperature);
  if (Number.isFinite(valor)) return Math.max(0, valor * 0.5);
  return 0.35;
}

/**
 * Un reintento con la misma semilla y la misma temperatura suele repetir el
 * error. Se baja la temperatura y se retira la semilla fija solo en reintentos.
 */
function providerParaRetry(provider) {
  const siguiente = { ...provider, temperature: temperaturaParaRetry(provider) };
  delete siguiente.seed;
  delete siguiente.seed_alias;
  return siguiente;
}

/** Unifica la validación de la respuesta inicial y de cada reintento. */
async function evaluarTexto({ texto, taskType, lenguaje, validarSintaxis, validarComportamiento }) {
  const validador = VALIDADORES_POR_TIPO[taskType];
  let validacion;
  if (validador) {
    const indicadores = taskType === 'code' && lenguaje ? obtenerIndicadores(lenguaje) : [];
    validacion = taskType === 'code' && lenguaje
      ? validador(texto, indicadores)
      : validador(texto);
  } else {
    validacion = { valido: true, puntuacion: 100, problemas: [] };
  }

  let sintaxis = null;
  if (validarSintaxis && lenguaje) {
    sintaxis = await validateSyntax(texto, lenguaje);
    if (sintaxis.supported && sintaxis.valid === false) {
      validacion = {
        ...validacion,
        valido: false,
        puntuacion: Math.max(0, validacion.puntuacion - 30),
        problemas: [...validacion.problemas, `Error de sintaxis: ${sintaxis.error}`],
      };
    }
  }

  // La validación funcional es un hook del harness: el core sigue siendo
  // agnóstico al lenguaje. Si el código compila pero no hace lo pedido, la
  // puntuación final es la peor de las dos capas y se dispara el reintento.
  let comportamiento = null;
  if (typeof validarComportamiento === "function") {
    try {
      const resultado = await validarComportamiento({ texto, taskType, lenguaje });
      const puntuacion = Number(resultado?.puntuacion);
      if (resultado && resultado.soportado !== false && Number.isFinite(puntuacion)) {
        comportamiento = { ...resultado, puntuacion };
        validacion = {
          ...validacion,
          valido: validacion.valido && resultado.ok !== false,
          puntuacion: Math.min(validacion.puntuacion, puntuacion),
          problemas: [...validacion.problemas, ...primerosProblemasFuncionales(comportamiento)],
        };
      }
    } catch (error) {
      comportamiento = {
        soportado: false,
        ok: null,
        puntuacion: null,
        problemas: [],
        error: String(error?.message || error),
      };
    }
  }

  return { validacion, sintaxis, comportamiento };
}

/**
 * Llamada mejorada a askAgent con enriquecimiento de tarea y auto-corrección.
 *
 * @param {object} options - Opciones de askAgent plus:
 *   @param {string} [taskType] - "chat", "code", "html", "css", "js", "web"
 *   @param {string} [lenguaje] - Lenguaje de programación (ej. "javascript", "python")
 *   @param {string} [idiomaSystemPrompt] - "en", "es" o "auto" (detecta el idioma del prompt; default)
 *   @param {boolean} [autoCorrect] - Si es true, valida y reintenta si hay problemas
 *   @param {number} [maxCorrectionAttempts] - Máximo de intentos de corrección (default: 2)
 *   @param {number} [umbralPuntuacion] - Puntuación mínima aceptable (default: 70)
 *   @param {Function} [validarComportamiento] - Hook opcional que puntúa si el código hace lo pedido
 *   @param {boolean} [contextoHerramientasEnRetry] - Incluye un resumen de tools ya ejecutadas (default: true)
 * @returns {Promise<{text: string, diagnosticos: object, intentos: number, mejorasAplicadas: string[]}>}
 */
export async function enhancedAskAgent(options = {}) {
  const {
    taskType,
    lenguaje,
    idiomaSystemPrompt = "auto",
    autoCorrect = false,
    maxCorrectionAttempts = 2,
    umbralPuntuacion = 70,
    validarSintaxis = false,
    validarComportamiento,
    validarComportamientoId,
    contextoHerramientasEnRetry = true,
    cache,
    ...askAgentOptions
  } = options;

  const cacheKey = cache ? createCacheKey(options) : null;
  if (cache && typeof cache.get === "function") {
    const cached = cache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        diagnosticos: { ...cached.diagnosticos, fromCache: true },
        desdeCache: true,
      };
    }
  }

  const mejorasAplicadas = [];
  let intentos = 0;
  let mensajes = askAgentOptions.messages || [];
  let ultimaValidacionSintaxis = null;
  let ultimaValidacionComportamiento = null;
  const idiomaEfectivo = idiomaSystemPrompt === "auto"
    ? (detectPromptLanguage(ultimoTextoUsuario(mensajes)) || "en")
    : idiomaSystemPrompt;

  // Paso 1: Enriquecer mensajes con system prompt y few-shot si se especifica taskType
  if (taskType && taskType !== 'chat') {
    mensajes = enriquecerMensajes(mensajes, taskType, lenguaje, idiomaEfectivo);
    mejorasAplicadas.push(`system_prompt_${taskType}_${idiomaEfectivo}`);
    if (lenguaje) mejorasAplicadas.push(`fewshot_${lenguaje}`);
  }

  // Paso 2: Llamada inicial
  let resultado = await askAgent({
    ...askAgentOptions,
    messages: mensajes,
    includeDiagnostics: true,
  });
  intentos++;

  let texto = resultado.text;
  const diagnosticosIniciales = resultado.diagnostics || {};

  // Paso 3: Auto-corrección si está habilitada y hay problemas.
  // Cada reintento se puntúa con el mismo validador y solo se acepta si
  // mejora de verdad: antes se aceptaba cualquier texto más largo, aunque
  // fuera peor o estuviera contaminado con HTML/CSS.
  if (autoCorrect && taskType && texto) {
    let intentosCorreccion = 0;
    let necesitaMasCorreccion = true;
    const contextoHerramientas = contextoHerramientasEnRetry
      ? resumirContextoHerramientas(diagnosticosIniciales)
      : "";
    if (contextoHerramientas) mejorasAplicadas.push("contexto_herramientas_en_retry");

    while (necesitaMasCorreccion && intentosCorreccion < maxCorrectionAttempts) {
      const textoLimpio = extractCodeBlock(texto, lenguaje || undefined);
      const refusal = detectRefusal(textoLimpio, taskType);
      const evaluacion = await evaluarTexto({
        texto: textoLimpio,
        taskType,
        lenguaje,
        validarSintaxis,
        validarComportamiento,
      });
      ultimaValidacionSintaxis = evaluacion.sintaxis;
      ultimaValidacionComportamiento = evaluacion.comportamiento;
      const puntuacionActual = evaluacion.validacion.puntuacion;
      const problemas = [...evaluacion.validacion.problemas];

      if (refusal.refused || refusal.reason) {
        problemas.push(refusal.reason || 'respuesta rechazada por el modelo');
      }

      if (!refusal.refused && !refusal.reason && !necesitaCorreccion(evaluacion.validacion, umbralPuntuacion)) {
        texto = textoLimpio;
        necesitaMasCorreccion = false;
        mejorasAplicadas.push(`validacion_ok_p${puntuacionActual}`);
        break;
      }

      const motivo = refusal.refused
        ? `El modelo se negó a generar el contenido (${refusal.reason})`
        : refusal.reason
          ? `Se detectó contaminación en la salida (${refusal.reason})`
          : `La validación detectó ${problemas.length} problema(s)`;
      const promptCorreccion = [
        motivo,
        '',
        generarPromptCorreccion(
          textoLimpio,
          taskType,
          problemas.length ? problemas : evaluacion.validacion.problemas,
          askAgentOptions.prompt || mensajes[mensajes.length - 1]?.content || '',
        ),
      ].join('\n');

      const resultadoRetry = await askAgent({
        ...askAgentOptions,
        messages: construirMensajesRetry(mensajes, promptCorreccion, contextoHerramientas),
        includeDiagnostics: true,
        provider: providerParaRetry(askAgentOptions.provider),
      });
      intentos++;
      intentosCorreccion++;

      const textoRetry = extractCodeBlock(resultadoRetry.text, lenguaje || undefined);
      const evaluacionRetry = await evaluarTexto({
        texto: textoRetry,
        taskType,
        lenguaje,
        validarSintaxis,
        validarComportamiento,
      });
      const refusalRetry = detectRefusal(textoRetry, taskType);
      // Aceptar solo si puntúa más o si alcanza el umbral empatando la
      // puntuación anterior. Nunca aceptar una salida rechazada/contaminada.
      const alcanzaUmbral = !necesitaCorreccion(evaluacionRetry.validacion, umbralPuntuacion);
      const mejora = evaluacionRetry.validacion.puntuacion > puntuacionActual
        || (alcanzaUmbral && evaluacionRetry.validacion.puntuacion >= puntuacionActual);

      if (textoRetry && !refusalRetry.refused && !refusalRetry.reason && mejora) {
        texto = textoRetry;
        ultimaValidacionSintaxis = evaluacionRetry.sintaxis;
        ultimaValidacionComportamiento = evaluacionRetry.comportamiento;
        mejorasAplicadas.push(`correccion_${intentosCorreccion}_p${evaluacionRetry.validacion.puntuacion}`);
        continue;
      }

      texto = textoLimpio;
      necesitaMasCorreccion = false;
      mejorasAplicadas.push(`reintento_descartado_${intentosCorreccion}`);
    }
  }

  const respuestaFinal = {
    text: texto,
    usage: diagnosticosIniciales.usage ?? resultado?.usage ?? null,
    toolExecutions: diagnosticosIniciales.toolExecutions ?? [],
    webResults: diagnosticosIniciales.webResults ?? [],
    diagnosticos: {
      ...diagnosticosIniciales,
      mejorasAplicadas,
      intentos,
      taskType,
      lenguaje,
      idiomaSystemPrompt,
      idiomaEfectivo,
      bloques: extractCodeBlocks(texto),
      ...(ultimaValidacionSintaxis ? { sintaxis: ultimaValidacionSintaxis } : {}),
      ...(ultimaValidacionComportamiento ? { comportamiento: ultimaValidacionComportamiento } : {}),
    },
    intentos,
    mejorasAplicadas,
    ...(ultimaValidacionSintaxis ? { sintaxis: ultimaValidacionSintaxis } : {}),
    ...(ultimaValidacionComportamiento ? { comportamiento: ultimaValidacionComportamiento } : {}),
  };

  if (cache && typeof cache.set === "function") {
    cache.set(cacheKey, respuestaFinal);
  }

  return respuestaFinal;
}

/**
 * Obtiene indicadores de validación para un lenguaje de programación.
 *
 * @param {string} lenguaje - "javascript", "python", "html", "css", etc.
 * @returns {Array<[nombre, RegExp]>}
 */
function obtenerIndicadores(lenguaje) {
  const indicadoresPorLenguaje = {
    javascript: [
      ['funcion', /function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>/],
      ['retorno', /return/],
      ['comentarios', /\/\/|\/\*/],
    ],
    python: [
      ['funcion', /def\s+\w+/],
      ['manejoErrores', /try\s*:|except/],
      ['abrirArchivo', /open\(/],
    ],
  };
  return indicadoresPorLenguaje[lenguaje] || [];
}

export default { enhancedAskAgent };
