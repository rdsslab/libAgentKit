#!/usr/bin/env node
/**
 * Demo de análisis de vídeo con libAgentKit: versión manual (sin `analyzeVideo()`).
 *
 * `ask3.js` delega en `analyzeVideo()`, que hace todo por nosotros. Aquí se
 * repiten esos pasos para ver cómo se usa `askAgent()` directamente:
 *
 *   1. extraer fotogramas con ffmpeg -> JPEG en base64;
 *   2. extraer el audio con ffmpeg -> WAV -> transcribir con el proveedor STT;
 *   3. montar el prompt y el historial con las imágenes, y llamar a `askAgent()`.
 *
 * `askAgent()` no recibe un campo `video`: el vídeo entra como imágenes y texto.
 * Es el mismo pipeline que `analyzeVideo(..., { strategy: "frames+stt" })`,
 * pero escrito a mano. Igual que en ask3.js, el vídeo de ejemplo debe tener
 * pista de audio; si no, `extractAudio()` fallará.
 *
 * Uso:
 *   node tests/demo/ask4.js
 *   AGENT_VIDEO=/ruta/otro.mp4 AGENT_FRAMES=8 node tests/demo/ask4.js
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  askAgent,
  getModelConfig,
  createSpeechToText,
  extractAudio,
  extractVideoFrames,
  mediaDuration,
} from "../../src/index.js";

// --- CONFIGURACIÓN (edita aquí o usa variables de entorno) ---------------
const BASE_URL = process.env.AGENT_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.AGENT_MODEL ?? "lfm3-omni:2b";
const VIDEO = process.env.AGENT_VIDEO
  ?? new URL("./document_4907030934890481735.mp4", import.meta.url);
const NOMBRE_VIDEO = basename(
  decodeURIComponent(typeof VIDEO === "string" ? VIDEO : VIDEO.pathname),
);
const TIPO_TAREA = process.env.AGENT_TASK ?? "chat";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 300000);
const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS ?? 900);
const MAX_FRAMES = Number(process.env.AGENT_FRAMES ?? 6);
const FRAME_WIDTH = Number(process.env.AGENT_FRAME_WIDTH ?? 640);
const IDIOMA = process.env.AGENT_LANGUAGE ?? "es";

const SYSTEM = process.env.AGENT_SYSTEM ?? [
  "Eres un asistente que analiza vídeos a partir de fotogramas y de la transcripción de su audio.",
  "QUÉ SE VE: describe solo los fotogramas, incluido el texto de carteles si se lee.",
  "QUÉ SE DICE: copia literalmente la transcripción del audio, aunque parezca incompleta; nunca el texto de los carteles.",
  "No mezcles imagen y audio. Si algo no aparece, dilo; no inventes personas ni lugares.",
  "Responde en español, en dos apartados: QUÉ SE VE y QUÉ SE DICE.",
].join(" ");
const PREGUNTA = process.env.AGENT_PROMPT
  ?? `Analiza el vídeo "${NOMBRE_VIDEO}" siguiendo las instrucciones del sistema.`;
// ------------------------------------------------------------------------

const inicio = Date.now();
const transcurrido = () => `${Math.round((Date.now() - inicio) / 1000)}s`;
const control = new AbortController();
const alarma = setTimeout(
  () => control.abort(new Error("Timeout de pared del demo")),
  TIMEOUT_MS + 10000,
);
const latido = setInterval(() => console.error(`[${transcurrido()}] esperando…`), 30000);

try {
  const video = await readFile(VIDEO);
  const duracion = mediaDuration(video);
  console.error(
    `[0s] modelo=${MODEL} vídeo=${NOMBRE_VIDEO} (${video.length} bytes, ${duracion.toFixed(1)}s)`,
  );

  // El STT se configura igual que en ask3.js: Ollama expone una API compatible
  // con OpenAI, así que basta el adaptor "openai" (apiKey obligatoria, ignorada).
  const stt = createSpeechToText({
    providers: {
      ollama: {
        type: "openai",
        baseUrl: BASE_URL,
        apiKey: "ollama",
        model: MODEL,
        responseFormat: "json",
        timeoutMs: TIMEOUT_MS,
      },
    },
    defaultProvider: "ollama",
    model: MODEL,
    language: IDIOMA,
    timeoutMs: TIMEOUT_MS,
  });

  // `getModelConfig` deja el system prompt dentro de `provider`; askAgent() lo
  // detecta y lo añade como mensaje system. Por eso no se pasa `system` aparte.
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

  // --- 1) Fotogramas -----------------------------------------------------
  console.error(`[${transcurrido()}] 1/3 extrayendo ${MAX_FRAMES} fotogramas…`);
  const frames = await extractVideoFrames(video, {
    maxFrames: MAX_FRAMES,
    width: FRAME_WIDTH,
    durationSec: duracion,
    timeoutMs: TIMEOUT_MS,
  });
  // extractVideoFrames devuelve base64 puro; las data URLs son lo que espera
  // el adaptor multimodal de askAgent().
  const urls = frames.map((base64) => `data:image/jpeg;base64,${base64}`);

  // --- 2) Audio -> transcripción ----------------------------------------
  console.error(`[${transcurrido()}] 2/3 extrayendo audio y transcribiendo…`);
  const audio = await extractAudio(video, { timeoutMs: TIMEOUT_MS });
  const transcripcion = await stt.transcribe(audio, {
    mimeType: "audio/wav",
    fileName: "audio.wav",
    language: IDIOMA,
    signal: control.signal,
  });

  // --- 3) Llamada explícita a askAgent ----------------------------------
  // Los fotogramas van en `history` como partes `image_url` (la misma forma
  // que usa analyzeVideo con framePlacement: "history"). La transcripción va
  // en el prompt, para que el modelo la tenga al generar "QUÉ SE DICE".
  const history = [{
    role: "user",
    content: [
      {
        type: "text",
        text: `Fotogramas del vídeo "${NOMBRE_VIDEO}" (${duracion.toFixed(1)} s):`,
      },
      ...urls.map((url) => ({
        type: "image_url",
        image_url: { url },
      })),
    ],
  }];
  const prompt = [
    PREGUNTA,
    "Transcripción literal del audio (cópiala en QUÉ SE DICE):",
    transcripcion.text || "(sin transcripción)",
  ].join("\n");

  console.error(
    `[${transcurrido()}] 3/3 askAgent (${frames.length} imágenes, ${transcripcion.text.length} chars de audio)…`,
  );
  const respuesta = await askAgent({
    provider,
    prompt,
    history,
    signal: control.signal,
    preSearch: false,
  });

  console.log("TRANSCRIPCIÓN:\n" + transcripcion.text);
  console.log("\nANÁLISIS:\n" + respuesta.text);
  console.error(`[${transcurrido()}] fin · tokens=${JSON.stringify(respuesta.usage || {})}`);
} catch (error) {
  console.error(`[${transcurrido()}] Error del demo: ${error.message}`);
  if (/timed out|timeout|abort/i.test(String(error.message))) {
    console.error("Prueba con AGENT_TIMEOUT_MS=600000 o con AGENT_FRAMES=4.");
  }
  process.exitCode = 1;
} finally {
  clearTimeout(alarma);
  clearInterval(latido);
}
