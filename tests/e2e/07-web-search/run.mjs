import { askAgent } from "../../../src/agent.js";
import { checkGrounding } from "../../../src/policies.js";

const BASE_URL = process.env.AGENT_OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL_NAME = process.env.AGENT_MODEL ?? "qwen3:0.6b-16k";
const MODEL = { model: MODEL_NAME, baseUrl: BASE_URL, contextLength: 8192 };
const truthy = (value) => ["1", "true", "yes"].includes(String(value ?? "").toLowerCase());
// Offline mode uses a deterministic adapter and fake search results, so the
// preSearch + grounding path can be verified without Ollama or internet.
const DRY_RUN = process.argv.includes("--dry") || truthy(process.env.AGENT_DRY_RUN);

const SEARCH_QUERIES = [
	{ query: "capital of Ecuador", answer: "Quito is the capital of Ecuador." },
	{ query: " altitude of Quito ", answer: "Quito sits at about 2850 metres." },
	{ query: "Itchimbia Park Quito", answer: "Itchimbia Park overlooks Quito." },
];

const FAKE_WEB = {
	ok: true,
	source: "e2e-fake-web",
	results: [
		{
			title: "Quito - Wikipedia",
			url: "https://en.wikipedia.org/wiki/Quito",
			snippet: "Quito is the capital of Ecuador and sits at about 2850 metres in the Andes.",
		},
		{
			title: "Itchimbia Park - Quito City Council",
			url: "https://www.quito.gob.ec/parque-itchimbia",
			snippet: "Itchimbia Park offers a panoramic view of the historic centre of Quito.",
		},
	],
};

const lastPrompt = { text: "" };
const registerFakeAdapter = async () => {
	const { registerAIProviderAdapter } = await import("../../../src/ia.js");
	const name = `e2e-web-dry-${Date.now()}`;
	registerAIProviderAdapter(name, () => ({
		run: async ({ prompts = [], onTextDelta }) => {
			const lastUser = [...prompts].reverse().find((message) => message.role === "user");
			const text = String(lastUser?.content ?? "");
			lastPrompt.text = text;
			const answer = /WEB SEARCH RESULTS/i.test(text)
				? "According to the sources, Quito is the capital of Ecuador at about 2850 metres (Source: Quito - Wikipedia)."
				: "I have no web sources in this turn.";
			onTextDelta?.(answer, { provider: name, model: "dry-model" });
			return { text: answer, provider: name, model: "dry-model", toolExecutions: [] };
		},
	}));
	return { provider: name, model: "dry-model", contextLength: 8192 };
};

const runPreSearch = async (query, provider) => {
	const start = Date.now();
	const result = await askAgent({
		provider,
		messages: [{ role: "user", content: `Search the web for: ${query}. Summarise the sources.` }],
		system: "Answer in English and cite the source when you use web results.",
		mode: "build",
		preSearch: "always",
		tools: { web_search: false },
		capabilities: {
			terminal: false,
			web: true,
			mcp: false,
			documents: false,
			artifacts: false,
			filesystem: false,
		},
		webSearch: { maxResults: 3, maxInjectedContextChars: 2200 },
		...(DRY_RUN ? { webSearchFn: async (request) => ({ ...FAKE_WEB, query: request.query }) } : {}),
		includeDiagnostics: true,
	});

	const recapInjected = /WEB SEARCH RESULTS/i.test(lastPrompt.text);
	const grounding = checkGrounding({ text: result.text, webResults: result.webResults });
	return {
		query,
		success: true,
		durationMs: Date.now() - start,
		usedWeb: result.usedWeb,
		webQuery: result.webQuery,
		webResults: result.webResults,
		webErrors: result.webErrors,
		text: result.text,
		injectedChars: result.injectedContextChars,
		injectedContext: result.injectedContext,
		recapInjected,
		grounding: {
			ok: grounding.ok,
			coverage: grounding.coverage,
			confidence: grounding.confidence,
			unsupported: grounding.unsupported,
		},
	};
};

const runWebTool = async (query, provider) => {
	const start = Date.now();
	let result = null;
	let error = null;
	try {
		result = await askAgent({
			provider,
			messages: [{ role: "user", content: `Search the web for: ${query}. Summarise the most relevant results.` }],
			mode: "build",
			tools: { web_search: true },
			capabilities: {
				terminal: false,
				web: true,
				mcp: false,
				documents: false,
				artifacts: false,
				filesystem: false,
			},
			includeDiagnostics: true,
		});
	} catch (err) {
		error = err.message;
	}

	return {
		query,
		success: !error,
		error,
		durationMs: Date.now() - start,
		usedWeb: result?.usedWeb || false,
		webQuery: result?.webQuery || "",
		webResults: result?.webResults || [],
		webErrors: result?.webErrors || [],
		text: result?.text || "",
		toolExecutions: result?.toolExecutions || [],
		injectedChars: result?.injectedContextChars || 0,
		injectedContext: result?.injectedContext || null,
	};
};

async function main() {
	console.log("================================================");
	console.log("E2E-07: Web search - AgentKit core");
	console.log("================================================");
	console.log(`Mode: ${DRY_RUN ? "offline (fake adapter + fake search)" : "live"}`);
	console.log(`Model: ${DRY_RUN ? "dry-model" : MODEL_NAME} @ ${BASE_URL}`);
	console.log("");

	const provider = DRY_RUN ? await registerFakeAdapter() : MODEL;
	const checks = [];
	const preSearchResults = [];

	console.log("--- Deterministic preSearch + grounding ---");
	for (const { query } of SEARCH_QUERIES) {
		const entry = await runPreSearch(query, provider);
		preSearchResults.push(entry);
		console.log(`  query="${entry.webQuery}" results=${entry.webResults.length} `
			+ `recapInjected=${entry.recapInjected} grounding=${JSON.stringify(entry.grounding)}`);
	}
	checks.push(["preSearch injected a web recap before the model", preSearchResults.every((entry) => entry.recapInjected)]);
	checks.push(["preSearch recorded web usage", preSearchResults.every((entry) => entry.usedWeb)]);
	checks.push(["queries are trimmed and focused", preSearchResults.every((entry) => entry.webQuery === entry.webQuery.trim())]);
	if (DRY_RUN) {
		checks.push(["grounding covered the fake sources", preSearchResults.every((entry) => entry.grounding.ok === true)]);
		checks.push(["fake results reported an injection", preSearchResults.every((entry) => entry.injectedChars > 0)]);
	}

	console.log("");
	console.log("--- Model-driven web_search tool ---");
	const toolResults = [];
	for (const { query } of SEARCH_QUERIES) {
		if (DRY_RUN) break; // a fake adapter cannot emit tool calls
		const entry = await runWebTool(query, provider);
		toolResults.push(entry);
		console.log(`  query="${query}" success=${entry.success} web=${entry.usedWeb} `
			+ `results=${entry.webResults.length} tools=${entry.toolExecutions.length}`);
	}

	console.log("");
	console.log("================================================");
	console.log("SUMMARY");
	console.log("================================================");
	console.log("");
	console.log("| Path | Query | Time (ms) | Web used | Results |");
	console.log("| --- | --- | --- | --- | --- |");
	for (const entry of preSearchResults) {
		console.log(`| preSearch | ${entry.query} | ${entry.durationMs.toFixed(0)} | ${entry.usedWeb ? "yes" : "no"} | ${entry.webResults.length} |`);
	}
	for (const entry of toolResults) {
		console.log(`| tool | ${entry.query} | ${entry.durationMs.toFixed(0)} | ${entry.usedWeb ? "yes" : "no"} | ${entry.webResults.length} |`);
	}

	console.log("");
	for (const [name, ok] of checks) {
		console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
		if (!ok) process.exitCode = 1;
	}
	console.log(`Checks: ${checks.filter(([, ok]) => ok).length}/${checks.length}`);
	console.log("================================================");
	console.log("END OF E2E-07");
	console.log("================================================");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
