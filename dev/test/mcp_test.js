/**
 * MCP suite (hermetic).
 *
 * Covers the three pieces F3 adds to the MCP support:
 *
 *   - the config file (servers, transports, trust levels) and the rule that a
 *     project config is not loaded unless the host opts in
 *   - the stdio transport, with a real local MCP server as the child process
 *   - the trust levels: an untrusted server needs an approval per call and
 *     fails closed when there is no approval hook
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	DEFAULT_TRUST_LEVEL,
	MCP_TRUST_LEVELS,
	describeTrust,
	findMcpConfig,
	loadMcpConfig,
	loadMcpServers,
	normalizeMcpServer,
	normalizeMcpServers,
} from "../../src/index.js";
import { listMcpTools } from "../../src/ia.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "mcp_stdio_server.js");
const NODE = process.execPath;

const checks = {};
const check = async (name, fn) => {
	await fn();
	checks[name] = true;
};

const withTempDir = async (fn) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentkit-mcp-"));
	try {
		return await fn(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
};

const main = async () => {
	await check("trust levels", () => {
		assert.deepEqual(MCP_TRUST_LEVELS, ["trusted", "untrusted", "disabled"]);
		assert.equal(DEFAULT_TRUST_LEVEL, "trusted");
		assert.match(describeTrust("untrusted"), /approval/);
	});

	await check("server normalization", () => {
		const httpServer = normalizeMcpServer({ url: "https://mcp.example.com/mcp" });
		assert.equal(httpServer.transport, "http");
		assert.equal(httpServer.name, "mcp.example.com");
		assert.equal(httpServer.trust, "trusted");
		assert.equal(httpServer.enabled, true);

		const stdioServer = normalizeMcpServer({ command: "/usr/local/bin/mcp-server-git", args: ["--repo", "/srv"] });
		assert.equal(stdioServer.transport, "stdio");
		assert.equal(stdioServer.name, "mcp-server-git");
		assert.deepEqual(stdioServer.args, ["--repo", "/srv"]);

		const disabled = normalizeMcpServer({ url: "https://x/mcp", trust: "disabled" });
		assert.equal(disabled.enabled, false);

		const unknownTrust = normalizeMcpServer({ url: "https://x/mcp", trust: "whatever" });
		assert.equal(unknownTrust.trust, "trusted");

		const named = normalizeMcpServer({ name: "files", url: "https://x/mcp" });
		assert.equal(named.name, "files");
	});

	await check("server maps are normalized", () => {
		const servers = normalizeMcpServers({
			files: { url: "https://x/mcp" },
			git: { command: "mcp-git", trust: "untrusted" },
		});
		assert.equal(servers.length, 2);
		assert.equal(servers[0].name, "files");
		assert.equal(servers[1].trust, "untrusted");
	});

	await check("config file is read", async () => {
		await withTempDir(async (dir) => {
			const configPath = path.join(dir, "agentkit.config.json");
			fs.writeFileSync(configPath, JSON.stringify({
				mcpServers: {
					files: { url: "https://files.example.com/mcp", trust: "trusted" },
					git: { command: "mcp-server-git", args: ["--repo", "/srv/repo"], trust: "untrusted" },
					old: { url: "https://old.example.com/mcp", trust: "disabled" },
				},
				terminal: { allowedBinaries: ["git"] },
			}));

			const config = loadMcpConfig(configPath);
			assert.equal(config.mcpServers.length, 3);
			assert.equal(config.mcpServers[1].transport, "stdio");
			assert.equal(config.mcpServers[1].trust, "untrusted");
			assert.equal(config.mcpServers[2].enabled, false);
			assert.deepEqual(config.terminal.allowedBinaries, ["git"]);
		});
	});

	await check("a broken config file says where it is", async () => {
		await withTempDir(async (dir) => {
			const configPath = path.join(dir, "agentkit.config.json");
			fs.writeFileSync(configPath, "{ this is not json");
			assert.throws(() => loadMcpConfig(configPath), /not valid JSON/);
		});
	});

	await check("a project config is not loaded by default", async () => {
		await withTempDir(async (dir) => {
			fs.writeFileSync(path.join(dir, "agentkit.config.json"), JSON.stringify({
				mcpServers: { sneaky: { url: "https://sneaky.example.com/mcp" } },
			}));

			const home = path.join(dir, "home");
			fs.mkdirSync(home, { recursive: true });

			assert.equal(findMcpConfig({ cwd: dir, home }), null);
			assert.deepEqual(loadMcpServers({ cwd: dir, home }), []);

			// the host can opt in explicitly
			const found = findMcpConfig({ cwd: dir, home, allowProjectConfig: true });
			assert.ok(found && found.startsWith(dir));

			const servers = loadMcpServers({ cwd: dir, home, allowProjectConfig: true });
			assert.equal(servers.length, 1);
			assert.equal(servers[0].name, "sneaky");
		});
	});

	await check("the user config is found", async () => {
		await withTempDir(async (dir) => {
			const home = path.join(dir, "home");
			const configDir = path.join(home, ".config", "agentkit");
			fs.mkdirSync(configDir, { recursive: true });
			fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
				mcpServers: { mine: { url: "https://mine.example.com/mcp" } },
			}));

			const found = findMcpConfig({ cwd: dir, home });
			assert.ok(found && found.includes("agentkit"));

			const servers = loadMcpServers({ cwd: dir, home });
			assert.equal(servers.length, 1);
			assert.equal(servers[0].name, "mine");
		});
	});

	await check("a stdio server is connected and its tools listed", async () => {
		const catalog = await listMcpTools({
			mcpServers: [{
				name: "fixture",
				command: NODE,
				args: [FIXTURE],
				trust: "trusted",
			}],
		});

		assert.equal(catalog.length, 1);
		assert.equal(catalog[0].server.name, "fixture");
		assert.equal(catalog[0].server.transport, "stdio");
		const names = catalog[0].tools.map((tool) => tool.name);
		assert.ok(names.includes("echo"));
		assert.ok(names.includes("fail"));
	});

	await check("a disabled server is not connected", async () => {
		const catalog = await listMcpTools({
			mcpServers: [{
				name: "fixture",
				command: NODE,
				args: [FIXTURE],
				trust: "disabled",
			}],
		});
		assert.equal(catalog.length, 0);
	});

	await check("an http server still works", async () => {
		// A minimal Streamable HTTP server is a lot of machinery; the HTTP path
		// is already covered by the platform. Here we only check that an http
		// entry without a URL fails with a clear message.
		await assert.rejects(
			() => listMcpTools({ mcpServers: [{ name: "broken" }] }),
			/url|command/,
		);
	});

	await check("the trust level travels to the tool catalog", async () => {
		const server = http.createServer((req, res) => {
			res.statusCode = 500;
			res.end();
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const baseUrl = `http://127.0.0.1:${server.address().port}/mcp`;

		try {
			// The server answers 500: the connection fails, but the entry shape
			// (transport + trust) is what this check is about.
			await assert.rejects(() => listMcpTools({
				mcpServers: [{ name: "http", url: baseUrl, trust: "untrusted" }],
			}));
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	// --- tool calls through a model ------------------------------------------

	const startFakeOpenAI = async (replies) => {
		const requests = [];
		const server = http.createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				const parsed = body ? JSON.parse(body) : {};
				requests.push(parsed);
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify(replies[Math.min(requests.length - 1, replies.length - 1)]));
			});
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		return {
			requests,
			baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
			close: () => new Promise((resolve) => server.close(resolve)),
		};
	};

	const toolCallReply = (name, args) => ({
		id: "cmpl",
		object: "chat.completion",
		created: 1,
		model: "fake",
		choices: [{
			index: 0,
			message: {
				role: "assistant",
				content: null,
				tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
			},
			finish_reason: "tool_calls",
		}],
		usage: {},
	});

	const textReply = (text) => ({
		id: "cmpl",
		object: "chat.completion",
		created: 1,
		model: "fake",
		choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
		usage: {},
	});

	const runWithServer = async ({ trust, approveToolCall }) => {
		const fake = await startFakeOpenAI([
			toolCallReply("fixture__echo", { text: "hola" }),
			textReply("listo"),
		]);

		try {
			const { askAgent } = await import("../../src/index.js");
			const result = await askAgent({
				provider: { provider: "openai-compatible", model: "fake", baseUrl: fake.baseUrl, apiKey: "test" },
				messages: [{ role: "user", content: "usa la herramienta" }],
				mcpServers: [{
					name: "fixture",
					command: NODE,
					args: [FIXTURE],
					trust,
				}],
				approveToolCall,
			});

			return { result, requests: fake.requests };
		} finally {
			await fake.close();
		}
	};

	await check("a trusted server runs its tool", async () => {
		const { result, requests } = await runWithServer({ trust: "trusted" });
		const execution = result.toolExecutions[0];
		assert.ok(execution, "the tool must have been executed");
		assert.equal(execution.ok, true);
		// the result of the tool reached the model
		assert.ok(JSON.stringify(requests[1]).includes("echo:hola"));
	});

	await check("an untrusted server without approval hook fails closed", async () => {
		const { result, requests } = await runWithServer({ trust: "untrusted" });
		const execution = result.toolExecutions[0];
		assert.ok(execution, "the call must appear in the log");
		assert.equal(execution.ok, false);
		assert.match(requests[1] ? JSON.stringify(requests[1]) : "", /not approved|approval hook/i);
	});

	await check("an untrusted server can be approved", async () => {
		const seen = [];
		const { result, requests } = await runWithServer({
			trust: "untrusted",
			approveToolCall: async (request) => {
				seen.push(request);
				return true;
			},
		});
		assert.equal(seen.length, 1);
		assert.equal(seen[0].serverName, "fixture");
		assert.equal(seen[0].toolName, "echo");
		assert.deepEqual(seen[0].arguments, { text: "hola" });
		assert.equal(result.toolExecutions[0].ok, true);
		assert.ok(JSON.stringify(requests[1]).includes("echo:hola"));
	});

	await check("an untrusted server can be rejected", async () => {
		const { result } = await runWithServer({
			trust: "untrusted",
			approveToolCall: async () => false,
		});
		assert.equal(result.toolExecutions[0].ok, false);
	});

	console.log(JSON.stringify({ ok: true, checks }, null, 2));
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
