import path from "node:path";
import { fileURLToPath } from "node:url";
import { webSearch } from "../../src/websearch.js";
import { writeJson } from "../_lib/common.mjs";
import { getEnvironmentInfo } from "../_lib/env.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const startedAt = Date.now();
let result;
try {
	result = await webSearch({ query: "current president of Ecuador 2026", maxResults: 5, timeoutMs: 20000 });
} catch (error) {
	result = { ok: false, error: error?.message || String(error) };
}
const out = {
	test: "06-current-president-ecuador-ground-truth",
	timestamp: new Date().toISOString(),
	environment: await getEnvironmentInfo(),
	durationMs: Date.now() - startedAt,
	query: "current president of Ecuador 2026",
	expected: { answerContains: ["Daniel Noboa", "Noboa"], note: "As of 2026, Daniel Noboa is President of Ecuador (verify with sources)." },
	result,
};
const file = path.join(dir, "results", "ground-truth.json");
await writeJson(file, out);
console.log(JSON.stringify(out, null, 2));
console.log(`\nSaved: ${file}`);
