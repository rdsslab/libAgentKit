import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { askAgent } from "../../src/agent.js";
import { createTerminalTool } from "../../src/terminal.js";
import { getProvider, nowStamp, summarizeResult, summarizeError, printSummary, buildRunRecord, saveRun, writeJson } from "../_lib/common.mjs";

const execFileAsync = promisify(execFile);
const dir = path.dirname(fileURLToPath(import.meta.url));
const provider = getProvider({ timeout: Number(process.env.AGENTKIT_TIMEOUT_MS || 900000) });
const stamp = nowStamp();
const url = "http://192.168.100.126:3000";

const terminal = createTerminalTool({
	allowedBinaries: ["curl", "cat", "echo"],
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
	maxToolRounds: 4,
	includeDiagnostics: true,
	system: "You are a technical assistant. Use run_command to execute curl against the given URL. To avoid exceeding small-model context, prefer `curl -sS -m 8 -I http://192.168.100.126:3000` (headers). Pass flags in args array. Briefly report HTTP status code, content-type, and what service/page it appears to be.",
	prompt: `Run curl against ${url} and summarize the response (HTTP status code, content-type, and what service/page it appears to be).`,
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
	const { stdout } = await execFileAsync("curl", ["-sS", "-m", "8", "-i", url], { timeout: 15000, maxBuffer: 512 * 1024 });
	const statusMatch = stdout.match(/HTTP\/[\d.]+\s+(\d{3})/);
	const ctMatch = stdout.match(/content-type:\s*([^\r\n]+)/i);
	const titleMatch = stdout.match(/<title>([^<]+)<\/title>/i);
	gt = { ok: true, statusCode: statusMatch ? Number(statusMatch[1]) : null, contentType: ctMatch ? ctMatch[1].trim() : null, title: titleMatch ? titleMatch[1].trim() : null, stdout: stdout.slice(0, 3000) };
} catch (e) {
	gt = { ok: false, error: e?.message || String(e), stdout: e?.stdout, stderr: e?.stderr };
}

const text = String(harness.text || "");
const comparison = {
	groundTruthOk: Boolean(gt.ok),
	mentions200: /\b200\b/.test(text),
	mentionsHtml: /text\/html|html/i.test(text),
	mentionsOpenFusion: /openfusion/i.test(text),
	usedRunCommand: (harness.toolExecutions || []).some((t) => t.tool === "run_command"),
	toolOk: (harness.toolExecutions || []).some((t) => t.tool === "run_command" && t.ok),
	coherent: Boolean(gt.ok && /\b200\b/.test(text) && (/openfusion/i.test(text) || /text\/html/i.test(text) || /html/i.test(text))),
};

const record = await buildRunRecord({
	test: "03-curl-local",
	config: { model: provider.model, baseUrl: provider.baseUrl, timeout: provider.timeout, mode: config.mode, tools: config.tools, capabilities: config.capabilities, maxToolRounds: config.maxToolRounds, allowedBinaries: ["curl","cat","echo"], url },
	prompt: config.prompt,
	system: config.system,
	groundTruth: gt,
	harness,
	comparison,
	extra: { note: "Uses header-only curl (-I) by prompt guidance to avoid context overflow with large HTML responses on small-context models." },
});

const file = await saveRun({ dir, model: provider.model, stamp, record });
await writeJson(path.join(dir, "results", "ground-truth-latest.json"), { test: "03-curl-local-ground-truth", timestamp: record.timestamp, url, ...gt });

printSummary(`03-curl-local (${provider.model})`, harness);
console.log("Comparison:", JSON.stringify(comparison, null, 2));
console.log(`Saved: ${file}`);
if (!harness.ok) process.exitCode = 1;
