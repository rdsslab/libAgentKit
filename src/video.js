/**
 * Generic video analysis orchestration for the agent kit.
 *
 * This module is model-agnostic: it prepares frames and/or a transcript with
 * the existing media utilities and then calls `askAgent()` with a normal
 * provider config. No model name, prompt language or vendor-specific field is
 * hardcoded here. Native single-pass video is exposed only through an optional
 * `nativeHandler`, so a future adapter can be plugged in without changing this
 * orchestration layer.
 */

import { askAgent } from "./agent.js";
import {
	MediaProviderError,
	extractAudio,
	extractVideoFrames,
	mediaDuration,
} from "./media.js";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const STRATEGIES = new Set(["frames+stt", "frames", "stt", "native"]);
const FRAME_PLACEMENTS = new Set(["history", "prompt", "images"]);

const normalizeStrategy = (value) => {
	const strategy = String(value || "frames+stt").trim().toLowerCase();
	if (!STRATEGIES.has(strategy)) {
		throw new MediaProviderError(`Unsupported video strategy: ${strategy}.`, {
			code: "VIDEO_STRATEGY_UNSUPPORTED",
			userMessage: `Estrategia de video no soportada: ${strategy}. Usa frames+stt, frames, stt o native.`,
		});
	}
	return strategy;
};

const normalizeFramePlacement = (value) => {
	const placement = String(value || "history").trim().toLowerCase();
	if (!FRAME_PLACEMENTS.has(placement)) {
		throw new MediaProviderError(`Unsupported frame placement: ${placement}.`, {
			code: "VIDEO_FRAME_PLACEMENT_UNSUPPORTED",
			userMessage: `Ubicacion de fotogramas no soportada: ${placement}. Usa history, prompt o images.`,
		});
	}
	return placement;
};

const toPromptParts = (value) => {
	if (value == null) return [];
	if (Array.isArray(value)) return value;
	const text = String(value);
	return text ? [{ type: "text", text }] : [];
};

const collapseTextParts = (parts) => {
	const merged = [];
	for (const part of parts) {
		const previous = merged[merged.length - 1];
		if (part?.type === "text" && previous?.type === "text") {
			merged[merged.length - 1] = {
				type: "text",
				text: `${previous.text}\n${part.text}`,
			};
		} else {
			merged.push(part);
		}
	}
	return merged.length === 1 && merged[0].type === "text" ? merged[0].text : merged;
};

/**
 * Prepares the media context for a video call without invoking the model.
 *
 * @param {object} options
 * @param {Buffer|Uint8Array|string|object} options.video Video bytes (or binary descriptor).
 * @param {{transcribe: Function}} [options.stt] SpeechToText instance; required for `stt` strategies.
 * @param {"frames+stt"|"frames"|"stt"|"native"} [options.strategy]
 * @param {string} [options.prompt] Base prompt supplied by the caller.
 * @param {string} [options.frameCaption] Optional text placed before the frames.
 * @param {string} [options.transcriptLabel] Optional text placed before the transcript.
 * @param {"history"|"prompt"|"images"} [options.framePlacement]
 * @param {object} [options.frames] Options forwarded to `extractVideoFrames`.
 * @param {object} [options.audio] Options forwarded to `stt.transcribe` and `extractAudio`.
 * @param {string|AbortSignal} [options.signal]
 * @param {Function} [options.nativeHandler] Required only for `strategy: "native"`.
 * @returns {Promise<{strategy: string, prompt: any, history: Array, images: Array<string>, frames: Array<string>, transcription: object|null, native: boolean, nativeHandler: Function|null, meta: object}>}
 */
export const prepareVideoContext = async ({
	video,
	stt,
	strategy: strategyOption = "frames+stt",
	prompt,
	frameCaption,
	transcriptLabel,
	framePlacement: framePlacementOption = "history",
	frames: frameOptions = {},
	audio: audioOptions = {},
	ffmpegPath,
	timeoutMs,
	signal,
	nativeHandler,
} = {}) => {
	if (video == null) {
		throw new MediaProviderError("A video input is required.", {
			code: "VIDEO_REQUIRED",
			userMessage: "Falta el archivo de video.",
		});
	}

	const strategy = normalizeStrategy(strategyOption);
	const framePlacement = normalizeFramePlacement(framePlacementOption);
	const includeFrames = strategy === "frames" || strategy === "frames+stt";
	const includeTranscript = strategy === "stt" || strategy === "frames+stt";

	if (strategy === "native" && typeof nativeHandler !== "function") {
		throw new MediaProviderError("Native video strategy requires a nativeHandler.", {
			code: "VIDEO_NATIVE_HANDLER_REQUIRED",
			userMessage: "El video nativo requiere un adaptor con soporte de video; configura nativeHandler.",
		});
	}

	if (includeTranscript && (stt == null || typeof stt.transcribe !== "function")) {
		throw new MediaProviderError("Video strategies with transcription require a SpeechToText instance.", {
			code: "VIDEO_STT_REQUIRED",
			userMessage: "Falta el proveedor de transcripcion para analizar el audio del video.",
		});
	}

	let frameList = [];
	let transcription = null;
	let durationSec = mediaDuration(video);

	if (includeFrames) {
		frameList = await extractVideoFrames(video, {
			maxFrames: frameOptions.maxFrames,
			width: frameOptions.width,
			durationSec: frameOptions.durationSec ?? (durationSec > 0 ? durationSec : undefined),
			timeoutMs: frameOptions.timeoutMs ?? timeoutMs,
			ffmpegPath: frameOptions.ffmpegPath ?? ffmpegPath,
		});
	}

	if (includeTranscript) {
		const audio = await extractAudio(video, {
			sampleRate: audioOptions.sampleRate,
			channels: audioOptions.channels,
			codec: audioOptions.codec,
			timeoutMs: audioOptions.timeoutMs ?? timeoutMs,
			maxStdoutBytes: audioOptions.maxStdoutBytes,
			ffmpegPath: audioOptions.ffmpegPath ?? ffmpegPath,
		});

		transcription = await stt.transcribe(audio, {
			mimeType: audioOptions.mimeType || "audio/wav",
			fileName: audioOptions.fileName || "audio.wav",
			language: audioOptions.language,
			provider: audioOptions.provider,
			signal,
		});
	}

	const frameParts = frameList.map((base64) => ({
		type: "image_url",
		image_url: { url: `data:image/jpeg;base64,${base64}` },
	}));

	const promptParts = toPromptParts(prompt);
	const transcriptText = String(transcription?.text || "").trim();
	const transcriptParts = transcriptText
		? toPromptParts(transcriptLabel ? `${transcriptLabel}\n${transcriptText}` : transcriptText)
		: [];

	let finalPrompt;
	let history = [];
	let images = [];

	if (includeFrames && framePlacement === "prompt") {
		finalPrompt = [
			...(frameCaption ? toPromptParts(frameCaption) : []),
			...frameParts,
			...promptParts,
			...transcriptParts,
		];
	} else {
		finalPrompt = collapseTextParts([...promptParts, ...transcriptParts]);

		if (includeFrames && framePlacement === "history") {
			history = [{
				role: "user",
				content: [
					...(frameCaption ? toPromptParts(frameCaption) : []),
					...frameParts,
				],
			}];
		}

		if (includeFrames && framePlacement === "images") {
			images = frameList.map((base64) => `data:image/jpeg;base64,${base64}`);
		}
	}

	return {
		strategy,
		prompt: finalPrompt,
		history,
		images,
		frames: frameList,
		transcription,
		native: strategy === "native",
		nativeHandler: strategy === "native" ? nativeHandler : null,
		meta: {
			strategy,
			framePlacement,
			frameCount: frameList.length,
			durationSec,
			transcriptChars: transcriptText.length,
		},
	};
};

/**
 * Analyses a video with any chat provider.
 *
 * `frames+stt` is the default because it works with every provider that
 * accepts images, without requiring a native video field. The transcript and
 * frames are assembled by `prepareVideoContext()`; the caller supplies the
 * provider, system prompt and the actual question.
 *
 * @param {object} options Same options as `prepareVideoContext`, plus:
 * @param {object} options.provider Normal `askAgent` provider config.
 * @param {string} [options.system] System prompt forwarded to `askAgent`.
 * @param {object} [options.askAgentOptions] Extra `askAgent` options (tools, postProcess, etc.).
 * @returns {Promise<object>} askAgent envelope plus `transcription`, `frames`, `meta` and `context`.
 */
export const analyzeVideo = async ({
	provider,
	system,
	askAgentOptions = {},
	signal,
	...contextOptions
} = {}) => {
	if (!provider) {
		throw new MediaProviderError("analyzeVideo requires a provider configuration.", {
			code: "VIDEO_PROVIDER_REQUIRED",
			userMessage: "Falta la configuracion del proveedor de IA.",
		});
	}

	const context = await prepareVideoContext({
		...contextOptions,
		signal,
	});

	if (context.native) {
		const nativeResult = await context.nativeHandler({
			provider,
			video: contextOptions.video,
			prompt: context.prompt,
			system,
			signal,
		});
		return {
			...nativeResult,
			text: nativeResult?.text || "",
			transcription: null,
			frames: [],
			meta: context.meta,
			context,
		};
	}

	// The preparation owns prompt/history/images; callers can still extend
	// tools, response processing and every other askAgent option.
	const {
		provider: _ignoredProvider,
		prompt: _ignoredPrompt,
		history: _ignoredHistory,
		images: _ignoredImages,
		system: _ignoredSystem,
		...safeAskOptions
	} = isPlainObject(askAgentOptions) ? askAgentOptions : {};

	const result = await askAgent({
		provider,
		prompt: context.prompt,
		history: context.history,
		images: context.images,
		system,
		signal,
		preSearch: false,
		...safeAskOptions,
	});

	return {
		...result,
		text: result?.text || "",
		transcription: context.transcription,
		frames: context.frames,
		meta: context.meta,
		context,
	};
};
