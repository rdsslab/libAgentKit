import path from "node:path";
import { fileURLToPath } from "node:url";
import { askAgent } from "../../src/agent.js";
import { webSearch } from "../../src/websearch.js";
import { getProvider, nowStamp, summarizeResult, summarizeError, printSummary, buildRunRecord, saveRun, writeJson } from "../_lib/common.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const provider = getProvider();
const stamp = nowStamp();

const config = {
	provider,
	mode: "build",
	interactive: true,
	capabilities: { terminal: false, filesystem: false, web: true, mcp: false, documents: true, artifacts: false },
	tools: { web_search: true },
	maxToolRounds: 5,
	includeDiagnostics: true,
	system: "You are a helpful assistant. Use web_search for current information. Answer clearly with the person's name and cite the source found.",
	prompt: "Who is the current president of Ecuador? Answer with the name and cite the source found.",
};

const startedAt = Date.now();
let harness;
try {
	const result = await askAgent(config);
	harness = summarizeResult(result, { startedAt, endedAt: Date.now() });
} catch (error) {
	harness = summarizeError(error, { startedAt, endedAt: Date.now() });
}

let direct;
try {
	direct = await webSearch({ query: "current president of Ecuador 2026", maxResults: 5, timeoutMs: 20000 });
} catch (e) {
	direct = { ok: false, error: e?.message || String(e) };
}

const text = String(harness.text || "");
const comparison = {
	answerMentionsNoboa: /noboa/i.test(text),
	answerMentionsDanielNoboa: /daniel\s+noboa/i.test(text),
	usedWeb: Boolean(harness.usedWeb),
	directSearchOk: Boolean(direct.ok),
	directMentionsNoboa: Boolean((direct.results || []).some((r) => /noboa/i.test(`${r.title} ${r.snippet} ${r.url}`))),
	coherent: /noboa/i.test(text),
};

const record = await buildRunRecord({
	test: "06-current-president-ecuador",
	config: { model: provider.model, baseUrl: provider.baseUrl, timeout: provider.timeout, mode: config.mode, tools: config.tools, capabilities: config.capabilities, maxToolRounds: config.maxToolRounds },
	prompt: config.prompt,
	system: config.system,
	groundTruth: { query: "current president of Ecuador 2026", expected: "Daniel Noboa", direct },
	harness,
	comparison,
});

const file = await saveRun({ dir, model: provider.model, stamp, record });
await writeJson(path.join(dir, "results", "ground-truth-latest.json"), { test: "06-current-president-ecuador-ground-truth", timestamp: record.timestamp, query: "current president of Ecuador 2026", result: direct });

printSummary(`06-current-president-ecuador (${provider.model})`, harness);
console.log("Comparison:", JSON.stringify(comparison, null, 2));
console.log(`Saved: ${file}`);
if (!harness.ok) process.exitCode = 1;
