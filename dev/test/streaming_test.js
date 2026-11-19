/**
 * Streaming suite (hermetic): a local fake OpenAI-compatible endpoint verifies
 * that `onTextDelta` is opt-in and that the non-streaming embedded path is
 * byte-for-byte the same request shape it had before the callback existed.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import { askIAWithProviderMCP } from "../../src/ia.js";

const checks = {};
const check = async (name, fn) => {
	await fn();
	checks[name] = true;
};

const chunk = (content, finishReason = null, usage) => {
	const payload = {
		id: "chatcmpl-test",
		object: "chat.completion.chunk",
		created: 1,
		model: "fake-model",
		choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
	};
	if (usage) payload.usage = usage;
	return `data: ${JSON.stringify(payload)}\n\n`;
};

const jsonCompletion = {
	id: "chatcmpl-test",
	object: "chat.completion",
	created: 1,
	model: "fake-model",
	choices: [{ index: 0, message: { role: "assistant", content: "Hola mundo" }, finish_reason: "stop" }],
	usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
};

const startServer = async ({ failStream = false } = {}) => {
	const state = { streamed: [], plain: [] };
	const server = http.createServer(async (request, response) => {
		let raw = "";
		for await (const piece of request) raw += piece;
		const payload = JSON.parse(raw || "{}");
		if (payload.stream) {
			state.streamed.push(payload);
			if (failStream) {
				response.writeHead(400, { "Content-Type": "application/json" });
				response.end(JSON.stringify({ error: { message: "streaming not implemented" } }));
				return;
			}
			response.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			response.write(chunk("Hola "));
			response.write(chunk("mundo"));
			response.write(chunk("", "stop", { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }));
			response.end("data: [DONE]\n\n");
			return;
		}
		state.plain.push(payload);
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify(jsonCompletion));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address();
	return { state, server, baseUrl: `http://127.0.0.1:${port}` };
};

const main = async () => {
	await check("onTextDelta streams chunks and still returns the full text", async () => {
		const { server, state, baseUrl } = await startServer();
		try {
			const deltas = [];
			const result = await askIAWithProviderMCP({
				provider: { provider: "openai-compatible", model: "fake-model", baseUrl, apiKey: "test" },
				prompts: [{ role: "user", content: "hola" }],
				onTextDelta: (delta) => deltas.push(delta),
			});
			assert.equal(result, "Hola mundo");
			assert.deepEqual(deltas, ["Hola ", "mundo"]);
			assert.equal(state.streamed.length, 1);
			assert.equal(state.plain.length, 0);
		} finally {
			server.close();
			await once(server, "close");
		}
	});

	await check("without onTextDelta the request stays non-streaming", async () => {
		const { server, state, baseUrl } = await startServer();
		try {
			const result = await askIAWithProviderMCP({
				provider: { provider: "openai-compatible", model: "fake-model", baseUrl, apiKey: "test" },
				prompts: [{ role: "user", content: "hola" }],
			});
			assert.equal(result, "Hola mundo");
			assert.equal(state.plain.length, 1);
			assert.equal(state.streamed.length, 0);
			assert.equal("stream" in state.plain[0], false);
		} finally {
			server.close();
			await once(server, "close");
		}
	});

	await check("a server without SSE falls back to the plain request", async () => {
		const { server, state, baseUrl } = await startServer({ failStream: true });
		try {
			const deltas = [];
			const result = await askIAWithProviderMCP({
				provider: { provider: "openai-compatible", model: "fake-model", baseUrl, apiKey: "test" },
				prompts: [{ role: "user", content: "hola" }],
				onTextDelta: (delta) => deltas.push(delta),
			});
			assert.equal(result, "Hola mundo");
			assert.deepEqual(deltas, []);
			assert.equal(state.streamed.length, 1);
			assert.equal(state.plain.length, 1);
		} finally {
			server.close();
			await once(server, "close");
		}
	});

	console.log(JSON.stringify({ ok: true, checks }, null, 2));
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
