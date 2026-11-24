#!/usr/bin/env node
/**
 * Demo de MEDIA NATIVA en `askAgent()` (Fase 2 del harness multimedia).
 *
 * `ask5.js` degrada audio/vídeo a fotogramas + transcripción. Aquí el HOST
 * declara explícitamente lo que su proveedor acepta:
 *
 *   provider.media = { audio: true, video: true }
 *
 * y `askAgent()` envía los bytes al adaptador (Gemini -> `inlineData`,
 * OpenAI-compatible -> `input_audio`). Nada se infiere del nombre del modelo.
 * También vale `provider.capabilities.media` en lugar de `provider.media`.
 *
 * Modo real:
 *   AGENT_API_KEY=... node tests/demo/ask6.js
 *   AGENT_PROVIDER=openai AGENT_MODEL=gpt-4o-audio-preview \
 *     AGENT_API_KEY=... AGENT_NATIVE_KINDS=audio node tests/demo/ask6.js
 *
 * Modo sin red (muestra exactamente qué se prepararía para el proveedor):
 *   AGENT_DRY_RUN=1 node tests/demo/ask6.js
 *
 * Si declaras un tipo que el adaptador no soporta (p. ej. vídeo en `ollama`),
 * no falla: se degrada al pipeline de ask5.js con aviso
 * `NATIVE_MEDIA_UNSUPPORTED`. Con `AGENT_ON_ERROR=throw` se lanza en su lugar.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  askAgent,
  loadEffectiveConfig,
  prepareMediaContext,
  providerSupportedMedia,
} from "../../src/index.js";

// --- CONFIGURACIÓN (edita aquí o usa variables de entorno) ---------------
const PROVIDER_NAME = process.env.AGENT_PROVIDER ?? "ollama";
const MODEL = process.env.AGENT_MODEL ?? "lfm3-omni:2b-q8_0";
const API_KEY = process.env.AGENT_API_KEY
  ?? process.env.GEMINI_API_KEY
  ?? process.env.GOOGLE_API_KEY
  ?? process.env.OPENAI_API_KEY;
const BASE_URL = process.env.AGENT_BASE_URL ?? "";
const VIDEO = process.env.AGENT_VIDEO
  ?? new URL("./document_4907030934890481735.mp4", import.meta.url);
const IMAGE = process.env.AGENT_IMAGE
  ?? new URL("./vista-aérea-de-quito-el-centro-de-la-ciudad.webp", import.meta.url);
const AUDIO = process.env.AGENT_AUDIO ?? "";
const NOMBRE_VIDEO = basename(
  decodeURIComponent(typeof VIDEO === "string" ? VIDEO : VIDEO.pathname),
);
const NOMBRE_IMAGEN = basename(
  decodeURIComponent(typeof IMAGE === "string" ? IMAGE : IMAGE.pathname),
);
const NATIVE_KINDS = (process.env.AGENT_NATIVE_KINDS ?? "audio,video")
  .split(",")
  .map((kind) => kind.trim().toLowerCase())
  .filter(Boolean);
const NATIVE_ADAPTER = process.env.AGENT_NATIVE_ADAPTER ?? "";
const ON_ERROR = process.env.AGENT_ON_ERROR ?? "degrade";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 300000);
const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS ?? 900);
const DRY_RUN = process.argv.includes("--dry-run")
  || ["1", "true", "yes"].includes(String(process.env.AGENT_DRY_RUN ?? "").toLowerCase());

const SYSTEM = process.env.AGENT_SYSTEM ?? [
  "Eres un asistente que analiza material adjunto en español.",
  "QUÉ SE VE: describe el vídeo y la imagen, incluido el texto de carteles si se lee.",
  "QUÉ SE DICE: transcribe literalmente el audio del vídeo; nunca copies el texto de los carteles.",
  "Si el proveedor no acepta audio o vídeo nativo y aparece un aviso, indícalo; no lo inventes.",
].join(" ");

const mimeFromName = (name) => {
  const lower = String(name).toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "audio/wav";
};
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

  // 1) Declaración explícita del HOST. Sin esto, audio/vídeo usan STT+frames.
  const declaracion = Object.fromEntries(NATIVE_KINDS.map((kind) => [kind, true]));
  if (NATIVE_ADAPTER) declaracion.adapter = NATIVE_ADAPTER;

  const provider = {
    provider: PROVIDER_NAME,
    model: MODEL,
    ...(API_KEY ? { apiKey: API_KEY } : {}),
    ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
    system: SYSTEM,
    maxTokens: MAX_TOKENS,
    temperature: 0.2,
    media: declaracion,
  };

  const soportados = providerSupportedMedia(provider);
  console.error(
    `[0s] proveedor=${PROVIDER_NAME} modelo=${MODEL} declara=${NATIVE_KINDS.join(",") || "(nada)"} adapterSoporta=${soportados.join(",")}`,
  );

  // 2) El HOST solo entrega bytes. `askAgent()` decide nativo o fallback.
  const [video, imagen, audio] = await Promise.all([
    readFile(VIDEO),
    readFile(IMAGE),
    AUDIO ? readFile(AUDIO) : null,
  ]);

  const attachments = [
    { kind: "image", name: NOMBRE_IMAGEN, mimeType: "image/webp", data: imagen },
    { kind: "video", name: NOMBRE_VIDEO, mimeType: "video/mp4", data: video },
  ];
  if (audio) {
    const nombre = basename(AUDIO);
    attachments.push({ kind: "audio", name: nombre, mimeType: mimeFromName(nombre), data: audio });
  }

  const opcionesMedia = { timeoutMs: TIMEOUT_MS, language: "es", onError: ON_ERROR };
  const prompt = [
    `Analiza el vídeo "${NOMBRE_VIDEO}" y la imagen "${NOMBRE_IMAGEN}".`,
    "Responde con dos apartados: QUÉ SE VE y QUÉ SE DICE.",
  ].join("\n");

  if (DRY_RUN) {
    // Sin red: muestra las piezas que se enviarían al adaptador.
    const preparado = await prepareMediaContext({
      provider,
      attachments,
      config: efectiva.config,
      media: opcionesMedia,
      signal: control.signal,
    });

    console.error(`[${transcurrido()}] dry-run · strategy=${preparado.media.strategy}`);
    console.error("  nativeMedia=" + JSON.stringify(preparado.media.nativeMedia));
    console.error("  imagenes=" + preparado.images.length);
    console.error("  audio=" + preparado.audio.map((item) => `${item.mimeType}:${item.base64.length}B64`).join(", "));
    console.error("  video=" + preparado.video.map((item) => `${item.mimeType}:${item.base64.length}B64`).join(", "));
    console.error("  frames=" + preparado.media.frameCount + " stt=" + preparado.media.stt.available);
    for (const aviso of preparado.media.warnings) {
      console.error(`  aviso ${aviso.code}: ${aviso.message}`);
    }
    console.error("  promptFallback=" + JSON.stringify(preparado.promptText || "(vacío)"));
    console.log("Listo: no se hizo ninguna llamada de red.");
  } else {
    if (!API_KEY && PROVIDER_NAME !== "ollama") {
      throw new Error("Falta AGENT_API_KEY (o GEMINI_API_KEY/GOOGLE_API_KEY/OPENAI_API_KEY). Usa AGENT_DRY_RUN=1 para ver el payload sin red.");
    }

    console.error(`[${transcurrido()}] askAgent con media nativa…`);
    const respuesta = await askAgent({
      provider,
      prompt,
      attachments,
      config: efectiva.config,
      media: opcionesMedia,
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
  }
} catch (error) {
  console.error(`[${transcurrido()}] Error del demo: ${error.message}`);
  if (/timed out|timeout|abort/i.test(String(error.message))) {
    console.error("Prueba con AGENT_TIMEOUT_MS=600000.");
  }
  process.exitCode = 1;
} finally {
  clearTimeout(alarma);
  clearInterval(latido);
}
