import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeJson } from "../_lib/common.mjs";

const execFileAsync = promisify(execFile);
const dir = path.dirname(fileURLToPath(import.meta.url));
const url = "http://192.168.100.126:3000";

const startedAt = Date.now();
let cmdResult;
try {
	const { stdout, stderr } = await execFileAsync("curl", ["-sS", "-m", "8", "-i", url], { timeout: 15000, maxBuffer: 512 * 1024 });
	cmdResult = { ok: true, stdout, stderr };
} catch (error) {
	cmdResult = { ok: false, error: error?.message || String(error), stdout: error?.stdout, stderr: error?.stderr, code: error?.code };
}
const stdout = String(cmdResult.stdout || "");
const statusMatch = stdout.match(/HTTP\/[\d.]+\s+(\d{3})/);
const ctMatch = stdout.match(/content-type:\s*([^\r\n]+)/i);
const titleMatch = stdout.match(/<title>([^<]+)<\/title>/i);
const out = {
	test: "03-curl-local-ground-truth",
	timestamp: new Date().toISOString(),
	url,
	durationMs: Date.now() - startedAt,
	command: ["curl", "-sS", "-m", "8", "-i", url],
	result: cmdResult,
	parsed: {
		statusCode: statusMatch ? Number(statusMatch[1]) : null,
		contentType: ctMatch ? ctMatch[1].trim() : null,
		title: titleMatch ? titleMatch[1].trim() : null,
		containsOpenFusion: /OpenFusion/i.test(stdout),
	},
};
const file = path.join(dir, "results", "ground-truth.json");
await writeJson(file, out);
console.log(JSON.stringify({ ...out, result: { ...out.result, stdout: stdout.slice(0, 1200) + (stdout.length > 1200 ? "\n...[truncated]" : "") } }, null, 2));
console.log(`\nSaved: ${file}`);
