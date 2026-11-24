#!/usr/bin/env node
/**
 * Demo de descripción de imágenes con libAgentKit.
 *
 * El host lee la imagen y la pasa al MODELO; es el modelo multimodal quien la
 * interpreta. Este script no intenta describirla por su cuenta.
 *
 * Uso:
 *   node tests/demo/ask2.js
 *   AGENT_IMAGE=/ruta/otra.webp \
 *   AGENT_PROMPT="Describe esta imagen en una frase" \
 *     node tests/demo/ask2.js
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { askAgent, getModelConfig } from "../../src/index.js";

// --- CONFIGURACIÓN (edita aquí o usa variables de entorno) ---------------
const BASE_URL = process.env.AGENT_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.AGENT_MODEL ?? "lfm3-omni:2b";
const IMAGEN = process.env.AGENT_IMAGE
  ?? new URL("./vista-aérea-de-quito-el-centro-de-la-ciudad.webp", import.meta.url);
const NOMBRE_IMAGEN = basename(
  decodeURIComponent(typeof IMAGEN === "string" ? IMAGEN : IMAGEN.pathname),
);
const PROMPT = process.env.AGENT_PROMPT
  ?? `Describe la siguiente imagen (${NOMBRE_IMAGEN}) en español: qué se ve, el lugar, los elementos principales y el ambiente.`;
const TIPO_TAREA = process.env.AGENT_TASK ?? "chat";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 300000);
const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS ?? 800);

const SYSTEM = process.env.AGENT_SYSTEM ?? [
  "Eres un asistente que describe imágenes en español.",
  "Describe solo lo que se ve en la imagen; no inventes lugares ni datos.",
  "Responde en un párrafo claro y concreto.",
].join(" ");
// ------------------------------------------------------------------------

const inicio = Date.now();
const transcurrido = () => `${Math.round((Date.now() - inicio) / 1000)}s`;
const control = new AbortController();
const alarma = setTimeout(
  () => control.abort(new Error("Timeout de pared del demo")),
  TIMEOUT_MS + 10000,
);
const latido = setInterval(() => console.error(`[${transcurrido()}] esperando al modelo…`), 30000);

try {
  const bytes = await readFile(IMAGEN);
  console.error(`[0s] modelo=${MODEL} imagen=${NOMBRE_IMAGEN} (${bytes.length} bytes)`);

  const provider = getModelConfig(
    MODEL,
    TIPO_TAREA,
    {
      system: SYSTEM,
      maxTokens: MAX_TOKENS,
      timeout: TIMEOUT_MS,
      responseTimeout: TIMEOUT_MS,
      temperature: 0.2,
      seed: null,
    },
    BASE_URL,
  );

  const respuesta = await askAgent({
    provider,
    prompt: PROMPT,
    // `images` acepta Buffers, base64, data URLs o { mimeType, data }.
    // WebP se envía con su MIME real para que Ollama lo decodifique.
    images: [{ mimeType: "image/webp", data: bytes }],
    signal: control.signal,
    preSearch: false,
  });

  console.log(respuesta.text);
  console.error(`[${transcurrido()}] fin · tokens=${JSON.stringify(respuesta.usage || {})}`);
} catch (error) {
  console.error(`[${transcurrido()}] Error del demo: ${error.message}`);
  if (/timed out|timeout|abort/i.test(String(error.message))) {
    console.error("Prueba con AGENT_TIMEOUT_MS=600000 o con una imagen más pequeña.");
  }
  process.exitCode = 1;
} finally {
  clearTimeout(alarma);
  clearInterval(latido);
}
