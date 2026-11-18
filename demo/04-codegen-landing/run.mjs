import path from "node:path";
import { fileURLToPath } from "node:url";
import { askAgent } from "../../src/agent.js";
import { getProvider, nowStamp, summarizeResult, summarizeError, printSummary, buildRunRecord, saveRun, writeText, ensureDir, modelSlug } from "../_lib/common.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const provider = getProvider();
const stamp = nowStamp();
const slug = modelSlug(provider.model);

const prompt = "Create a simple landing page in a single HTML file. It must include some CSS and JavaScript to animate the buttons (for example on hover or click). Return the complete HTML file code.";
const system = "You are a frontend developer. Generate complete, clean, functional code. Respond primarily with the requested HTML file (you can use a ```html block).";

const config = {
	provider,
	mode: "build",
	interactive: true,
	capabilities: { terminal: false, filesystem: false, web: false, mcp: false, documents: false, artifacts: false },
	tools: {},
	maxToolRounds: 2,
	includeDiagnostics: true,
	system,
	prompt,
};

const extractHtml = (text) => {
	const s = String(text || "");
	const fenced = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
	if (fenced) return fenced[1].trim();
	const doctype = s.indexOf("<!DOCTYPE");
	const htmlTag = s.indexOf("<html");
	const start = doctype >= 0 ? doctype : htmlTag;
	if (start >= 0) {
		const end = s.lastIndexOf("</html>");
		return (end > start ? s.slice(start, end + 7) : s.slice(start)).trim();
	}
	return s.trim();
};

const validateLanding = (html) => {
	const h = String(html || "");
	const checks = {
		hasHtml: /<html[\s>]/i.test(h) || /<!doctype html>/i.test(h),
		hasHeadOrBody: /<head[\s>]/i.test(h) || /<body[\s>]/i.test(h),
		hasButton: /<button[\s>]/i.test(h),
		hasScript: /<script[\s>]/i.test(h) || /onclick=|addEventListener\(/i.test(h),
		hasAnimation: /@keyframes|animation\s*:|transition\s*:|transform\s*:|requestAnimationFrame|classList\.(add|toggle)|\.animate\(/i.test(h),
		hasCss: /<style[\s>]/i.test(h) || /style\s*=\s*"/i.test(h),
	};
	checks.passed = checks.hasHtml && checks.hasButton && checks.hasScript && checks.hasAnimation;
	return checks;
};

const startedAt = Date.now();
let harness;
try {
	const result = await askAgent(config);
	harness = summarizeResult(result, { startedAt, endedAt: Date.now() });
} catch (error) {
	harness = summarizeError(error, { startedAt, endedAt: Date.now() });
}

const html = extractHtml(harness.text || "");
const validation = validateLanding(html);

const outputDir = path.join(dir, "output", slug);
const resultsDir = path.join(dir, "results", slug);
await ensureDir(outputDir);
await ensureDir(resultsDir);

let artifacts = {};
if (html) {
	const outPath = path.join(outputDir, "landing-page.html");
	const resCopy = path.join(resultsDir, `landing-page-${stamp}.html`);
	const latest = path.join(dir, "output", "landing-page.html");
	await writeText(outPath, html + "\n");
	await writeText(resCopy, html + "\n");
	await writeText(latest, html + "\n");
	artifacts = {
		extracted: true,
		path: path.relative(path.resolve(dir, "../.."), outPath),
		resultCopy: path.relative(path.resolve(dir, "../.."), resCopy),
		latest: path.relative(path.resolve(dir, "../.."), latest),
		bytes: Buffer.byteLength(html, "utf8"),
		preview: html.slice(0, 1500),
	};
}

const comparison = {
	coherent: Boolean(harness.ok && validation.passed),
	notes: validation.passed ? "Generated code passes basic checks (HTML, button, JS, animation)." : "Some expected checks are missing; inspect generated artifact.",
};

const record = await buildRunRecord({
	test: "04-codegen-landing",
	config: { model: provider.model, baseUrl: provider.baseUrl, timeout: provider.timeout, mode: config.mode, tools: config.tools, capabilities: config.capabilities, maxToolRounds: config.maxToolRounds },
	prompt,
	system,
	groundTruth: { type: "automated-validation", checks: Object.keys(validation) },
	harness,
	comparison,
	extra: { artifact: artifacts, validation },
});

const file = await saveRun({ dir, model: provider.model, stamp, record });

printSummary(`04-codegen-landing (${provider.model})`, harness);
console.log("Validation:", JSON.stringify(validation, null, 2));
console.log(`Saved: ${file}`);
if (artifacts.path) console.log(`Artifact: ${artifacts.path}`);
if (!harness.ok) process.exitCode = 1;
