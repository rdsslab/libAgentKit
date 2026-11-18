import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeJson } from "../_lib/common.mjs";

const execFileAsync = promisify(execFile);
const dir = path.dirname(fileURLToPath(import.meta.url));

const runCmd = async (cmd, args) => {
	const startedAt = Date.now();
	try {
		const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 10000, maxBuffer: 256 * 1024 });
		return { ok: true, cmd, args, durationMs: Date.now() - startedAt, stdout, stderr };
	} catch (error) {
		return { ok: false, cmd, args, durationMs: Date.now() - startedAt, error: error?.message || String(error), stdout: error?.stdout, stderr: error?.stderr, code: error?.code };
	}
};

const results = {};
results.hostname_I = await runCmd("hostname", ["-I"]);
results.ip_route = await runCmd("ip", ["route", "get", "1.1.1.1"]);
results.ip_addr = await runCmd("ip", ["-4", "addr", "show"]);

const ips = String(results.hostname_I.stdout || "").trim().split(/\s+/).filter(Boolean);
const routeMatch = String(results.ip_route.stdout || "").match(/src\s+(\S+)/);
const primaryIp = routeMatch ? routeMatch[1] : (ips.find((ip) => ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172.")) || ips[0] || null);

const out = {
	test: "02-get-ip-ground-truth",
	timestamp: new Date().toISOString(),
	primaryIp,
	allIps: ips,
	commands: results,
};
const file = path.join(dir, "results", "ground-truth.json");
await writeJson(file, out);
console.log(JSON.stringify(out, null, 2));
console.log(`\nSaved: ${file}`);
