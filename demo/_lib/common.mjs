import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEnvironmentInfo } from "./env.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const getProvider = (overrides = {}) => ({
	provider: "ollama",
	baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
	model: overrides.model || process.env.AGENTKIT_MODEL || "qwen3:4b-instruct-8k",
	// Local CPU inference can be slow; allow generous timeout.
	timeout: Number(overrides.timeout || process.env.AGENTKIT_TIMEOUT_MS || 600000),
	...overrides,
});

export const modelSlug = (model) => String(model || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_");

export const nowStamp = () => {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

export const ensureDir = async (dir) => {
	await fs.mkdir(dir, { recursive: true });
};

export const writeJson = async (filePath, data) => {
	await ensureDir(path.dirname(fileURLToPath(`file://${path.resolve(filePath)}`) ? `file://${path.resolve(filePath)}` : filePath).replace('file://',''));
	// simpler: ensure dir of filePath
	await ensureDir(path.dirname(filePath));
	await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
	return filePath;
};

export const writeText = async (filePath, text) => {
	await ensureDir(path.dirname(filePath));
	await fs.writeFile(filePath, text, "utf8");
	return filePath;
};

export const readText = async (filePath) => fs.readFile(filePath, "utf8");

export const truncate = (value, max = 4000) => {
	const s = typeof value === "string" ? value : JSON.stringify(value);
	if (s.length <= max) return s;
	return s.slice(0, max) + `\n...[truncated ${s.length - max} chars]`;
};

export const summarizeResult = (result, { startedAt, endedAt } = {}) => {
	const diagnostics = result?.diagnostics || {};
	const toolExecs = Array.isArray(diagnostics.toolExecutions) ? diagnostics.toolExecutions : (result?.toolExecutions || []);
	return {
		ok: true,
		durationMs: endedAt && startedAt ? endedAt - startedAt : undefined,
		text: result?.text ?? "",
		usedWeb: result?.usedWeb ?? false,
		webQuery: result?.webQuery ?? "",
		webResults: result?.webResults ?? [],
		webSource: result?.webSource ?? null,
		webErrors: result?.webErrors ?? [],
		mode: result?.mode,
		hasTools: result?.hasTools,
		usage: result?.usage ?? diagnostics?.usage ?? null,
		toolExecutions: toolExecs.map((e) => ({
			tool: e.toolName || e.tool,
			server: e.serverName || e.server,
			ok: e.isError === undefined ? e.ok : !e.isError,
			deduplicated: Boolean(e.deduplicated),
			args: e.arguments || e.args,
			textResult: truncate(e.textResult || "", 1200),
			rawResult: e.rawResult && typeof e.rawResult === "object"
				? {
					ok: e.rawResult.ok,
					source: e.rawResult.source,
					query: e.rawResult.query,
					resultsCount: Array.isArray(e.rawResult.results) ? e.rawResult.results.length : undefined,
					errors: e.rawResult.errors,
					providersTried: e.rawResult.providersTried,
					exitCode: e.rawResult.exitCode,
					timedOut: e.rawResult.timedOut,
					truncated: e.rawResult.truncated,
					durationMs: e.rawResult.durationMs,
				}
				: undefined,
		})),
		documents: result?.documents ?? [],
	};
};

export const summarizeError = (error, { startedAt, endedAt } = {}) => ({
	ok: false,
	durationMs: endedAt && startedAt ? endedAt - startedAt : undefined,
	error: error?.message || String(error),
	code: error?.code,
	userMessage: error?.userMessage,
	stack: truncate(String(error?.stack || ""), 2000),
});

export const buildRunRecord = async ({ test, config, prompt, system, groundTruth, harness, comparison, extra = {} }) => {
	const environment = await getEnvironmentInfo();
	return {
		test,
		timestamp: new Date().toISOString(),
		environment,
		config,
		prompt,
		system,
		groundTruth,
		harness,
		comparison,
		...extra,
	};
};

export const saveRun = async ({ dir, model, stamp, record }) => {
	const slug = modelSlug(model);
	const base = path.join(dir, "results", slug);
	await ensureDir(base);
	const file = path.join(base, `run-${stamp || nowStamp()}.json`);
	await writeJson(file, record);
	// also keep/update latest pointer for convenience
	await writeJson(path.join(base, "latest.json"), record);
	return file;
};

export const printSummary = (label, data) => {
	console.log(`\n=== ${label} ===`);
	console.log(JSON.stringify({
		ok: data.ok,
		durationMs: data.durationMs,
		text: truncate(data.text || data.error || "", 600),
		usage: data.usage,
		usedWeb: data.usedWeb,
		toolExecutions: (data.toolExecutions || []).map((t) => ({ tool: t.tool, ok: t.ok, args: t.args })),
	}, null, 2));
};
