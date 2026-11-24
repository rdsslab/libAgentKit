/**
 * Automatic media preparation for `askAgent()`.
 *
 * This is the "Fase 1" orchestration described in the project notes: the host
 * hands attachments to `askAgent()`, and this module turns them into the pieces
 * the model can actually consume (images, extracted document text, video
 * frames and transcripts) *before* the provider call.
 *
 * It never decides by model name. Transcription comes from the effective config
 * (`stt` or `media.stt`) or from an explicit injected `stt`. When no STT server
 * is configured, the default policy is to degrade with a visible warning in
 * both the prompt and the response envelope, not to fail the turn.
 *
 * Native audio/video is opt-in and explicit: the provider config must declare
 * it in `media` or `capabilities.media`, AND the underlying adapter must be
 * known to support it via `providerSupportedMedia()`. Anything else falls back
 * to the Fase 1 text/frames path with a `NATIVE_MEDIA_UNSUPPORTED` warning.
 */

import {
	guessMimeTypeFromName,
	isAudioMimeType,
	isImageMimeType,
	isVideoMimeType,
	normalizeBinaryDescriptor,
} from "./buffers.js";
import { loadEffectiveConfig, resolveConfigSecrets } from "./config.js";
import { detectDocumentKind } from "./documents.js";
import {
	createSpeechToText,
	extractAudio,
	extractVideoFrames,
	imageToDataUrl,
	mediaDuration,
} from "./media.js";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const warning = (code, message, detail) => ({ code, message, ...(detail ? { detail } : {}) });
const clamp = (value, fallback, min = 0) => {
	const number = Number(value);
	return Number.isFinite(number) && number >= min ? number : fallback;
};

const normalizeMediaProviderKey = (value) => String(value || "")
	.trim()
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, "-")
	.replace(/^-+|-+$/g, "") || undefined;

/**
 * Which media kinds each ADAPTER can actually serialise. This is keyed by the
 * adapter/provider (or an explicit `media.adapter` override), never by model
 * name. Image is the only safe default for unknown adapters.
 */
const PROVIDER_NATIVE_MEDIA = Object.freeze({
	"google": ["image", "audio", "video"],
	"gemini": ["image", "audio", "video"],
	"google-gemini": ["image", "audio", "video"],
	"openai": ["image", "audio"],
	"openai-compatible": ["image", "audio"],
	"azure": ["image", "audio"],
	"azure-openai": ["image", "audio"],
	"openrouter": ["image", "audio"],
	"deepseek": ["image", "audio"],
	"groq": ["image", "audio"],
	"mistral": ["image", "audio"],
	"xai": ["image", "audio"],
	"anthropic": ["image", "document"],
	"claude": ["image", "document"],
	"ollama": ["image"],
	"ollama-native": ["image"],
	"ollama_native": ["image"],
});

/**
 * Media kinds an adapter can serialise, keyed by adapter (never by model name).
 *
 * @param {object|string} provider Provider config or name.
 * @returns {string[]} Copy of the supported kinds; `["image"]` for unknown adapters.
 */
export const providerSupportedMedia = (provider) => {
	const config = typeof provider === "string" ? { provider } : (isPlainObject(provider) ? provider : {});
	const explicitAdapter = config.media?.adapter ?? config.capabilities?.media?.adapter;
	const key = normalizeMediaProviderKey(
		explicitAdapter ?? config.providerKey ?? config.modelProvider ?? config.provider ?? config.name ?? config.vendor,
	);
	return [...(PROVIDER_NATIVE_MEDIA[key] ?? ["image"])];
};

const nativeDeclarationOf = (provider) => {
	const config = typeof provider === "string" ? { provider } : (isPlainObject(provider) ? provider : {});
	if (isPlainObject(config.media)) return config.media;
	if (isPlainObject(config.capabilities?.media)) return config.capabilities.media;
	return {};
};

const isNativeDeclared = (declaration, kind) => declaration[kind] === true
	|| (Array.isArray(declaration.native) && declaration.native.includes(kind));

/**
 * Resolves an STT instance from the effective config.
 *
 * @param {object} [options]
 * @param {object} [options.config] Effective config; loaded when absent.
 * @param {object} [options.configOptions] Seams for `loadEffectiveConfig()`.
 * @param {string} [options.language]
 * @returns {{stt: object|null, provider: string|null, reason: string|null, source?: string}}
 */
export const resolveSttFromConfig = ({ config, configOptions, language } = {}) => {
	const effective = config ?? loadEffectiveConfig(configOptions).config;
	const raw = effective?.stt ?? effective?.media?.stt;

	if (!isPlainObject(raw)) {
		return { stt: null, provider: null, reason: "no STT configuration" };
	}

	const providers = raw.providers;
	if (!isPlainObject(providers) || !Object.keys(providers).length) {
		return { stt: null, provider: null, reason: "no STT providers configured" };
	}

	const resolved = resolveConfigSecrets(raw);
	const provider = resolved.defaultProvider || Object.keys(resolved.providers)[0];
	return {
		stt: createSpeechToText({
			language,
			...resolved,
			defaultProvider: provider,
		}),
		provider,
		reason: null,
		source: "config",
	};
};

const kindOf = (attachment) => {
	const declared = String(attachment?.kind || "").trim().toLowerCase();
	if (declared) return declared;

	const mimeType = String(
		attachment?.mimeType || guessMimeTypeFromName(attachment?.fileName || ""),
	).toLowerCase();

	if (isImageMimeType(mimeType)) return "image";
	if (isAudioMimeType(mimeType)) return "audio";
	if (isVideoMimeType(mimeType)) return "video";
	if (detectDocumentKind({ mimeType, fileName: attachment?.fileName }) !== "unsupported") {
		return "document";
	}
	return "unknown";
};

const nameOf = (attachment, kind, index) => String(
	attachment?.name || attachment?.fileName || `${kind}-${index + 1}`,
);

const trimText = (text, maxChars) => {
	const value = String(text || "").trim();
	return value.length > maxChars
		? `${value.slice(0, maxChars)}\n...[transcript truncated]`
		: value;
};

const nativeMediaDescriptor = (data, mimeType, kind) => {
	const descriptor = normalizeBinaryDescriptor(data, {
		mimeType: mimeType || (kind === "audio" ? "audio/wav" : "video/mp4"),
	});
	return {
		mimeType: descriptor.mimeType,
		base64: descriptor.data.toString("base64"),
	};
};

/**
 * Prepares all attachments and returns exactly the pieces askAgent() forwards
 * to the provider layer, plus a summary for the response envelope.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.attachments] Images, documents, audio or video.
 * @param {Array} [options.images] Images already normalised by the caller.
 * @param {Array<object>} [options.documents] Documents already extracted by the caller.
 * @param {object} [options.provider] Effective provider config for native media.
 * @param {object} [options.stt] Explicit STT instance; overrides config.
 * @param {object} [options.config] Effective config for automatic STT.
 * @param {object} [options.configOptions] Seams for `loadEffectiveConfig()`.
 * @param {object} [options.media] `maxFrames`, `frameWidth`, `onError`, `language`, etc.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{images: Array, documents: Array<object>, audio: Array<object>,
 *   video: Array<object>, history: Array<object>, promptText: string,
 *   media: object}>}
 */
export const prepareMediaContext = async ({
	attachments = [],
	images = [],
	documents = [],
	provider,
	stt: explicitStt = null,
	config,
	configOptions,
	media = {},
	signal,
} = {}) => {
	const warnings = [];
	const processed = [];
	const effectiveImages = Array.isArray(images) ? [...images] : (images ? [images] : []);
	const effectiveDocuments = Array.isArray(documents) ? [...documents] : (documents ? [documents] : []);
	const effectiveAudio = [];
	const effectiveVideo = [];
	const history = [];
	const promptParts = [];

	const options = isPlainObject(media) ? media : {};
	const throwOnError = String(options.onError || "degrade").toLowerCase() === "throw";
	const maxFrames = clamp(options.maxFrames, 6, 1);
	const frameWidth = clamp(options.frameWidth, 640, 160);
	const timeoutMs = clamp(options.timeoutMs, 300000, 1);
	const maxTranscriptChars = clamp(options.maxTranscriptChars, 20000, 1);
	const language = options.language;
	const ffmpegPath = options.ffmpegPath;

	const warn = (code, message, detail) => {
		if (throwOnError) throw new Error(`${code}: ${message}${detail ? ` (${detail})` : ""}`);
		warnings.push(warning(code, message, detail));
	};

	const fail = (item, code, message, error) => {
		if (throwOnError) throw error || new Error(message);
		warn(code, message, error?.message);
		item.ok = false;
		item.warnings.push(code);
		return null;
	};

	const declaration = nativeDeclarationOf(provider);
	const supportedMedia = providerSupportedMedia(provider);
	const canNative = (kind) => isNativeDeclared(declaration, kind) && supportedMedia.includes(kind);

	const list = Array.isArray(attachments) ? attachments : (attachments ? [attachments] : []);
	const listKinds = list.map(kindOf);
	// Native audio/video never needs STT; only fallback attachments do.
	const needsStt = listKinds.some((kind) => ["audio", "video"].includes(kind) && !canNative(kind));
	let sttState = null;

	if (needsStt) {
		if (explicitStt && typeof explicitStt.transcribe === "function") {
			sttState = {
				stt: explicitStt,
				provider: "explicit",
				reason: null,
				source: "explicit",
			};
		} else {
			try {
				sttState = resolveSttFromConfig({ config, configOptions, language });
				if (!sttState.stt) {
					warnings.push(warning(
						"STT_UNAVAILABLE",
						"No transcription provider is configured; the audio is delivered as a notice only.",
						sttState.reason,
					));
				}
			} catch (error) {
				sttState = { stt: null, provider: null, reason: error.message, source: "config" };
				if (throwOnError) throw error;
				warnings.push(warning(
					"STT_CONFIG_ERROR",
					"The transcription provider could not be initialized; continuing without a transcript.",
					error.message,
				));
			}
		}
	}

	for (const [index, attachment] of list.entries()) {
		const kind = kindOf(attachment);
		const name = nameOf(attachment, kind, index);
		const item = {
			kind,
			name,
			strategy: null,
			frames: 0,
			transcriptChars: 0,
			ok: true,
			warnings: [],
		};

		if (kind === "image") {
			item.strategy = "native-image";
			try {
				effectiveImages.push(imageToDataUrl(attachment.data ?? attachment, attachment.mimeType));
			} catch (error) {
				fail(item, "IMAGE_INVALID", `Could not attach the image "${name}".`, error);
			}
		} else if (kind === "document") {
			item.strategy = "extract-text";
			effectiveDocuments.push({
				data: attachment.data ?? attachment,
				mimeType: attachment.mimeType,
				fileName: name,
			});
		} else if (kind === "audio") {
			if (canNative(kind)) {
				item.strategy = "native-audio";
				try {
					effectiveAudio.push(nativeMediaDescriptor(attachment.data ?? attachment, attachment.mimeType, kind));
				} catch (error) {
					fail(item, "MEDIA_INVALID", `Could not attach the audio "${name}".`, error);
				}
			} else {
				if (isNativeDeclared(declaration, kind)) {
					warn(
						"NATIVE_MEDIA_UNSUPPORTED",
						`The provider declares native audio but its adapter does not support it; using STT for "${name}".`,
						`adapter=${supportedMedia.join(",")}`,
					);
				}
				if (!sttState?.stt) {
					item.strategy = "degraded";
					item.ok = false;
					promptParts.push(`Audio "${name}" not transcribed: no transcription server is available.`);
				} else {
					item.strategy = "stt";
					try {
						const mimeType = String(attachment.mimeType || "").toLowerCase();
						const audio = mimeType.includes("wav")
							? (attachment.data ?? attachment)
							: await extractAudio(attachment.data ?? attachment, { timeoutMs, ffmpegPath });
						const transcript = await sttState.stt.transcribe(audio, {
							mimeType: "audio/wav",
							fileName: name,
							language: attachment.language || language,
							signal,
						});
						const text = trimText(transcript.text, maxTranscriptChars);
						item.transcriptChars = text.length;
						promptParts.push(`Transcript of audio "${name}":\n${text || "(empty)"}`);
					} catch (error) {
						fail(item, "STT_FAILED", `Could not transcribe the audio "${name}".`, error);
						promptParts.push(`Audio "${name}" not transcribed: the STT provider failed.`);
					}
				}
			}
		} else if (kind === "video") {
			if (canNative(kind)) {
				item.strategy = "native-video";
				try {
					effectiveVideo.push(nativeMediaDescriptor(attachment.data ?? attachment, attachment.mimeType, kind));
				} catch (error) {
					fail(item, "MEDIA_INVALID", `Could not attach the video "${name}".`, error);
				}
				processed.push(item);
				continue;
			}
			if (isNativeDeclared(declaration, kind)) {
				warn(
					"NATIVE_MEDIA_UNSUPPORTED",
					`The provider declares native video but its adapter does not support it; using frames/STT for "${name}".`,
					`adapter=${supportedMedia.join(",")}`,
				);
			}
			const data = attachment.data ?? attachment;
			const duration = mediaDuration(data);
			let frames = [];

			try {
				frames = await extractVideoFrames(data, {
					maxFrames: attachment.maxFrames ?? maxFrames,
					width: attachment.frameWidth ?? frameWidth,
					durationSec: duration,
					timeoutMs,
					ffmpegPath,
				});
				item.frames = frames.length;
				if (frames.length) {
					history.push({
						role: "user",
						content: [
							{
								type: "text",
								text: options.frameCaption
									?? `Frames from video "${name}" (${duration.toFixed(1)} s):`,
							},
							...frames.map((base64) => ({
								type: "image_url",
								image_url: { url: `data:image/jpeg;base64,${base64}` },
							})),
						],
					});
				}
			} catch (error) {
				fail(item, "FRAMES_FAILED", `Could not extract frames from the video "${name}".`, error);
			}

			if (!sttState?.stt) {
				item.strategy = frames.length ? "frames" : "degraded";
				if (!frames.length) item.ok = false;
				promptParts.push(`Audio from video "${name}" not transcribed: no transcription server is available.`);
			} else {
				item.strategy = frames.length ? "frames+stt" : "stt";
				try {
					const audio = await extractAudio(data, { timeoutMs, ffmpegPath });
					const transcript = await sttState.stt.transcribe(audio, {
						mimeType: "audio/wav",
						fileName: `${name}.wav`,
						language: attachment.language || language,
						signal,
					});
					const text = trimText(transcript.text, maxTranscriptChars);
					item.transcriptChars = text.length;
					promptParts.push(`Transcript of audio from video "${name}":\n${text || "(empty)"}`);
				} catch (error) {
					fail(item, "STT_FAILED", `Could not transcribe the audio of the video "${name}".`, error);
					promptParts.push(`Audio from video "${name}" not transcribed: the STT provider failed.`);
				}
			}
		} else {
			fail(item, "MEDIA_KIND_UNSUPPORTED", `Tipo de adjunto no soportado: ${kind || "desconocido"}.`);
		}

		processed.push(item);
	}

	// Images were always native; `strategy` describes only the audio/video path.
	const audioVideo = processed.filter((item) => ["audio", "video"].includes(item.kind));
	const nativeCount = audioVideo.filter((item) => ["native-audio", "native-video"].includes(item.strategy)).length;
	const strategy = !audioVideo.length
		? "fallback"
		: (nativeCount === audioVideo.length ? "native" : (nativeCount ? "mixed" : "fallback"));

	const summary = {
		strategy,
		nativeMedia: {
			declared: { ...declaration },
			supported: supportedMedia,
			kinds: supportedMedia.filter((kind) => isNativeDeclared(declaration, kind)),
		},
		stt: sttState?.stt
			? { available: true, provider: sttState.provider, source: sttState.source || "config" }
			: {
				available: false,
				provider: null,
				source: sttState?.source || null,
				reason: sttState?.reason || (needsStt ? "no STT configuration" : "not required"),
			},
		processed,
		warnings,
		frameCount: processed.reduce((sum, item) => sum + item.frames, 0),
		transcriptChars: processed.reduce((sum, item) => sum + item.transcriptChars, 0),
	};

	return {
		images: effectiveImages,
		documents: effectiveDocuments,
		audio: effectiveAudio,
		video: effectiveVideo,
		history,
		promptText: promptParts.join("\n\n"),
		media: summary,
	};
};
