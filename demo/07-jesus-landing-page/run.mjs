import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askAgent } from "../../src/agent.js";
import { webSearch } from "../../src/websearch.js";
import { getProvider, nowStamp, summarizeResult, summarizeError, printSummary, buildRunRecord, saveRun, writeText, ensureDir, modelSlug } from "../_lib/common.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const provider = getProvider({ timeout: Number(process.env.AGENTKIT_TIMEOUT_MS || 900000) });
const stamp = nowStamp();
const slug = modelSlug(provider.model);
const outputDir = path.join(dir, "output", slug);
await ensureDir(outputDir);

const writeOps = [];
const writeFileTool = {
	description: "Write a text file to the demo output directory. Use it to save the requested HTML landing page.",
	inputSchema: {
		type: "object",
		properties: {
			filename: { type: "string", description: "File name, e.g. jesus-landing-page.html" },
			content: { type: "string", description: "Full HTML file content" },
		},
		required: ["filename", "content"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const rawName = String(args?.filename || "landing.html").replace(/[^a-zA-Z0-9._-]/g, "_");
		const filename = rawName.endsWith(".html") ? rawName : `${rawName}.html`;
		const content = String(args?.content || "");
		const target = path.join(outputDir, filename);
		const stamped = path.join(outputDir, filename.replace(/\.html$/i, `-${stamp}.html`));
		const latest = path.join(dir, "output", filename);
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
	capabilities: { terminal: false, filesystem: false, web: true, mcp: false, documents: true, artifacts: false },
	tools: { web_search: true, write_file: true },
	toolHandlers: { write_file: writeFileTool },
	maxToolRounds: 6,
	includeDiagnostics: true,
};

const system = "You are a helpful research and frontend assistant. Use web_search to gather factual information and cite sources. When asked to create and save a landing page, generate complete, professional, interactive HTML/CSS/JS in a single file and save it using write_file.";

// Step 1: research
const step1Prompt = "Search who Jesus was (historical/religious figure) and provide a concise, factual summary with key points: origins, life, teachings, crucifixion/resurrection beliefs, and historical significance. Cite sources found.";
const step1Started = Date.now();
let step1;
try {
	const result = await askAgent({ ...baseConfig, system, prompt: step1Prompt });
	step1 = summarizeResult(result, { startedAt: step1Started, endedAt: Date.now() });
} catch (error) {
	step1 = summarizeError(error, { startedAt: step1Started, endedAt: Date.now() });
}
printSummary(`07-step1-research (${provider.model})`, step1);

// Step 2: create landing page
const history = [
	{ role: "user", content: step1Prompt },
	{ role: "assistant", content: step1.text || (step1.error ? `Error: ${step1.error}` : "") },
];
const step2Prompt = "Using the information you found about Jesus, create an interactive landing page with a very professional look in a single HTML file. Requirements: modern/responsive design, clear sections (hero, biography/timeline, teachings, legacy/significance), professional styling, and JavaScript interactivity (e.g. navigation/menu, tabs or accordion, smooth scroll, reveal animations, or interactive buttons/cards). Include factual content from your summary. Save it to disk as `jesus-landing-page.html` using write_file and confirm when done.";
const step2Started = Date.now();
let step2;
try {
	const result = await askAgent({ ...baseConfig, system, history, prompt: step2Prompt });
	step2 = summarizeResult(result, { startedAt: step2Started, endedAt: Date.now() });
} catch (error) {
	step2 = summarizeError(error, { startedAt: step2Started, endedAt: Date.now() });
}
printSummary(`07-step2-create (${provider.model})`, step2);

// Ground truth
let groundTruth;
try {
	groundTruth = await webSearch({ query: "who was Jesus of Nazareth historical summary key teachings", maxResults: 5, timeoutMs: 20000 });
} catch (e) {
	groundTruth = { ok: false, error: e?.message || String(e) };
}

// Inspect saved file
let savedFile = null;
const expectedPath = path.join(outputDir, "jesus-landing-page.html");
try {
	const content = await fs.readFile(expectedPath, "utf8");
	savedFile = { path: expectedPath, exists: true, bytes: Buffer.byteLength(content, "utf8"), preview: content.slice(0, 2500), content };
} catch {
	// maybe saved with different name
	const files = await fs.readdir(outputDir).catch(() => []);
	const htmlFile = files.find(f => f.endsWith('.html') && !f.includes(`-${stamp}`));
	if (htmlFile) {
		const p = path.join(outputDir, htmlFile);
		const content = await fs.readFile(p, "utf8").catch(() => "");
		if (content) savedFile = { path: p, exists: true, bytes: Buffer.byteLength(content, "utf8"), preview: content.slice(0, 2500), content, note: "saved with different filename" };
	}
	if (!savedFile) savedFile = { path: expectedPath, exists: false };
}

const text1 = String(step1.text || "");
const html = String(savedFile.content || "");
const validation = {
	hasHtml: /<html[\s>]/i.test(html) || /<!doctype html>/i.test(html),
	hasCss: /<style[\s>]/i.test(html) || /style\s*=\s*"/i.test(html),
	hasScript: /<script[\s>]/i.test(html),
	hasInteractivity: /addEventListener|onclick|classList|scroll|tab|accordion|toggle|modal|menu|animate|intersectionobserver|requestAnimationFrame/i.test(html),
	hasSections: (html.match(/<section|<header|<nav|<footer|<article/gi) || []).length >= 2,
	mentionsJesus: /jesus|nazareth|cristo|christ/i.test(html),
	professionalSignals: /viewport|flex|grid|linear-gradient|box-shadow|border-radius|transition|transform|rem|font-family/i.test(html),
};
validation.passed = validation.hasHtml && validation.hasCss && validation.hasScript && validation.hasInteractivity && validation.mentionsJesus;

const comparison = {
	step1MentionsJesus: /jesus/i.test(text1),
	step1HasKeyPoints: /nazareth|teach|crucif|resurrect|galilee|disciple|parable|christian/i.test(text1),
	step1UsedWeb: Boolean(step1.usedWeb) || (step1.toolExecutions || []).some(t => t.tool === 'web_search'),
	step2UsedWriteFile: (step2.toolExecutions || []).some(t => t.tool === 'write_file' && t.ok) || writeOps.length > 0,
	fileSaved: Boolean(savedFile.exists),
	validation,
	coherent: Boolean(/jesus/i.test(text1) && savedFile.exists && validation.passed),
};

const record = await buildRunRecord({
	test: "07-jesus-landing-page",
	config: { model: provider.model, baseUrl: provider.baseUrl, timeout: provider.timeout, mode: baseConfig.mode, tools: baseConfig.tools, capabilities: baseConfig.capabilities, maxToolRounds: baseConfig.maxToolRounds },
	prompt: null,
	system,
	groundTruth: { query: "who was Jesus of Nazareth historical summary key teachings", direct: groundTruth },
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
		artifactValidation: validation,
	},
});

const file = await saveRun({ dir, model: provider.model, stamp, record });
console.log("Comparison:", JSON.stringify(comparison, null, 2));
console.log("Validation:", JSON.stringify(validation, null, 2));
console.log(`Saved run: ${file}`);
if (savedFile?.exists) console.log(`Saved page: ${savedFile.path}`);
if (!step1.ok || !step2.ok) process.exitCode = 1;
