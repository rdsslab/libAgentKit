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
	system: "You are a helpful assistant. If you need external or current information, use web_search. Reply briefly in Spanish (or clearly) indicating the answer and the source found.",
	prompt: "Search the internet: what is the capital of Ecuador? Answer with the capital and the source found.",
};

const startedAt = Date.now();
let harness;
try {
	const result = await askAgent(config);
	harness = summarizeResult(result, { startedAt, endedAt: Date.now() });
} catch (error) {
	harness = summarizeError(error, { startedAt, endedAt: Date.now() });
}

// Direct ground truth for comparison in same run
let direct;
try {
	direct = await webSearch({ query: "capital of Ecuador", maxResults: 5, timeoutMs: 20000 });
} catch (e) {
	direct = { ok: false, error: e?.message || String(e) };
}

const comparison = {
	answerMentionsQuito: /quito/i.test(harness.text || ""),
	usedWeb: Boolean(harness.usedWeb),
	directSearchOk: Boolean(direct.ok),
	directTopResultHasQuito: Boolean((direct.results || []).some((r) => /quito/i.test(`${r.title} ${r.snippet} ${r.url}`))),
	coherent: /quito/i.test(harness.text || "") && Boolean(direct.ok),
};

const record = await buildRunRecord({
	test: "01-web-search",
	config: { model: provider.model, baseUrl: provider.baseUrl, timeout: provider.timeout, mode: config.mode, tools: config.tools, capabilities: config.capabilities, maxToolRounds: config.maxToolRounds },
	prompt: config.prompt,
	system: config.system,
	groundTruth: { query: "capital of Ecuador", direct },
	harness,
	comparison,
});

const file = await saveRun({ dir, model: provider.model, stamp, record });
await writeJson(path.join(dir, "results", "ground-truth-latest.json"), { test: "01-web-search-ground-truth", timestamp: record.timestamp, query: "capital of Ecuador", result: direct });

printSummary(`01-web-search (${provider.model})`, harness);
console.log("Comparison:", JSON.stringify(comparison, null, 2));
console.log(`Saved: ${file}`);
if (!harness.ok) process.exitCode = 1;
