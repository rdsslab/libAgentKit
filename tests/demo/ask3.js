#!/usr/bin/env node
/**
 * Demo de análisis de vídeo con libAgentKit + lfm3-omni:2b.
 *
 * Ahora usa `analyzeVideo()` del harness: extrae audio y fotogramas con ffmpeg,
 * transcribe con el proveedor STT configurado y llama a `askAgent()` con un
 * provider cualquiera. El modelo sigue sin recibir un campo `video`; recibe
 * imágenes y la transcripción ya ensambladas.
 *
 * Uso:
 *   node tests/demo/ask3.js
 *   AGENT_VIDEO=/ruta/otro.mp4 AGENT_FRAMES=8 node tests/demo/ask3.js
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  analyzeVideo,
  getModelConfig,
  createSpeechToText,
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

  const stt = createSpeechToText({
    providers: {
      ollama: {
        type: "openai",
        baseUrl: BASE_URL,
        apiKey: "ollama", // Ollama lo ignora; el adaptor openai lo exige.
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

  console.error(`[${transcurrido()}] analyzeVideo (frames + STT + askAgent)…`);
  const respuesta = await analyzeVideo({
    provider,
    video,
    stt,
    strategy: "frames+stt",
    framePlacement: "history",
    frameCaption: `Fotogramas del vídeo "${NOMBRE_VIDEO}" (${duracion.toFixed(1)} s):`,
    transcriptLabel: "Transcripción literal del audio (cópiala en QUÉ SE DICE):",
    frames: {
      maxFrames: MAX_FRAMES,
      width: FRAME_WIDTH,
      durationSec: duracion,
      timeoutMs: TIMEOUT_MS,
    },
    audio: {
      mimeType: "audio/wav",
      language: IDIOMA,
      timeoutMs: TIMEOUT_MS,
    },
    signal: control.signal,
  });

  const transcripcion = respuesta.transcription?.text || "";
  console.error(
    `[${transcurrido()}] listo: ${respuesta.frames.length} fotogramas, ${transcripcion.length} chars de transcripción`,
  );

  console.log("TRANSCRIPCIÓN:\n" + transcripcion);
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
