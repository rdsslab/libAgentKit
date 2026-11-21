/**
 * Runner E2E canónico (corrige los runners anteriores).
 *
 * - P01 respuesta, P02 herramientas (IP local + búsqueda web real), P03
 *   coherencia (con historial real), P04 compaction real, P05 código,
 *   P06 landing page.
 * - Enforcea responseTimeout en el provider y con AbortSignal.
 * - Envía el system prompt del preset (ahora consumido por askAgent).
 * - Guarda artefactos y metadata de modelo/core por modelo.
 * - Añade puntuación de calidad y validación sintáctica real.
 *
 * Uso:
 *   node tests/e2e/run_canonical.mjs --suite=local
 *   node tests/e2e/run_canonical.mjs --suite=remote --models=lfm3-omni:latest
 *   node tests/e2e/run_canonical.mjs --suite=tools
 *   node tests/e2e/run_canonical.mjs --suite=idioma
 *   node tests/e2e/run_canonical.mjs --suite=quality
 *   node tests/e2e/run_canonical.mjs --suite=tools --offline
 */

import { askAgent } from "../../src/agent.js";
import { getModelConfig, MODEL_PRESETS } from "../../src/config/presets.js";
import { getSystemPromptES, getSystemPromptEN } from "../../src/utils/system-prompts-en.js";
import { enhancedAskAgent } from "../../src/utils/harness-improvements.js";
import {
  blocksByLanguage,
  firstBlock,
  mergeBlocks,
  missingBlockLanguages,
  sanitizeToolName,
} from "../utils/e2e-helpers.js";
import { validateCodeBehavior, validateLandingWiring } from "../utils/code-behavior.js";
import { validateSyntax } from "../../src/utils/syntax-validator.js";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const RESULTS_DIR = path.join(SCRIPT_DIR, "resultados_por_modelo");

const LOCAL_URL = "http://localhost:11434";
const REMOTE_URL = "http://192.168.100.126:11434";
// `--offline` sustituye DuckDuckGo por un fixture; se fija antes de ejecutar.
let OFFLINE = false;
let PROVIDER_OVERRIDE = null;

const SUITES = {
  local: [
    { label: "local", model: "lfm3-omni:2b", baseUrl: LOCAL_URL },
  ],
  remote: [
    { label: "remoto", model: "lfm3-omni:latest", baseUrl: REMOTE_URL },
    { label: "remoto", model: "qwen2.5-coder:3b", baseUrl: REMOTE_URL },
    { label: "remoto", model: "qwen2.5:1.5b-instruct", baseUrl: REMOTE_URL },
  ],
  tools: [
    { label: "local", model: "lfm3-omni:2b", baseUrl: LOCAL_URL },
    { label: "remoto", model: "lfm3-omni:latest", baseUrl: REMOTE_URL },
    { label: "remoto", model: "qwen2.5-coder:3b", baseUrl: REMOTE_URL },
  ],
  idioma: [
    { label: "local", model: "lfm3-omni:2b", baseUrl: LOCAL_URL },
  ],
  quality: [
    { label: "local", model: "lfm3-omni:2b", baseUrl: LOCAL_URL },
    { label: "remoto", model: "lfm3-omni:latest", baseUrl: REMOTE_URL },
    { label: "remoto", model: "qwen2.5-coder:3b", baseUrl: REMOTE_URL },
  ],
};

const TIMEOUT_BASE = {
  chat: 90000,
  tools: 120000,
  longContext: 120000,
  code: 150000,
  web: 180000,
};

const MAX_TOKENS = {
  local: { chat: 512, tools: 384, longContext: 768, code: 700, web: 1200 },
  remoto: { chat: 256, tools: 256, longContext: 384, code: 450, web: 600 },
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (name, fallback) => {
    const found = args.find((arg) => arg.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : fallback;
  };
  return {
    suite: get("suite", "local"),
    models: get("models", null),
    output: get("output", "RESUMEN_CANONICO.md"),
    provider: get("provider", null),
    offline: args.includes("--offline"),
  };
};

const slug = (value) => value.replace(/[^a-zA-Z0-9._-]+/g, "_");

const scoreChecks = (checks) => ({
  checks,
  puntuacion: Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100),
});

function scoreHTML(text) {
  return scoreChecks({
    doctype: /<!DOCTYPE\s+html>/i.test(text),
    html: /<html[^>]*>/i.test(text),
    head: /<head[^>]*>/i.test(text),
    body: /<body[^>]*>/i.test(text),
    header: /<header/i.test(text),
    form: /<form/i.test(text),
    linkCSS: /style\.css/i.test(text),
    linkJS: /script\.js/i.test(text),
    accesible: /aria-|role=|<label/i.test(text),
    cssSeparado: !/<style\b/i.test(text),
    jsSeparado: !/<script\b/i.test(text),
  });
}

function scoreCSS(text) {
  return scoreChecks({
    body: /body\s*\{/i.test(text),
    hover: /:hover/.test(text),
    mediaQuery: /@media/.test(text),
    variables: /--[\w-]+\s*:/.test(text),
    boxSizing: /box-sizing/.test(text),
    hexColor: /#[0-9a-fA-F]{3,6}/.test(text),
    transicion: /transition/.test(text),
    noHTML: !/<\/?(html|body|head|div|section)\b/i.test(text),
  });
}

async function scoreJS(text) {
  const checks = scoreChecks({
    eventListener: /addEventListener/.test(text),
    dom: /getElementById|querySelector/.test(text),
    funcion: /function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>/.test(text),
    validacion: /validity|checkValidity|preventDefault|trim\(/.test(text),
    noJQuery: !/\$\s*\(|jQuery/.test(text),
    noHTML: !/<!DOCTYPE|<html/i.test(text),
  });
  const syntax = await validateSyntax(text, "javascript");
  return {
    ...checks,
    sintaxis: syntax.supported ? { valida: syntax.valid, error: syntax.error } : { valida: null, motivo: syntax.error },
    puntuacion: Math.max(0, checks.puntuacion - (syntax.valid === false ? 30 : 0)),
  };
}

async function scoreCode(text, language) {
  const checks = scoreChecks({
    tieneContenido: text.trim().length > 30,
    tieneComentarios: /\/\/|\/\*[\s\S]*?\*\/|#/.test(text),
    noPlaceholders: !/TODO|FIXME|placeholder|lorem ipsum/i.test(text),
    noExplicacion: !/^(lo siento|no puedo|as an ai|i'm sorry)/i.test(text.trim()),
  });
  const syntax = language && ["javascript", "python"].includes(language)
    ? await validateSyntax(text, language)
    : { supported: false, valid: null, error: "unsupported" };
  // La puntuación clásica se conserva para comparar con los baselines; la
  // ejecución real se reporta aparte en `funcional`.
  const funcional = validateCodeBehavior(text, language);
  return {
    ...checks,
    sintaxis: syntax.supported ? { valida: syntax.valid, error: syntax.error } : { valida: null, motivo: syntax.error },
    funcional,
    puntuacion: Math.max(0, checks.puntuacion - (syntax.valid === false ? 25 : 0)),
  };
}

/** Extrae CSS/JS incrustados para puntuar el contenido aunque no estén separados. */
function extractEmbeddedAssets(html = "") {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n")
    .trim();
  const js = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .join("\n")
    .trim();
  return { css, js };
}

const scoreThreeFiles = (scores) => Math.round(
  [scores.html, scores.css, scores.js].reduce((sum, item) => sum + (item?.puntuacion || 0), 0) / 3,
);

const normalizeToolExecutions = (executions = []) => (Array.isArray(executions) ? executions : []).map((execution) => ({
  tool: execution.toolAlias || execution.toolName || "unknown_tool",
  toolName: execution.toolName || execution.toolAlias || null,
  ok: execution.isError !== true,
  deduplicated: Boolean(execution.deduplicated),
  arguments: execution.arguments || null,
  result: execution.rawResult ?? execution.textResult ?? null,
}));

const toolResultText = (execution) => {
  const value = execution?.result;
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
};

async function callAgent({
  target,
  taskType,
  prompt,
  history = [],
  system,
  timeoutMs,
  autoCompact,
  maxTokensOverride,
  providerOverrides = {},
  presetTaskType,
  enhanced = false,
  enhancedOptions = {},
  tools = {},
  toolHandlers = {},
  capabilities,
  preSearch,
  webSearchOptions,
  webSearchFn,
}) {
  const maxTokens = Number(maxTokensOverride) > 0
    ? Number(maxTokensOverride)
    : (MAX_TOKENS[target.label][taskType] || 512);
  // El valor de la política es un mínimo sugerido; nunca bajamos del techo
  // base de la tarea (P06 necesita bastante más que chat).
  const effectiveTimeout = Math.max(
    Number(timeoutMs) || 0,
    TIMEOUT_BASE[taskType] || 120000,
  );
  const baseConfig = getModelConfig(target.model, presetTaskType || taskType, {
    baseUrl: target.baseUrl,
    maxTokens,
    // El adapter usa `timeout` para el cliente OpenAI y `responseTimeout`
    // para el AbortSignal de la ejecución.
    timeout: effectiveTimeout,
    responseTimeout: effectiveTimeout,
    ...(system ? { system } : {}),
    ...(PROVIDER_OVERRIDE ? { provider: PROVIDER_OVERRIDE } : {}),
    ...providerOverrides,
  });

  const effectiveCapabilities = capabilities || {
    terminal: false, web: false, mcp: false,
    documents: false, artifacts: false, filesystem: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("E2E global timeout")), effectiveTimeout + 5000);
  const started = Date.now();

  try {
    let result;
    if (enhanced) {
      result = await enhancedAskAgent({
        ...enhancedOptions,
        provider: baseConfig,
        messages: [...history, { role: "user", content: prompt }],
        signal: controller.signal,
      });
    } else {
      result = await askAgent({
        provider: baseConfig,
        messages: [...history, { role: "user", content: prompt }],
        capabilities: effectiveCapabilities,
        includeDiagnostics: true,
        autoCompact,
        signal: controller.signal,
        tools,
        toolHandlers,
        ...(preSearch !== undefined ? { preSearch } : {}),
        ...(webSearchOptions ? { webSearch: webSearchOptions } : {}),
        ...(webSearchFn ? { webSearchFn } : {}),
      });
    }

    const duracionMs = Date.now() - started;
    const usage = result?.usage || result?.diagnosticos?.usage || null;
    const toolExecutions = normalizeToolExecutions(
      result?.diagnostics?.toolExecutions || result?.toolExecutions,
    );
    return {
      ok: true,
      duracionMs,
      texto: result?.text || "",
      usage,
      tokensPorSegundo: usage?.tokens_per_second || null,
      compaction: result?.compaction || result?.diagnosticos?.compaction || null,
      intentos: result?.intentos || result?.diagnosticos?.intentos || null,
      mejoras: result?.mejorasAplicadas || null,
      comportamiento: result?.comportamiento || result?.diagnosticos?.comportamiento || null,
      systemPrompt: baseConfig.system || system || null,
      hasTools: Boolean(result?.hasTools),
      usedWeb: Boolean(result?.usedWeb),
      webQuery: result?.webQuery || "",
      webSource: result?.webSource || null,
      webResults: result?.webResults || [],
      toolExecutions,
      config: {
        model: target.model,
        baseUrl: target.baseUrl,
        taskType,
        presetTaskType: presetTaskType || taskType,
        maxTokens,
        timeoutMs: effectiveTimeout,
        temperature: baseConfig.temperature,
        top_p: baseConfig.top_p,
        top_k: baseConfig.top_k,
        repeat_penalty: baseConfig.repeat_penalty,
        num_ctx: baseConfig.num_ctx,
        toolChoice: baseConfig.toolChoice ?? baseConfig.tool_choice ?? null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      duracionMs: Date.now() - started,
      texto: "",
      error: String(error?.message || error),
      hasTools: false,
      usedWeb: false,
      toolExecutions: [],
      config: { model: target.model, baseUrl: target.baseUrl, taskType, timeoutMs: effectiveTimeout },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runP01(target, policy) {
  const timeout = policy.get(target.model, { maxTokens: MAX_TOKENS[target.label].chat });
  const result = await callAgent({
    target,
    taskType: "chat",
    prompt: "Explica en máximo 3 oraciones qué es React y para qué sirve.",
    timeoutMs: timeout,
  });
  if (result.ok) policy.record(target.model, result.duracionMs, result.tokensPorSegundo);
  return {
    exito: result.ok,
    duracionMs: result.duracionMs,
    tokensPorSegundo: result.tokensPorSegundo,
    respuesta: result.texto?.slice(0, 300),
    error: result.error || null,
    systemPromptEnviado: Boolean(result.systemPrompt),
    config: result.config,
  };
}

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && entry.address) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

const forcedToolChoice = (name) => ({
  type: "function",
  function: { name: sanitizeToolName(name) },
});

async function callP02WithFallback({
  target,
  policy,
  prompt,
  tools,
  toolHandlers,
  capabilities,
  preSearch,
  webSearchOptions,
  webSearchFn,
  forcedTool,
}) {
  const timeout = policy.get(target.model, { maxTokens: MAX_TOKENS[target.label].tools });
  const baseArgs = {
    target,
    taskType: "tools",
    presetTaskType: "chat",
    prompt,
    timeoutMs: timeout,
    tools,
    toolHandlers,
    capabilities,
    preSearch,
    webSearchOptions,
    webSearchFn,
  };

  const first = await callAgent(baseArgs);
  if (first.ok) policy.record(target.model, first.duracionMs, first.tokensPorSegundo);
  first.toolChoiceForzado = false;

  const llamoHerramienta = (attempt) => attempt.toolExecutions
    .some((execution) => execution.tool === forcedTool && execution.ok);
  if (llamoHerramienta(first)) {
    return { intentos: [first], resultado: first, duracionMs: first.duracionMs };
  }

  // Los modelos pequeños a veces ignoran la tool aunque esté expuesta. El
  // segundo intento fuerza `tool_choice` para medir la herramienta en sí, no
  // solo la docilidad del modelo al decidir cuándo usarla.
  const second = await callAgent({
    ...baseArgs,
    providerOverrides: { toolChoice: forcedToolChoice(forcedTool) },
  });
  if (second.ok) policy.record(target.model, second.duracionMs, second.tokensPorSegundo);
  second.toolChoiceForzado = true;
  return {
    intentos: [first, second],
    resultado: second.ok ? second : first,
    duracionMs: first.duracionMs + second.duracionMs,
  };
}

const allExecutions = (intentos) => intentos.flatMap((intento) => intento.toolExecutions || []);
const allWebResults = (intentos) => intentos.flatMap((intento) => intento.webResults || []);

async function runP02LocalIp(target, policy) {
  const ipEsperada = getLocalIPv4();
  const herramientas = {
    get_local_ip: {
      description: "Devuelve la dirección IPv4 no loopback de la máquina local donde corre el agente.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      policy: { oneShot: true },
      handler: async () => ({ ok: true, ip: ipEsperada }),
    },
  };

  const { intentos, resultado, duracionMs } = await callP02WithFallback({
    target,
    policy,
    prompt: "Llama a la herramienta get_local_ip para obtener la dirección IPv4 local de esta máquina. Responde únicamente con la IP que devuelva la herramienta, sin inventar datos.",
    tools: { get_local_ip: true },
    toolHandlers: herramientas,
    capabilities: {
      terminal: false, web: false, mcp: false,
      documents: false, artifacts: false, filesystem: false,
      tools: { get_local_ip: true },
    },
    forcedTool: "get_local_ip",
  });

  const ejecuciones = allExecutions(intentos);
  const ipToolOk = ejecuciones.some((execution) => (
    execution.tool === "get_local_ip"
    && execution.ok
    && toolResultText(execution).includes(ipEsperada)
  ));
  const respuestaIncluyeIp = resultado.texto.includes(ipEsperada);

  return {
    exito: resultado.ok && ipToolOk && respuestaIncluyeIp,
    duracionMs,
    ipEsperada,
    herramientaLlamada: ejecuciones.some((execution) => execution.tool === "get_local_ip"),
    herramientaOk: ipToolOk,
    respuestaIncluyeIp,
    toolChoiceForzado: intentos.some((intento) => intento.toolChoiceForzado),
    respuesta: resultado.texto?.slice(0, 300),
    ejecuciones,
    intentos: intentos.map((intento) => ({
      duracionMs: intento.duracionMs,
      exito: intento.ok,
      toolChoiceForzado: intento.toolChoiceForzado,
      error: intento.error || null,
    })),
    error: resultado.error || null,
    config: resultado.config,
  };
}

/** Fixture determinista: misma forma que `webSearch`, sin tocar la red. */
const offlineWebSearch = async ({ query = "", maxResults = 3 } = {}) => ({
  ok: true,
  source: "fixture-offline",
  query,
  results: Array.from({ length: Math.min(Number(maxResults) || 3, 3) }, (_, index) => ({
    title: index === 0 ? "Capital de Ecuador: Quito" : `Resultado fixture ${index + 1} para ${query}`,
    url: `https://fixture.local/?q=${encodeURIComponent(query)}&n=${index + 1}`,
    snippet: index === 0
      ? "Según la fuente fixture, la capital de Ecuador es Quito."
      : "Dato complementario del fixture sin conexión.",
  })),
  errors: [],
});

async function runP02Web(target, policy) {
  const datoEsperado = "Quito";
  const { intentos, resultado, duracionMs } = await callP02WithFallback({
    target,
    policy,
    prompt: "Busca en internet cuál es la capital de Ecuador. Usa la herramienta web_search con esa pregunta y responde únicamente con el nombre de la capital que aparezca en los resultados. No respondas de memoria.",
    tools: { web_search: true },
    toolHandlers: {},
    capabilities: {
      terminal: false, web: true, mcp: false,
      documents: false, artifacts: false, filesystem: false,
    },
    preSearch: false,
    webSearchOptions: {
      maxResults: 3,
      timeoutMs: 15000,
      maxInjectedContextChars: 3000,
    },
    webSearchFn: OFFLINE ? offlineWebSearch : undefined,
    forcedTool: "web_search",
  });

  const ejecuciones = allExecutions(intentos);
  const resultados = allWebResults(intentos);
  const webToolOk = ejecuciones.some((execution) => execution.tool === "web_search" && execution.ok);
  const resultadosContienenDato = resultados.some((item) => (
    new RegExp(datoEsperado, "i").test(`${item.title || ""} ${item.snippet || ""}`)
  ));
  const respuestaContieneDato = new RegExp(datoEsperado, "i").test(resultado.texto || "");

  return {
    exito: resultado.ok && webToolOk && resultadosContienenDato && respuestaContieneDato,
    duracionMs,
    datoEsperado,
    herramientaLlamada: ejecuciones.some((execution) => execution.tool === "web_search"),
    herramientaOk: webToolOk,
    resultadosContienenDato,
    respuestaContieneDato,
    usedWeb: Boolean(resultado.usedWeb),
    webQuery: resultado.webQuery || null,
    webSource: resultado.webSource || null,
    toolChoiceForzado: intentos.some((intento) => intento.toolChoiceForzado),
    respuesta: resultado.texto?.slice(0, 300),
    resultadosWeb: resultados.slice(0, 5),
    ejecuciones,
    intentos: intentos.map((intento) => ({
      duracionMs: intento.duracionMs,
      exito: intento.ok,
      toolChoiceForzado: intento.toolChoiceForzado,
      error: intento.error || null,
    })),
    error: resultado.error || null,
    config: resultado.config,
  };
}

async function runP02(target, policy) {
  const ip = await runP02LocalIp(target, policy);
  const web = await runP02Web(target, policy);
  return {
    exito: ip.exito && web.exito,
    ip,
    web,
  };
}

async function runP03(target, policy) {
  const textos = [
    "Mi nombre es María y tengo una clínica veterinaria llamada Patitas Felices.",
    "Atendemos perros, gatos, aves y conejos. Ofrecemos consultas, cirugías y hospitalización.",
    "¿Puedes recordar cuál es mi nombre y el nombre de mi clínica?",
    "¿Qué servicios ofrecemos en la clínica?",
  ];
  const history = [];
  const turnos = [];

  for (const texto of textos) {
    const timeout = policy.get(target.model, { maxTokens: MAX_TOKENS[target.label].chat });
    const result = await callAgent({ target, taskType: "chat", prompt: texto, history, timeoutMs: timeout });
    if (result.ok) policy.record(target.model, result.duracionMs, result.tokensPorSegundo);
    turnos.push({
      usuario: texto,
      respuesta: result.texto,
      exito: result.ok,
      duracionMs: result.duracionMs,
      error: result.error || null,
    });
    if (result.ok) {
      history.push({ role: "user", content: texto });
      history.push({ role: "assistant", content: result.texto });
    }
  }

  const t3 = turnos[2]?.respuesta || "";
  const t4 = turnos[3]?.respuesta || "";
  return {
    exito: turnos.every((turno) => turno.exito),
    historialEnviado: true,
    recuerdaNombre: /mar[ií]a/i.test(t3),
    recuerdaClinica: /patitas felices/i.test(t3),
    recuerdaServicios: /consulta|cirug[ií]a|hospitalizaci[oó]n/i.test(t4),
    turnos,
  };
}

async function runP04(target, policy) {
  const history = [];
  for (let index = 0; index < 45; index += 1) {
    history.push({
      role: "user",
      content: `Mensaje ${index}: contexto de relleno con detalles operativos de la prueba ${index}. `.repeat(4),
    });
    history.push({
      role: "assistant",
      content: `Respuesta ${index}: confirmado el contexto ${index}. `.repeat(4),
    });
  }
  // Dato enterrado al inicio: solo sobrevivirá si la compactación funciona.
  history.splice(2, 0, {
    role: "user",
    content: "DATO CLAVE IMPORTANTE: el color favorito del equipo es verdeota-73.",
  });

  const summarize = async (messages) => messages
    .map((message) => String(message?.content || ""))
    .filter((content) => /DATO CLAVE|color favorito/i.test(content))
    .join("\n") || "Sin datos clave";

  const timeout = policy.get(target.model, { maxTokens: MAX_TOKENS[target.label].longContext });
  const result = await callAgent({
    target,
    taskType: "longContext",
    prompt: "Usando el dato clave de la conversación, ¿cuál es el color favorito del equipo? Responde solo el color.",
    history,
    timeoutMs: timeout,
    // Forzamos una ventana conocida para que el umbral del 25% sea verificable.
    providerOverrides: { contextLength: 16384 },
    autoCompact: {
      thresholdPercent: 25,
      strategy: "summary",
      keepLastMessages: 4,
      summarize,
    },
  });
  if (result.ok) policy.record(target.model, result.duracionMs, result.tokensPorSegundo);

  return {
    exito: result.ok,
    compactionTriggered: Boolean(result.compaction?.triggered),
    compaction: result.compaction,
    recuerdaDato: /verdeota-73/i.test(result.texto),
    respuesta: result.texto?.slice(0, 300),
    error: result.error || null,
  };
}

async function runP05(target, policy) {
  const tareas = [
    {
      lenguaje: "javascript",
      prompt: "Escribe una función isValidEmail(email) en JavaScript que valide un email básico. Devuelve solo el código.",
    },
    {
      lenguaje: "python",
      prompt: "Escribe una función leer_archivo(ruta) en Python que lea un archivo de texto y maneje errores. Devuelve solo el código.",
    },
  ];
  const salidas = {};

  for (const tarea of tareas) {
    const timeout = policy.get(target.model, { maxTokens: MAX_TOKENS[target.label].code });
    const result = await callAgent({ target, taskType: "code", prompt: tarea.prompt, timeoutMs: timeout });
    if (result.ok) policy.record(target.model, result.duracionMs, result.tokensPorSegundo);
    const codigo = firstBlock(result.texto, tarea.lenguaje);
    const calidad = await scoreCode(codigo, tarea.lenguaje);
    salidas[tarea.lenguaje] = {
      exito: result.ok,
      duracionMs: result.duracionMs,
      calidad,
      codigo,
      error: result.error || null,
      systemPromptEnviado: Boolean(result.systemPrompt),
    };
  }

  const funcionales = Object.values(salidas)
    .map((item) => item.calidad?.funcional)
    .filter((item) => item?.soportado);
  return {
    exito: Object.values(salidas).every((item) => item.exito),
    puntuacionMedia: Math.round(
      Object.values(salidas).reduce((sum, item) => sum + (item.calidad?.puntuacion || 0), 0) / tareas.length,
    ),
    funcionalMedia: funcionales.length
      ? Math.round(funcionales.reduce((sum, item) => sum + item.puntuacion, 0) / funcionales.length)
      : null,
    funcionalOk: funcionales.length > 0 && funcionales.every((item) => item.ok),
    salidas,
  };
}

async function runP06(target, policy) {
  const prompt = `Crea una landing page responsive para una clínica veterinaria.
Genera TRES bloques de código separados y etiquetados:
\`\`\`html -> index.html con DOCTYPE, header, formulario y enlaces a style.css y script.js
\`\`\`css -> style.css con :root, :hover y @media
\`\`\`js -> script.js con addEventListener, validación de formulario y DOM
No incluyas explicaciones fuera de los bloques.`;

  const timeout = policy.get(target.model, { maxTokens: MAX_TOKENS[target.label].web });
  const result = await callAgent({ target, taskType: "web", prompt, timeoutMs: timeout });
  if (result.ok) policy.record(target.model, result.duracionMs, result.tokensPorSegundo);

  const bloquesIniciales = blocksByLanguage(result.texto);
  const embebidosIniciales = bloquesIniciales.html
    ? extractEmbeddedAssets(bloquesIniciales.html)
    : { css: "", js: "" };
  const faltantes = result.ok
    ? missingBlockLanguages(result.texto, { embedded: embebidosIniciales })
    : [];

  // `MAX_TOKENS.web` es ajustado (600 en remoto): es normal que el tercer
  // archivo se trunque. Pedir solo lo que falta recupera el bloque sin
  // repetir los dos anteriores ni pagar una regeneración completa.
  let continuacion = null;
  let bloques = bloquesIniciales;
  if (faltantes.length) {
    const nombres = { html: "index.html", css: "style.css", js: "script.js" };
    const requisitos = {
      html: "DOCTYPE, header, formulario y enlaces a style.css y script.js",
      css: ":root, :hover y @media",
      js: "addEventListener, validación de formulario y DOM",
    };
    const promptContinuacion = faltantes.length === 1
      ? [
          `Devuelve ÚNICAMENTE el contenido de ${nombres[faltantes[0]]} en un bloque Markdown etiquetado como \`${faltantes[0]}\`.`,
          `Requisitos: ${requisitos[faltantes[0]]}.`,
          "Sin HTML, sin CSS, sin explicaciones y sin repetir otros archivos.",
        ].join("\n")
      : [
          `Devuelve ÚNICAMENTE ${faltantes.map((key) => nombres[key]).join(" y ")}, cada archivo en su bloque Markdown etiquetado (\`${faltantes.join("`, `")}\`).`,
          `Requisitos: ${faltantes.map((key) => `${key}: ${requisitos[key]}`).join("; ")}.`,
          "Sin explicaciones y sin repetir otros archivos.",
        ].join("\n");
    const iniciado = Date.now();
    // El modelo puede repetir los archivos anteriores aunque se le pida lo
    // contrario; darle el doble de techo evita que el bloque faltante se
    // trunque otra vez por el límite ajustado de `web`.
    const maxTokensContinuacion = Math.min(MAX_TOKENS[target.label].web * 2, 1800);
    const resultadoContinuacion = await callAgent({
      target,
      taskType: "web",
      prompt: promptContinuacion,
      timeoutMs: timeout,
      maxTokensOverride: maxTokensContinuacion,
    });
    continuacion = {
      faltantes,
      ok: resultadoContinuacion.ok,
      duracionMs: Date.now() - iniciado,
      maxTokens: maxTokensContinuacion,
      texto: resultadoContinuacion.texto,
      error: resultadoContinuacion.error || null,
    };
    bloques = mergeBlocks(result.texto, resultadoContinuacion.texto);
  }

  const embebidos = bloques.html ? extractEmbeddedAssets(bloques.html) : { css: "", js: "" };
  const css = bloques.css || embebidos.css;
  const js = bloques.js || embebidos.js;

  const [htmlScore, cssScore, jsScore] = await Promise.all([
    bloques.html ? Promise.resolve(scoreHTML(bloques.html)) : Promise.resolve(null),
    css ? Promise.resolve(scoreCSS(css)) : Promise.resolve(null),
    js ? scoreJS(js) : Promise.resolve(null),
  ]);
  const scores = { html: htmlScore, css: cssScore, js: jsScore };
  const funcional = validateLandingWiring({ html: bloques.html, css, js });

  return {
    exito: result.ok,
    duracionMs: result.duracionMs,
    continuacion,
    funcional,
    bloquesEncontrados: Object.keys(bloques),
    archivosEvaluados: {
      html: Boolean(bloques.html),
      css: Boolean(bloques.css),
      js: Boolean(bloques.js),
      cssIncrustado: !bloques.css && Boolean(embebidos.css),
      jsIncrustado: !bloques.js && Boolean(embebidos.js),
    },
    calidad: scores,
    puntuacionMedia: scoreThreeFiles(scores),
    codigo: { ...bloques, css: css || undefined, js: js || undefined },
    respuestaCruda: result.texto,
    error: result.error || null,
    systemPromptEnviado: Boolean(result.systemPrompt),
  };
}

async function runIdioma(target, policy) {
  const prompts = {
    code: "Escribe una función isValidEmail(email) en JavaScript. Devuelve solo el código.",
    web: "Crea una landing page con bloques html, css y js para una clínica veterinaria.",
  };
  const resultados = {};

  for (const idioma of ["es", "en"]) {
    resultados[idioma] = {};
    for (const taskType of ["code", "web"]) {
      const system = idioma === "es"
        ? getSystemPromptES(taskType)
        : getSystemPromptEN(taskType);
      const timeout = policy.get(target.model, { maxTokens: MAX_TOKENS[target.label][taskType] });
      const result = await callAgent({
        target,
        taskType,
        prompt: prompts[taskType],
        system,
        timeoutMs: timeout,
      });
      if (result.ok) policy.record(target.model, result.duracionMs, result.tokensPorSegundo);
      let calidad;
      let codigoParaGuardar;
      if (taskType === "code") {
        codigoParaGuardar = firstBlock(result.texto, "javascript");
        calidad = await scoreCode(codigoParaGuardar, "javascript");
      } else {
        const bloques = blocksByLanguage(result.texto);
        const embebidos = bloques.html ? extractEmbeddedAssets(bloques.html) : { css: "", js: "" };
        const cssTexto = bloques.css || embebidos.css;
        const jsTexto = bloques.js || embebidos.js;
        const [html, css, js] = await Promise.all([
          bloques.html ? Promise.resolve(scoreHTML(bloques.html)) : Promise.resolve(null),
          cssTexto ? Promise.resolve(scoreCSS(cssTexto)) : Promise.resolve(null),
          jsTexto ? scoreJS(jsTexto) : Promise.resolve(null),
        ]);
        calidad = {
          puntuacion: scoreThreeFiles({ html, css, js }),
          bloques: Object.keys(bloques),
          detalle: { html, css, js },
        };
        codigoParaGuardar = result.texto;
      }
      resultados[idioma][taskType] = {
        exito: result.ok,
        duracionMs: result.duracionMs,
        systemPrompt: result.systemPrompt,
        systemPromptChars: result.systemPrompt?.length || 0,
        calidad,
        codigo: codigoParaGuardar.slice(0, 6000),
        error: result.error || null,
      };
    }
  }

  return resultados;
}

async function runQuality(target, policy) {
  const timeout = policy.get(target.model, { maxTokens: MAX_TOKENS[target.label].code });
  const prompt = "Escribe una función isValidEmail(email) en JavaScript que valide un email básico. Devuelve solo el código.";
  const result = await callAgent({
    target,
    taskType: "code",
    prompt,
    timeoutMs: timeout,
    enhanced: true,
    enhancedOptions: {
      taskType: "code",
      lenguaje: "javascript",
      // "auto" detecta el español del prompt; se puede forzar con "en"/"es".
      autoCorrect: true,
      maxCorrectionAttempts: 1,
      validarSintaxis: true,
      validarComportamiento: ({ texto, lenguaje }) => validateCodeBehavior(texto, lenguaje),
      validarComportamientoId: "code-behavior-v1",
      umbralPuntuacion: 70,
    },
  });
  if (result.ok) policy.record(target.model, result.duracionMs, result.tokensPorSegundo);

  const codigo = firstBlock(result.texto, "javascript");
  const calidad = await scoreCode(codigo, "javascript");
  return {
    exito: result.ok,
    duracionMs: result.duracionMs,
    intentos: result.intentos,
    mejoras: result.mejoras,
    comportamiento: result.comportamiento,
    calidad,
    funcional: calidad.funcional,
    codigo,
    error: result.error || null,
  };
}

async function loadMetadata() {
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  let commit = "desconocido";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {}
  return {
    fecha: new Date().toISOString(),
    coreVersion: pkg.version,
    commit,
    node: process.version,
    presets: Object.keys(MODEL_PRESETS),
  };
}

function selectTargets(suite, modelsFilter) {
  const selected = SUITES[suite];
  if (!selected) throw new Error(`Suite desconocida: ${suite}. Disponibles: ${Object.keys(SUITES).join(", ")}`);
  if (!modelsFilter) return selected;
  const names = modelsFilter.split(",").map((item) => item.trim());
  return selected.filter((target) => names.includes(target.model));
}

async function writeModelArtifacts(target, data) {
  const sufijoModo = `${data.metadata.modo === "offline" ? "__offline" : ""}${data.metadata.provider === "ollama-native" ? "__nativo" : ""}`;
  const dir = path.join(RESULTS_DIR, `canonico_${data.metadata.suite}${sufijoModo}__${target.label}__${slug(target.model)}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "resultados.json"), `${JSON.stringify(data, null, 2)}\n`);

  if (data.pruebas?.p05?.salidas?.javascript?.codigo) {
    await fs.writeFile(path.join(dir, "codigo_js.js"), data.pruebas.p05.salidas.javascript.codigo);
  }
  if (data.pruebas?.p05?.salidas?.python?.codigo) {
    await fs.writeFile(path.join(dir, "codigo_py.py"), data.pruebas.p05.salidas.python.codigo);
  }
  for (const [language, filename] of [["html", "index.html"], ["css", "style.css"], ["js", "script.js"]]) {
    const code = data.pruebas?.p06?.codigo?.[language];
    if (code) await fs.writeFile(path.join(dir, filename), code);
  }
  return dir;
}

async function writeSummary(outputName, metadata, resumen) {
  const lines = [
    "# Resultados E2E canónicos",
    "",
    `- Fecha: ${metadata.fecha}`,
    `- Core: v${metadata.coreVersion} (${metadata.commit})`,
    `- Node: ${metadata.node}`,
    `- Modo: ${metadata.modo || "real"}`,
    `- Provider: ${metadata.provider || "ollama"}`,
    "",
    "| Modelo | Entorno | Suite | P01 | P02 | P03 | P04 | P05 | P06 |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const item of resumen) {
    const cell = (value) => value == null ? "—" : String(value);
    lines.push(
      `| ${item.model} | ${item.entorno} | ${item.suite} | ${cell(item.p01)} | ${cell(item.p02)} | ${cell(item.p03)} | ${cell(item.p04)} | ${cell(item.p05)} | ${cell(item.p06)} |`,
    );
  }
  lines.push("", "Los detalles y artefactos están en `resultados_por_modelo/`.");
  const outputPath = path.join(SCRIPT_DIR, outputName);
  await fs.writeFile(outputPath, `${lines.join("\n")}\n`);
  return outputPath;
}

async function main() {
  const args = parseArgs();
  OFFLINE = args.offline;
  PROVIDER_OVERRIDE = args.provider;
  const metadata = {
    ...await loadMetadata(),
    suite: args.suite,
    modo: OFFLINE ? "offline" : "real",
    provider: PROVIDER_OVERRIDE || "ollama",
  };
  const targets = selectTargets(args.suite, args.models);
  let outputName = args.output;
  if (OFFLINE && !/OFFLINE/i.test(outputName)) outputName = outputName.replace(/\.md$/i, "_OFFLINE.md");
  if (PROVIDER_OVERRIDE === "ollama-native" && !/NATIVO/i.test(outputName)) {
    outputName = outputName.replace(/\.md$/i, "_NATIVO.md");
  }

  console.log("=".repeat(72));
  console.log(`E2E CANÓNICO · suite=${args.suite} · modo=${metadata.modo}`);
  console.log(`Core v${metadata.coreVersion} (${metadata.commit}) · ${metadata.fecha}`);
  console.log("=".repeat(72));

  const resumen = [];
  for (const target of targets) {
    console.log(`\n▶ ${target.model} @ ${target.baseUrl}`);
    const policy = new (await import("../../src/utils/adaptive-timeout.js")).TimeoutPolicy({
      minMs: target.label === "remoto" ? 45000 : 20000,
      // P06 de modelos remotos lentos puede necesitar >200 s; el techo anterior
      // abortaba la generación y producía una regresión falsa (0/0).
      maxMs: 300000,
      factor: 1.6,
    });
    const data = { metadata, target, pruebas: {} };

    if (args.suite === "tools") {
      data.pruebas.p02 = await runP02(target, policy);
      console.log(`  P02 ip=${data.pruebas.p02.ip.exito ? "✓" : "✗"} web=${data.pruebas.p02.web.exito ? "✓" : "✗"}`);
    } else if (args.suite === "idioma") {
      data.pruebas.idioma = await runIdioma(target, policy);
    } else if (args.suite === "quality") {
      data.pruebas.p05_enhanced = await runQuality(target, policy);
    } else {
      data.pruebas.p01 = await runP01(target, policy);
      console.log(`  P01 ${data.pruebas.p01.exito ? "✓" : "✗"} ${Math.round(data.pruebas.p01.duracionMs)}ms`);

      data.pruebas.p02 = await runP02(target, policy);
      console.log(`  P02 ip=${data.pruebas.p02.ip.exito ? "✓" : "✗"} web=${data.pruebas.p02.web.exito ? "✓" : "✗"}`);

      data.pruebas.p03 = await runP03(target, policy);
      console.log(`  P03 ${data.pruebas.p03.exito ? "✓" : "✗"} memoria=${data.pruebas.p03.recuerdaNombre && data.pruebas.p03.recuerdaClinica}`);

      data.pruebas.p04 = await runP04(target, policy);
      console.log(`  P04 compact=${data.pruebas.p04.compactionTriggered} recuerda=${data.pruebas.p04.recuerdaDato}`);

      data.pruebas.p05 = await runP05(target, policy);
      console.log(`  P05 calidad=${data.pruebas.p05.puntuacionMedia} funcional=${data.pruebas.p05.funcionalMedia}`);

      data.pruebas.p06 = await runP06(target, policy);
      console.log(`  P06 calidad=${data.pruebas.p06.puntuacionMedia} funcional=${data.pruebas.p06.funcional.puntuacion}% bloques=${data.pruebas.p06.bloquesEncontrados.join(",")}`);
    }

    const dir = await writeModelArtifacts(target, data);
    console.log(`  artefactos: ${path.relative(REPO_ROOT, dir)}`);

    resumen.push({
      model: target.model,
      entorno: target.label,
      suite: args.suite,
      p01: data.pruebas.p01 ? `${data.pruebas.p01.exito ? "✓" : "✗"} ${Math.round(data.pruebas.p01.duracionMs)}ms` : null,
      p02: data.pruebas.p02 ? `ip:${data.pruebas.p02.ip.exito ? "✓" : "✗"} web:${data.pruebas.p02.web.exito ? "✓" : "✗"}` : null,
      p03: data.pruebas.p03 ? `${data.pruebas.p03.exito ? "✓" : "✗"} ${data.pruebas.p03.recuerdaNombre ? "memoria" : "sin memoria"}` : null,
      p04: data.pruebas.p04 ? `${data.pruebas.p04.compactionTriggered ? "compact" : "no compact"}/${data.pruebas.p04.recuerdaDato ? "recuerda" : "olvidó"}` : null,
      p05: data.pruebas.p05
        ? `${data.pruebas.p05.puntuacionMedia}% · func ${data.pruebas.p05.funcionalMedia ?? "—"}%`
        : data.pruebas.p05_enhanced
          ? `${data.pruebas.p05_enhanced.calidad?.puntuacion ?? "—"}% · func ${data.pruebas.p05_enhanced.funcional?.puntuacion ?? "—"}%`
          : null,
      p06: data.pruebas.p06
        ? `${data.pruebas.p06.puntuacionMedia}% · func ${data.pruebas.p06.funcional?.puntuacion ?? "—"}%`
        : null,
    });
  }

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(RESULTS_DIR, `resumen_${args.suite}${OFFLINE ? "_offline" : ""}${PROVIDER_OVERRIDE === "ollama-native" ? "_nativo" : ""}.json`),
    `${JSON.stringify({ metadata, resumen }, null, 2)}\n`,
  );
  const summaryPath = await writeSummary(outputName, metadata, resumen);
  console.log(`\nResumen: ${path.relative(REPO_ROOT, summaryPath)}`);
}

main().catch((error) => {
  console.error("ERROR:", error);
  process.exitCode = 1;
});
