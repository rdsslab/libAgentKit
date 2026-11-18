import path from "node:path";
import { fileURLToPath } from "node:url";
import { webSearch } from "../../src/websearch.js";
import { writeJson } from "../_lib/common.mjs";
import { getEnvironmentInfo } from "../_lib/env.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const startedAt = Date.now();
let result;
try {
	result = await webSearch({ query: "who was Jesus of Nazareth historical summary key teachings", maxResults: 5, timeoutMs: 20000 });
} catch (error) {
	result = { ok: false, error: error?.message || String(error) };
}
const out = {
	test: "07-jesus-landing-page-ground-truth",
	timestamp: new Date().toISOString(),
	environment: await getEnvironmentInfo(),
	durationMs: Date.now() - startedAt,
	query: "who was Jesus of Nazareth historical summary key teachings",
	expected: { keyPoints: ["Nazareth", "1st century Judea", "teachings/parables", "crucifixion", "Christianity"], note: "Summary should be factual and cite sources." },
	result,
};
const file = path.join(dir, "results", "ground-truth.json");
await writeJson(file, out);
console.log(JSON.stringify(out, null, 2));
console.log(`\nSaved: ${file}`);
