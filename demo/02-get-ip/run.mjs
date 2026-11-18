import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { askAgent } from "../../src/agent.js";
import { createTerminalTool } from "../../src/terminal.js";
import { getProvider, nowStamp, summarizeResult, summarizeError, printSummary, buildRunRecord, saveRun, writeJson } from "../_lib/common.mjs";

const execFileAsync = promisify(execFile);
const dir = path.dirname(fileURLToPath(import.meta.url));
const provider = getProvider();
const stamp = nowStamp();

const terminal = createTerminalTool({
	allowedBinaries: ["hostname", "ip", "uname", "cat", "echo"],
	timeoutMs: 20000,
	maxOutputBytes: 64 * 1024,
	env: { PATH: process.env.PATH || "/usr/bin:/bin" },
});

const config = {
	provider,
	mode: "build",
	interactive: true,
	capabilities: { terminal: true, filesystem: false, web: false, mcp: false, documents: true, artifacts: false },
	tools: { run_command: true },
	toolHandlers: { run_command: terminal },
	maxToolRounds: 5,
	includeDiagnostics: true,
	system: "You are a technical assistant. Use run_command to get real system information. For the primary IP you can use `ip route get 1.1.1.1` (src field) or `hostname -I`. Reply clearly with this machine's primary/local IP.",
	prompt: "Get this machine's IP address using commands and tell me its primary/local IP.",
};

const startedAt = Date.now();
let harness;
try {
	const result = await askAgent(config);
	harness = summarizeResult(result, { startedAt, endedAt: Date.now() });
} catch (error) {
	harness = summarizeError(error, { startedAt, endedAt: Date.now() });
}

let gt = {};
try {
	const [h, route] = await Promise.all([
		execFileAsync("hostname", ["-I"], { timeout: 10000 }),
		execFileAsync("ip", ["route", "get", "1.1.1.1"], { timeout: 10000 }),
	]);
	const allIps = String(h.stdout || "").trim().split(/\s+/).filter(Boolean);
	const m = String(route.stdout || "").match(/src\s+(\S+)/);
	gt = { ok: true, primaryIp: m ? m[1] : null, allIps, hostname_I: h.stdout, ip_route: route.stdout };
} catch (e) {
	gt = { ok: false, error: e?.message || String(e) };
}

const text = String(harness.text || "");
const comparison = {
	mentionsPrimaryIp: gt.primaryIp ? text.includes(gt.primaryIp) : false,
	mentionsAnyKnownIp: (gt.allIps || []).some((ip) => text.includes(ip)),
	usedRunCommand: (harness.toolExecutions || []).some((t) => t.tool === "run_command" && t.ok),
	coherent: Boolean(gt.primaryIp && text.includes(gt.primaryIp)),
	groundTruthPrimaryIp: gt.primaryIp,
};

const record = await buildRunRecord({
	test: "02-get-ip",
	config: { model: provider.model, baseUrl: provider.baseUrl, timeout: provider.timeout, mode: config.mode, tools: config.tools, capabilities: config.capabilities, maxToolRounds: config.maxToolRounds, allowedBinaries: ["hostname","ip","uname","cat","echo"] },
	prompt: config.prompt,
	system: config.system,
	groundTruth: gt,
	harness,
	comparison,
});

const file = await saveRun({ dir, model: provider.model, stamp, record });
await writeJson(path.join(dir, "results", "ground-truth-latest.json"), { test: "02-get-ip-ground-truth", timestamp: record.timestamp, ...gt });

printSummary(`02-get-ip (${provider.model})`, harness);
console.log("Comparison:", JSON.stringify(comparison, null, 2));
console.log(`Saved: ${file}`);
if (!harness.ok) process.exitCode = 1;
