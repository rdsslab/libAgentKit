#!/usr/bin/env node
/**
 * Demo de attachments automáticos en `askAgent()` (harness multimedia).
 *
 * El HOST solo entrega bytes con un `kind`; `askAgent()` prepara todo antes de
 * llamar al modelo:
 *
 *   - imagen  -> se envía tal cual al proveedor (como en ask2.js);
 *   - documento -> se extrae texto en memoria;
 *   - audio   -> STT resuelto desde la config efectiva, o nativo si se declara;
 *   - vídeo   -> fotogramas con ffmpeg + transcripción, o nativo si se declara.
 *
 * Para enviar audio/vídeo SIN transcripción, declara capacidades en el proveedor:
 *
 *   AGENT_NATIVE_ADAPTER=google AGENT_MODEL=gemini-2.5-flash \
 *     AGENT_BASE_URL=https://generativelanguage.googleapis.com node tests/demo/ask5.js
 *
 * El adaptador debe soportarlo (`providerSupportedMedia`) y el HOST debe
 * declararlo (`provider.media.audio/video`). Si no, se degrada con aviso.
 *
 * Config de ejemplo (`agentkit/config.json` o `~/.config/agentkit/config.json`):
 *
 *   {
 *     "stt": {
 *       "providers": {
 *         "ollama": {
 *           "type": "openai",
 *           "baseUrl": "http://localhost:11434",
 *           "apiKey": "ollama",
 *           "model": "lfm3-omni:2b",
 *           "responseFormat": "json"
 *         }
 *       },
 *       "defaultProvider": "ollama",
 *       "language": "es"
 *     }
 *   }
 *
 * Si no hay servidor de transcripción configurado, NO falla: se degradan el
 * audio y el vídeo a texto de aviso, y los avisos aparecen en
 * `respuesta.media.warnings` y en el propio prompt.
 *
 * Uso:
 *   node tests/demo/ask5.js
 *   AGENT_VIDEO=/ruta/otro.mp4 AGENT_FRAMES=4 node tests/demo/ask5.js
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  askAgent,
  getModelConfig,
  loadEffectiveConfig,
} from "../../src/index.js";

// --- CONFIGURACIÓN (edita aquí o usa variables de entorno) ---------------
const BASE_URL = process.env.AGENT_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.AGENT_MODEL ?? "lfm3-omni:2b";
const VIDEO = process.env.AGENT_VIDEO
  ?? new URL("./document_4907030934890481735.mp4", import.meta.url);
const IMAGE = process.env.AGENT_IMAGE
  ?? new URL("./vista-aérea-de-quito-el-centro-de-la-ciudad.webp", import.meta.url);
const NOMBRE_VIDEO = basename(
  decodeURIComponent(typeof VIDEO === "string" ? VIDEO : VIDEO.pathname),
);
const NOMBRE_IMAGEN = basename(
  decodeURIComponent(typeof IMAGE === "string" ? IMAGE : IMAGE.pathname),
);
const TIPO_TAREA = process.env.AGENT_TASK ?? "chat";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 300000);
const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS ?? 900);
const MAX_FRAMES = Number(process.env.AGENT_FRAMES ?? 6);
const FRAME_WIDTH = Number(process.env.AGENT_FRAME_WIDTH ?? 640);
const IDIOMA = process.env.AGENT_LANGUAGE ?? "es";
const NATIVE_ADAPTER = process.env.AGENT_NATIVE_ADAPTER ?? "";

const SYSTEM = process.env.AGENT_SYSTEM ?? [
  "Eres un asistente que analiza material adjunto en español.",
  "QUÉ SE VE: describe solo los fotogramas y la imagen, incluido el texto de carteles si se lee.",
  "QUÉ SE DICE: copia literalmente la transcripción del audio; nunca el texto de los carteles.",
  "Si un aviso dice que el audio no se pudo transcribir, indícalo; no lo inventes.",
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
  const efectiva = loadEffectiveConfig();
  const proveedoresStT = Object.keys(efectiva.config.stt?.providers || {});
  console.error(
    `[0s] modelo=${MODEL} stt=${proveedoresStT.join(",") || "(sin configurar)"} config=${efectiva.projectPath || efectiva.globalPath || "default"}`,
  );

  const [video, imagen] = await Promise.all([
    readFile(VIDEO),
    readFile(IMAGE),
  ]);

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

  if (NATIVE_ADAPTER) {
    provider.media = { audio: true, video: true, adapter: NATIVE_ADAPTER };
  }

  console.error(`[${transcurrido()}] askAgent con attachments (imagen + vídeo)…`);
  const respuesta = await askAgent({
    provider,
    prompt: [
      `Analiza el vídeo "${NOMBRE_VIDEO}" y la imagen "${NOMBRE_IMAGEN}".`,
      "Responde con dos apartados: QUÉ SE VE y QUÉ SE DICE.",
    ].join("\n"),
    attachments: [
      {
        kind: "image",
        name: NOMBRE_IMAGEN,
        mimeType: "image/webp",
        data: imagen,
      },
      {
        kind: "video",
        name: NOMBRE_VIDEO,
        mimeType: "video/mp4",
        data: video,
      },
      // Un attachment de audio-only sería idéntico, sin el bloque de frames:
      // { kind: "audio", name: "nota.wav", mimeType: "audio/wav", data: wav },
    ],
    config: efectiva.config,
    media: {
      maxFrames: MAX_FRAMES,
      frameWidth: FRAME_WIDTH,
      timeoutMs: TIMEOUT_MS,
      language: IDIOMA,
    },
    signal: control.signal,
    preSearch: false,
  });

  const media = respuesta.media;
  console.error(
    `[${transcurrido()}] media: strategy=${media.strategy} nativo=${media.nativeMedia.kinds.join(",") || "no"} stt=${media.stt.available ? media.stt.provider : "no"} frames=${media.frameCount} chars=${media.transcriptChars}`,
  );
  for (const aviso of media.warnings) {
    console.error(`  aviso ${aviso.code}: ${aviso.message}${aviso.detail ? ` (${aviso.detail})` : ""}`);
  }

  console.log("ANÁLISIS:\n" + respuesta.text);
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
