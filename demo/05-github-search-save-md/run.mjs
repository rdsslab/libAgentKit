import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askAgent } from "../../src/agent.js";
import { createTerminalTool } from "../../src/terminal.js";
import { getProvider, nowStamp, summarizeResult, summarizeError, printSummary, buildRunRecord, saveRun, writeText, ensureDir, modelSlug } from "../_lib/common.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const provider = getProvider();
const stamp = nowStamp();
const slug = modelSlug(provider.model);
const outputDir = path.join(dir, "output", slug);
await ensureDir(outputDir);

const terminal = createTerminalTool({
	allowedBinaries: ["curl", "cat", "echo"],
	timeoutMs: 20000,
	maxOutputBytes: 128 * 1024,
	env: { PATH: process.env.PATH || "/usr/bin:/bin" },
});

const writeOps = [];
const writeFileTool = {
	description: "Write a text file to the demo output directory. Use it to save the requested Markdown file.",
	inputSchema: {
		type: "object",
		properties: {
			filename: { type: "string", description: "File name, e.g. edwinspire-github.md" },
			content: { type: "string", description: "Full file content (Markdown/text)" },
		},
		required: ["filename", "content"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const rawName = String(args?.filename || "output.md").replace(/[^a-zA-Z0-9._-]/g, "_");
		const filename = rawName.endsWith(".md") ? rawName : `${rawName}.md`;
		const content = String(args?.content || "");
		const target = path.join(outputDir, filename);
		const stamped = path.join(outputDir, filename.replace(/\.md$/i, `-${stamp}.md`));
		const latest = path.join(dir, "output", filename);
		await ensureDir(path.dirname(latest));
		await writeText(target, content);
		await writeText(stamped, content);
		await writeText(latest, content);
		const op = { filename, target, stamped, latest, bytes: Buffer.byteLength(content, "utf8") };
		writeOps.push(op);
		return { ok: true, ...op, message: `File saved: ${target}` };
	},
};

const baseConfig = {
	provider,
	mode: "build",
	interactive: true,
	capabilities: { terminal: true, filesystem: false, web: true, mcp: false, documents: true, artifacts: false },
	tools: { run_command: true, web_search: true, write_file: true },
	toolHandlers: { run_command: terminal, write_file: writeFileTool },
	maxToolRounds: 6,
	includeDiagnostics: true,
};

const system = "You are a technical assistant. You can use run_command (curl) and web_search. For GitHub profiles, a reliable approach is: run_command with curl args [\"-sS\",\"-H\",\"Accept: application/vnd.github+json\",\"https://api.github.com/users/<username>\"]. When asked to save information to disk, use the write_file tool with the full Markdown content. Reply in English.";

// Step 1
const step1Prompt = "Find who edwinspire is on GitHub. Use run_command with curl to https://api.github.com/users/edwinspire to get the profile and give me a summary (username, name, bio, location, public repos, followers, profile link).";
const step1Started = Date.now();
let step1;
try {
	const result = await askAgent({ ...baseConfig, system, prompt: step1Prompt });
	step1 = summarizeResult(result, { startedAt: step1Started, endedAt: Date.now() });
} catch (error) {
	step1 = summarizeError(error, { startedAt: step1Started, endedAt: Date.now() });
}
printSummary(`05-step1 (${provider.model})`, step1);

// Step 2
const history = [
	{ role: "user", content: step1Prompt },
	{ role: "assistant", content: step1.text || (step1.error ? `Error: ${step1.error}` : "") },
];
const step2Prompt = "Using the information you found about edwinspire on GitHub, save a Markdown file to disk named `edwinspire-github.md` with that information (include username, name, bio, location, public repos, followers, and profile link). Use write_file.";
const step2Started = Date.now();
let step2;
try {
	const result = await askAgent({ ...baseConfig, system, history, prompt: step2Prompt });
	step2 = summarizeResult(result, { startedAt: step2Started, endedAt: Date.now() });
} catch (error) {
	step2 = summarizeError(error, { startedAt: step2Started, endedAt: Date.now() });
}
printSummary(`05-step2 (${provider.model})`, step2);

// Ground truth
let groundTruth = null;
try {
	const headers = { "User-Agent": "agentkit-demo", "Accept": "application/vnd.github+json" };
	const res = await fetch("https://api.github.com/users/edwinspire", { headers, signal: AbortSignal.timeout(15000) });
	const json = await res.json();
	groundTruth = { ok: res.ok, status: res.status, summary: { login: json.login, name: json.name, bio: json.bio, location: json.location, public_repos: json.public_repos, followers: json.followers, html_url: json.html_url } };
} catch (e) {
	try {
		const gt = JSON.parse(await fs.readFile(path.join(dir, "results", "ground-truth.json"), "utf8"));
		groundTruth = { ok: true, source: "cached", summary: gt.summary || gt.expected };
	} catch {
		groundTruth = { ok: false, error: e?.message || String(e) };
	}
}

let savedFile = null;
const expectedPath = path.join(outputDir, "edwinspire-github.md");
try {
	const content = await fs.readFile(expectedPath, "utf8");
	savedFile = { path: expectedPath, exists: true, bytes: Buffer.byteLength(content, "utf8"), preview: content.slice(0, 2000), content };
} catch {
	savedFile = { path: expectedPath, exists: false };
}

const text1 = String(step1.text || "");
const md = String(savedFile.content || "");
const comparison = {
	step1MentionsLogin: /edwinspire/i.test(text1),
	step1MentionsName: /edwin/i.test(text1),
	step1MentionsProfile: /github\.com\/edwinspire/i.test(text1),
	step1UsedRunCommand: (step1.toolExecutions || []).some((t) => t.tool === "run_command"),
	step1Coherent: /edwinspire/i.test(text1) && (/github\.com\/edwinspire/i.test(text1) || /edwin/i.test(text1)),
	step2UsedWriteFile: (step2.toolExecutions || []).some((t) => t.tool === "write_file" && t.ok) || writeOps.length > 0,
	fileSaved: Boolean(savedFile.exists),
	fileMentionsEdwinspire: /edwinspire/i.test(md),
	fileHasKeyInfo: /github\.com\/edwinspire/i.test(md) || (/repos/i.test(md) && /seguidor|followers/i.test(md)),
	coherent: Boolean(/edwinspire/i.test(text1) && savedFile.exists && /edwinspire/i.test(md)),
};

const record = await buildRunRecord({
	test: "05-github-search-save-md",
	config: { model: provider.model, baseUrl: provider.baseUrl, timeout: provider.timeout, mode: baseConfig.mode, tools: baseConfig.tools, capabilities: baseConfig.capabilities, maxToolRounds: baseConfig.maxToolRounds },
	prompt: null,
	system,
	groundTruth,
	harness: null,
	comparison,
	extra: {
		steps: [
			{ step: 1, prompt: step1Prompt, harness: step1 },
			{ step: 2, prompt: step2Prompt, historyTurns: history.length, harness: step2 },
		],
		writeOperations: writeOps,
		savedFile: savedFile ? { ...savedFile, content: undefined } : null,
		savedFilePreview: savedFile?.preview || null,
	},
});

const file = await saveRun({ dir, model: provider.model, stamp, record });
console.log("Comparison:", JSON.stringify(comparison, null, 2));
console.log(`Saved run: ${file}`);
if (savedFile?.exists) console.log(`Saved md: ${expectedPath}`);
if (!step1.ok || !step2.ok) process.exitCode = 1;
