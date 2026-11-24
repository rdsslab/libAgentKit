#!/usr/bin/env node
/**
 * Demo mínimo del harness libAgentKit.
 *
 * El HOST registra la tool `create_file` y decide guardar el artefacto en
 * disco; el MODELO decide si la usa y con qué argumentos. Así se puede medir
 * si el modelo es capaz de cumplir la tarea con las herramientas disponibles.
 *
 * Uso:
 *   node tests/demo/ask.mjs
 *   AGENT_MODEL=qwen2.5-coder:3b \
 *   AGENT_BASE_URL=http://192.168.100.126:11434 \
 *     node tests/demo/ask.mjs
 */

import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { askAgent, getModelConfig, createFileTool } from "../../src/index.js";

// --- CONFIGURACIÓN (edita aquí o usa variables de entorno) ---------------
const BASE_URL = process.env.AGENT_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.AGENT_MODEL ?? "jaahas/qwen3.5-uncensored:4b";
const PROMPT = process.env.AGENT_PROMPT ?? [
  "Crea una landing page mínima para una florería en UN archivo HTML.",
  "Incluye un h1, un párrafo y un formulario con nombre y email.",
  "Máximo 25 líneas. Usa comillas simples en el HTML.",
  "Guárdalo con create_file: format=html, filename=floreria.html.",
].join(" ");
const TIPO_TAREA = process.env.AGENT_TASK ?? "web";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 900000); // 15 min
const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS ?? 900);

// System prompt del host, deliberadamente corto. El preset `web` pide archivos
// separados, bloques Markdown y producción completa: compite con la herramienta
// y dispara respuestas de 6000 tokens, inviables en un modelo CPU de 6 tok/s.
const SYSTEM = process.env.AGENT_SYSTEM ?? [
  "Genera HTML compacto. Nunca escribas texto explicativo.",
  "Para guardar archivos usa SIEMPRE la herramienta create_file.",
  "Si no puedes hacer una llamada de herramienta nativa, responde SOLO con:",
  '<tool_call>{"name":"create_file","parameters":{"format":"html","filename":"floreria.html","content":"..."}}</tool_call>',
  "En content va el HTML completo de una sola línea, con comillas simples para evitar escapes.",
  "No repitas reglas CSS ni propiedades: cada línea aparece una sola vez.",
  "Después de la herramienta responde solo: OK.",
].join(" ");
// ------------------------------------------------------------------------

const inicio = Date.now();
const transcurrido = () => `${Math.round((Date.now() - inicio) / 1000)}s`;

const provider = getModelConfig(
  MODEL,
  TIPO_TAREA,
  {
    system: SYSTEM,
    maxTokens: MAX_TOKENS,
    timeout: TIMEOUT_MS,
    responseTimeout: TIMEOUT_MS,
    // El preset web usa seed fijo y repeat_penalty baja; con modelos pequeños
    // eso favorece bucles de CSS. Estos valores son solo del demo.
    temperature: 0.1,
    repeat_penalty: 1.25,
    seed: null,
  },
  BASE_URL,
);

// Guardia de reloj de pared y latido para ver que el proceso sigue vivo.
const control = new AbortController();
const alarma = setTimeout(
  () => control.abort(new Error("Timeout de pared del demo")),
  TIMEOUT_MS + 10000,
);
const latido = setInterval(() => console.error(`[${transcurrido()}] esperando al modelo…`), 30000);

// Guardar en cuanto la tool termina, no al final de la respuesta: en modelos
// lentos el texto de confirmación puede agotar el timeout DESPUÉS de que el
// archivo ya se generó. `notify()` es síncrono, así que registramos la promesa
// y la esperamos en `finally`.
const escrituras = [];
const guardados = new Set();
const guardarArtefacto = (artefacto) => {
  const buffer = artefacto?.buffer;
  if (!buffer) return;
  // `buildArtifact` añade la extensión al filename que dio el modelo. Si el
  // modelo ya la incluyó ("hola.html"), queda duplicada ("hola.html.html").
  const nombre = basename(String(artefacto.filename || "archivo.html"))
    .replace(/(\.[a-z0-9]{1,8})\1$/i, "$1");
  if (guardados.has(nombre)) return;
  guardados.add(nombre);
  escrituras.push(
    writeFile(nombre, buffer).then(
      () => console.log(`Guardado ${resolve(nombre)} (${buffer.length} bytes)`),
      (error) => console.error(`No se pudo guardar ${nombre}: ${error.message}`),
    ),
  );
};

try {
  console.error(`[0s] modelo=${MODEL} maxTokens=${MAX_TOKENS} timeout=${TIMEOUT_MS}ms`);

  const respuesta = await askAgent({
    provider,
    prompt: PROMPT,
    signal: control.signal,
    preSearch: false,
    postProcess: { repair: true, language: TIPO_TAREA },
    tools: { create_file: createFileTool() },
    includeDiagnostics: true,
    onToolStart: (evento) => console.error(`[${transcurrido()}] tool start: ${evento.tool}`),
    onToolFinish: (evento) => {
      console.error(`[${transcurrido()}] tool finish: ${evento.tool} (ok=${evento.ok})`);
      if (evento.tool === "create_file" && evento.ok) {
        guardarArtefacto(evento.result?.artifact);
      }
    },
  });
  console.error(`[${transcurrido()}] respuesta recibida`);

  const ejecuciones = respuesta.diagnostics?.toolExecutions || [];
  // Respaldo por si el modelo usó la tool en una ronda que no disparó el hook.
  for (const ejecucion of ejecuciones) {
    if (!ejecucion.isError
      && (ejecucion.toolName === "create_file" || ejecucion.toolAlias === "create_file")) {
      guardarArtefacto(ejecucion.rawResult?.artifact);
    }
  }

  if (!guardados.size) {
    console.error("El modelo no llamó a create_file: no se guardó ningún archivo.");
    const resumen = ejecuciones.map((e) => `${e.toolName}(${e.isError ? "error" : "ok"})`);
    console.error(`Tools ejecutadas: ${resumen.join(", ") || "ninguna"}`);
  }

  console.log(respuesta.text);
  console.error(
    `[${transcurrido()}] fin · tokens=${JSON.stringify(respuesta.usage || {})} · tools=${ejecuciones.length}`,
  );
} catch (error) {
  console.error(`[${transcurrido()}] Error del harness: ${error.message}`);
  if (/timed out|timeout|abort/i.test(String(error.message))) {
    if (guardados.size) {
      console.error("La tool se ejecutó y el archivo se guardó antes del timeout; solo faltó la confirmación final.");
    } else {
      console.error("Prueba con un modelo más rápido, AGENT_MAX_TOKENS=800 o AGENT_TIMEOUT_MS=1200000.");
    }
  }
  process.exitCode = guardados.size ? 0 : 1;
} finally {
  clearTimeout(alarma);
  clearInterval(latido);
  await Promise.all(escrituras);
}
