import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerAIProviderAdapter } from "../src/ia.js";
import { analyzeVideo, prepareVideoContext, MediaProviderError } from "../src/index.js";

let fakeCounter = 0;

function registerFakeAdapter(onRun) {
	const name = `test-video-${fakeCounter++}`;
	registerAIProviderAdapter(name, () => ({
		run: async (runConfig) => {
			if (typeof onRun === "function") onRun(runConfig);
			return { text: "ANALYSIS" };
		},
	}));
	return { provider: name, model: "fake-model" };
}

async function fakeFfmpegPath(t) {
	const root = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
	const dir = await mkdtemp(join(root, "agentkit-video-"));
	const script = join(dir, "ffmpeg-fake");
	const source = `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
const riff = Buffer.alloc(44);
riff.write("RIFF", 0, "ascii");
riff.write("WAVE", 8, "ascii");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 1, 0, 0, 0, 0, 0xff, 0xd9]);
const out = args.includes("image2pipe") ? Buffer.concat([jpeg, jpeg]) : riff;
process.stdin.resume();
process.stdout.write(out);
`;
	await writeFile(script, source, "utf8");
	await chmod(script, 0o755);
	t.after(async () => rm(dir, { recursive: true, force: true }));
	return script;
}

function fakeStt(captured) {
	return {
		async transcribe(audio, options) {
			captured.audio = audio;
			captured.sttOptions = options;
			return {
				text: "TEXTO TRANSCRITO",
				provider: "fake-stt",
				mimeType: options.mimeType,
				fileName: options.fileName,
			};
		},
	};
}

test("analyzeVideo: frames+stt pone frames en history y transcripción en el último mensaje", async (t) => {
	const ffmpegPath = await fakeFfmpegPath(t);
	const captured = { config: null, sttOptions: null, audio: null };
	const provider = registerFakeAdapter((config) => {
		captured.config = config;
	});

	const result = await analyzeVideo({
		provider,
		video: Buffer.from("fake mp4 bytes"),
		stt: fakeStt(captured),
		system: "SYSTEM DE LA DEMO",
		prompt: "PROMPT BASE",
		frameCaption: "FOTOS:",
		transcriptLabel: "TRANSCRIPCION:",
		frames: { maxFrames: 2, width: 320 },
		audio: { language: "es" },
		ffmpegPath,
		timeoutMs: 5000,
	});

	assert.equal(result.text, "ANALYSIS");
	assert.equal(result.transcription.text, "TEXTO TRANSCRITO");
	assert.equal(result.frames.length, 2);
	assert.equal(result.meta.strategy, "frames+stt");
	assert.equal(result.meta.frameCount, 2);
	assert.ok(Buffer.isBuffer(captured.audio));
	assert.equal(captured.sttOptions.mimeType, "audio/wav");
	assert.equal(captured.sttOptions.language, "es");

	const messages = captured.config.prompts.filter((message) => message.role === "user");
	assert.equal(messages.length, 2);

	const frameMessage = messages[0];
	assert.ok(Array.isArray(frameMessage.content));
	assert.equal(frameMessage.content[0].text, "FOTOS:");
	assert.equal(frameMessage.content.filter((part) => part.type === "image_url").length, 2);

	const finalMessage = messages[1];
	assert.equal(typeof finalMessage.content, "string");
	assert.match(finalMessage.content, /PROMPT BASE/);
	assert.match(finalMessage.content, /TRANSCRIPCION:\nTEXTO TRANSCRITO/);
});

test("analyzeVideo: strategy stt transcribe pero no envía frames", async (t) => {
	const ffmpegPath = await fakeFfmpegPath(t);
	const captured = { config: null };
	const provider = registerFakeAdapter((config) => {
		captured.config = config;
	});

	const result = await analyzeVideo({
		provider,
		video: Buffer.from("fake mp4 bytes"),
		stt: fakeStt(captured),
		strategy: "stt",
		prompt: "SOLO AUDIO",
		ffmpegPath,
	});

	assert.equal(result.text, "ANALYSIS");
	assert.deepEqual(result.frames, []);
	assert.equal(result.transcription.text, "TEXTO TRANSCRITO");
	assert.equal(result.meta.strategy, "stt");
	assert.equal(result.meta.frameCount, 0);

	const messages = captured.config.prompts.filter((message) => message.role === "user");
	assert.equal(messages.length, 1);
	assert.match(messages[0].content, /SOLO AUDIO/);
	assert.match(messages[0].content, /TEXTO TRANSCRITO/);
});

test("analyzeVideo: framePlacement images pasa los frames como imágenes a askAgent", async (t) => {
	const ffmpegPath = await fakeFfmpegPath(t);
	const captured = { config: null };
	const provider = registerFakeAdapter((config) => {
		captured.config = config;
	});

	const result = await analyzeVideo({
		provider,
		video: Buffer.from("fake mp4 bytes"),
		stt: fakeStt(captured),
		framePlacement: "images",
		prompt: "CON IMÁGENES",
		frames: { maxFrames: 2 },
		ffmpegPath,
	});

	assert.equal(result.frames.length, 2);
	assert.equal(captured.config.images.length, 2);
	assert.match(captured.config.images[0], /^data:image\/jpeg;base64,/);

	const finalMessage = captured.config.prompts.find((message) => message.role === "user");
	assert.equal(typeof finalMessage.content, "string");
	assert.doesNotMatch(JSON.stringify(finalMessage.content), /image_url/);
});

test("analyzeVideo: strategy native delega en nativeHandler sin STT ni ffmpeg", async () => {
	const captured = { config: null };
	const provider = registerFakeAdapter((config) => {
		captured.config = config;
	});
	let nativeArgs = null;

	const result = await analyzeVideo({
		provider,
		video: Buffer.from("fake mp4 bytes"),
		strategy: "native",
		prompt: "VIDEO NATIVO",
		nativeHandler: async (args) => {
			nativeArgs = args;
			return { text: "NATIVE ANSWER", usage: { total_tokens: 7 } };
		},
	});

	assert.equal(result.text, "NATIVE ANSWER");
	assert.equal(result.usage.total_tokens, 7);
	assert.equal(result.meta.strategy, "native");
	assert.equal(result.transcription, null);
	assert.deepEqual(result.frames, []);
	assert.equal(nativeArgs.prompt, "VIDEO NATIVO");
	assert.equal(captured.config, null);
});

test("prepareVideoContext: native sin nativeHandler falla con error claro", async () => {
	await assert.rejects(
		() => prepareVideoContext({
			video: Buffer.from("fake mp4 bytes"),
			strategy: "native",
		}),
		(error) => error instanceof MediaProviderError
			&& error.code === "VIDEO_NATIVE_HANDLER_REQUIRED",
	);
});
