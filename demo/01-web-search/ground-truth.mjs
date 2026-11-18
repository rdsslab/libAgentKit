import path from "node:path";
import { fileURLToPath } from "node:url";
import { webSearch } from "../../src/websearch.js";
import { writeJson, nowStamp } from "../_lib/common.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const startedAt = Date.now();
let result;
try {
	result = await webSearch({ query: "capital de Ecuador", maxResults: 5, timeoutMs: 20000 });
} catch (error) {
	result = { ok: false, error: error?.message || String(error) };
}
const out = {
	test: "01-web-search-ground-truth",
	timestamp: new Date().toISOString(),
	durationMs: Date.now() - startedAt,
	query: "capital de Ecuador",
	expected: { answerContains: ["Quito"], country: "Ecuador" },
	result,
};
const file = path.join(dir, "results", `ground-truth.json`);
await writeJson(file, out);
console.log(JSON.stringify(out, null, 2));
console.log(`\nSaved: ${file}`);
