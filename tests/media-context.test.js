import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerAIProviderAdapter, __internalIAForTests } from "../src/ia.js";
import {
	askAgent,
	providerSupportedMedia,
	registerSttProviderType,
	resolveSttFromConfig,
} from "../src/index.js";

let fakeCounter = 0;

function registerFakeAdapter(onRun, extraConfig = {}) {
	const name = `test-media-${fakeCounter++}`;
	registerAIProviderAdapter(name, () => ({
		run: async (runConfig) => {
			if (typeof onRun === "function") onRun(runConfig);
			return { text: "ANALYSIS" };
		},
	}));
	return { provider: name, model: "fake-model", ...extraConfig };
}

async function fakeFfmpegPath(t) {
	const root = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
	const dir = await mkdtemp(join(root, "agentkit-media-"));
	const script = join(dir, "ffmpeg-fake");
	const source = `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
const riff = Buffer.alloc(44);
riff.write("RIFF", 0, "ascii");
riff.write("WAVE", 8, "ascii");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 1, 0, 0, 0, 0, 0xff, 0xd9]);
process.stdin.resume();
process.stdout.write(args.includes("image2pipe") ? Buffer.concat([jpeg, jpeg]) : riff);
`;
	await writeFile(script, source, "utf8");
	await chmod(script, 0o755);
	t.after(async () => rm(dir, { recursive: true, force: true }));
	return script;
}

test("askAgent: audio sin STT configurado degrada con aviso en el prompt y el envelope", async () => {
	const captured = {};
	const provider = registerFakeAdapter((config) => { captured.config = config; });

	const result = await askAgent({
		provider,
		prompt: "RESUME ESTO",
		config: { stt: { providers: {} } },
		attachments: [{
			kind: "audio",
			name: "nota.wav",
			mimeType: "audio/wav",
			data: Buffer.from("RIFFfake"),
		}],
	});

	assert.equal(result.text, "ANALYSIS");
	assert.equal(result.media.stt.available, false);
	assert.ok(result.media.warnings.some((item) => item.code === "STT_UNAVAILABLE"));
	assert.equal(result.media.processed[0].strategy, "degraded");

	const userMessages = captured.config.prompts.filter((message) => message.role === "user");
	const last = userMessages[userMessages.length - 1];
	assert.match(last.content, /RESUME ESTO/);
	assert.match(last.content, /Audio "nota\.wav" not transcribed/);
});

test("askAgent: expone injectedContextChars y su desglose en el envelope", async () => {
	const captured = {};
	const provider = registerFakeAdapter((config) => { captured.config = config; });

	const result = await askAgent({
		provider,
		prompt: "busca datos de Quito",
		preSearch: "always",
		webSearchFn: async ({ query }) => ({
			ok: true,
			source: "fake-web",
			query,
			results: [{
				title: "Quito — Wikipedia",
				url: "https://es.wikipedia.org/wiki/Quito",
				snippet: "Quito está a 2.850 metros de altitud en los Andes.",
			}],
		}),
	});

	assert.equal(result.usedWeb, true);
	assert.ok(result.injectedContext.web > 0);
	assert.equal(result.injectedContextChars, result.injectedContext.web);
	const userText = captured.config.prompts.filter((message) => message.role === "user")
		.map((message) => message.content).join("\n");
	assert.match(userText, /WEB SEARCH RESULTS/);
});

test("resolveSttFromConfig: crea el STT desde config con un tipo registrado", async () => {
	const type = `fake-config-stt-${fakeCounter++}`;
	registerSttProviderType(type, async () => "TRANSCRITO DESDE CONFIG");

	const resolved = resolveSttFromConfig({
		config: {
			stt: {
				providers: { local: { type, model: "fake" } },
				defaultProvider: "local",
				language: "es",
			},
		},
	});

	assert.equal(resolved.stt.listProviders()[0], "local");
	assert.equal(resolved.provider, "local");
	const transcript = await resolved.stt.transcribe(Buffer.from("audio"), {
		mimeType: "audio/wav",
	});
	assert.equal(transcript.text, "TRANSCRITO DESDE CONFIG");
});

test("askAgent: attachment de vídeo usa STT de config y envía frames al modelo", async (t) => {
	const ffmpegPath = await fakeFfmpegPath(t);
	const type = `fake-video-stt-${fakeCounter++}`;
	registerSttProviderType(type, async () => "TRANSCRIPCION DEL VIDEO");

	const captured = {};
	const provider = registerFakeAdapter((config) => { captured.config = config; });

	const result = await askAgent({
		provider,
		prompt: "ANALIZA EL VIDEO",
		config: {
			stt: {
				providers: { local: { type, model: "fake" } },
				defaultProvider: "local",
				language: "es",
			},
		},
		media: { maxFrames: 2, ffmpegPath },
		attachments: [{
			kind: "video",
			name: "clip.mp4",
			mimeType: "video/mp4",
			data: Buffer.from("fake mp4 bytes"),
		}],
	});

	assert.equal(result.media.stt.available, true);
	assert.equal(result.media.stt.provider, "local");
	const processed = result.media.processed[0];
	assert.equal(processed.strategy, "frames+stt");
	assert.equal(processed.frames, 2);
	assert.equal(processed.transcriptChars, "TRANSCRIPCION DEL VIDEO".length);
	assert.deepEqual(result.media.warnings, []);

	const userMessages = captured.config.prompts.filter((message) => message.role === "user");
	assert.equal(userMessages.length, 2);
	const frameParts = userMessages[0].content.filter((part) => part.type === "image_url");
	assert.equal(frameParts.length, 2);
	assert.match(userMessages[1].content, /TRANSCRIPCION DEL VIDEO/);
});

test("askAgent: attachment de imagen se añade a images sin tocar el prompt", async () => {
	const captured = {};
	const provider = registerFakeAdapter((config) => { captured.config = config; });

	const result = await askAgent({
		provider,
		prompt: "DESCRIBE",
		attachments: [{
			kind: "image",
			name: "foto.png",
			mimeType: "image/png",
			data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
		}],
	});

	assert.equal(captured.config.images.length, 1);
	assert.match(captured.config.images[0], /^data:image\/png;base64,/);
	assert.equal(result.media.processed[0].strategy, "native-image");
	assert.equal(result.media.stt.available, false);
});

test("providerSupportedMedia: capacidades por adaptador, nunca por nombre de modelo", () => {
	assert.deepEqual(providerSupportedMedia({ provider: "google", model: "cualquiera" }), ["image", "audio", "video"]);
	assert.deepEqual(providerSupportedMedia("openai"), ["image", "audio"]);
	assert.deepEqual(providerSupportedMedia({ provider: "ollama-native" }), ["image"]);
	assert.deepEqual(providerSupportedMedia({ provider: "anthropic" }), ["image", "document"]);
	assert.deepEqual(providerSupportedMedia({ provider: "test-desconocido" }), ["image"]);
	assert.deepEqual(providerSupportedMedia({
		provider: "test-desconocido",
		media: { adapter: "google" },
	}), ["image", "audio", "video"]);
});

test("adaptadores: audio nativo se serializa como input_audio (OpenAI) e inlineData (Gemini)", () => {
	const { toOpenAIMessages, convertToGeminiContents, appendMediaToMessages } = __internalIAForTests;
	const messages = appendMediaToMessages([{ role: "user", content: "Escucha" }], {
		audio: [{ mimeType: "audio/mpeg", base64: "YXVkaW8=" }],
	});

	const openai = toOpenAIMessages(messages);
	assert.deepEqual(openai[0].content, [
		{ type: "text", text: "Escucha" },
		{ type: "input_audio", input_audio: { data: "YXVkaW8=", format: "mp3" } },
	]);

	const gemini = convertToGeminiContents(messages);
	assert.deepEqual(gemini[0].parts, [
		{ text: "Escucha" },
		{ inlineData: { mimeType: "audio/mpeg", data: "YXVkaW8=" } },
	]);

	const geminiVideo = convertToGeminiContents([{
		role: "user",
		content: [{ type: "video", mimeType: "video/mp4", base64: "dmlkZW8=" }],
	}]);
	assert.equal(geminiVideo[0].parts[0].inlineData.mimeType, "video/mp4");
});

test("askAgent: audio nativo declarado no necesita STT y llega al adaptador como bytes", async () => {
	const captured = {};
	const provider = registerFakeAdapter(
		(config) => { captured.config = config; },
		{ media: { audio: true, video: true, adapter: "google" } },
	);

	const result = await askAgent({
		provider,
		prompt: "TRANSCRIBE ESTO",
		config: { stt: { providers: {} } },
		attachments: [{
			kind: "audio",
			name: "voz.mp3",
			mimeType: "audio/mpeg",
			data: Buffer.from("audio-bytes"),
		}],
	});

	assert.equal(result.media.strategy, "native");
	assert.equal(result.media.processed[0].strategy, "native-audio");
	assert.equal(result.media.stt.available, false);
	assert.deepEqual(result.media.warnings, []);
	assert.deepEqual(captured.config.audio, [{
		mimeType: "audio/mpeg",
		base64: Buffer.from("audio-bytes").toString("base64"),
	}]);

	const userMessages = captured.config.prompts.filter((message) => message.role === "user");
	assert.equal(userMessages.length, 1);
	assert.doesNotMatch(userMessages[0].content, /no transcrito/);
});

test("askAgent: vídeo nativo declarado se envía sin ffmpeg ni transcripción", async () => {
	const captured = {};
	const provider = registerFakeAdapter(
		(config) => { captured.config = config; },
		{ capabilities: { media: { video: true, adapter: "google" } } },
	);

	const result = await askAgent({
		provider,
		prompt: "ANALIZA",
		config: { stt: { providers: {} } },
		attachments: [{
			kind: "video",
			name: "clip.mp4",
			mimeType: "video/mp4",
			data: Buffer.from("mp4-bytes"),
		}],
	});

	assert.equal(result.media.strategy, "native");
	assert.equal(result.media.processed[0].strategy, "native-video");
	assert.equal(result.media.frameCount, 0);
	assert.deepEqual(result.media.warnings, []);
	assert.deepEqual(captured.config.video, [{
		mimeType: "video/mp4",
		base64: Buffer.from("mp4-bytes").toString("base64"),
	}]);
});

test("askAgent: nativo declarado pero no soportado degrada con aviso", async () => {
	const captured = {};
	const provider = registerFakeAdapter(
		(config) => { captured.config = config; },
		{ media: { audio: true, adapter: "ollama" } },
	);

	const result = await askAgent({
		provider,
		prompt: "RESUME",
		config: { stt: { providers: {} } },
		attachments: [{
			kind: "audio",
			name: "nota.wav",
			mimeType: "audio/wav",
			data: Buffer.from("RIFFfake"),
		}],
	});

	assert.ok(result.media.warnings.some((item) => item.code === "NATIVE_MEDIA_UNSUPPORTED"));
	assert.equal(result.media.strategy, "fallback");
	assert.equal(result.media.processed[0].strategy, "degraded");
	assert.deepEqual(captured.config.audio, []);
});

test("askAgent: combinación nativa y fallback produce strategy=mixed", async (t) => {
	const ffmpegPath = await fakeFfmpegPath(t);
	const type = `fake-mixed-stt-${fakeCounter++}`;
	registerSttProviderType(type, async () => "TEXTO");

	const captured = {};
	const provider = registerFakeAdapter(
		(config) => { captured.config = config; },
		{ media: { audio: true, adapter: "google" } },
	);

	const result = await askAgent({
		provider,
		prompt: "MIRA Y ESCUCHA",
		config: {
			stt: { providers: { local: { type } }, defaultProvider: "local" },
		},
		media: { maxFrames: 2, ffmpegPath },
		attachments: [
			{ kind: "audio", name: "voz.wav", mimeType: "audio/wav", data: Buffer.from("RIFFfake") },
			{ kind: "video", name: "clip.mp4", mimeType: "video/mp4", data: Buffer.from("mp4") },
		],
	});

	assert.equal(result.media.strategy, "mixed");
	assert.deepEqual(result.media.processed.map((item) => item.strategy), ["native-audio", "frames+stt"]);
	assert.equal(captured.config.audio.length, 1);
	assert.deepEqual(captured.config.video, []);
});
