/**
 * Test runner.
 *
 * Every suite runs in its own process with its own timeout: a suite that hangs
 * must not take the whole packet down, and the summary must say which one
 * failed instead of dying on the first non-zero exit.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUITE_TIMEOUT_MS = Number(process.env.TEST_SUITE_TIMEOUT_MS) || 120000;
const SUITE_KILL_GRACE_MS = 5000;

const suites = fs
	.readdirSync(__dirname)
	.filter((name) => name.endsWith("_test.js") || name.endsWith("_test.mjs"))
	.sort();

const runSuite = (name) => new Promise((resolve) => {
	const file = path.join(__dirname, name);
	const started = Date.now();
	const child = spawn(process.execPath, [file], { stdio: "inherit" });
	let timedOut = false;

	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
		setTimeout(() => child.kill("SIGKILL"), SUITE_KILL_GRACE_MS).unref();
	}, SUITE_TIMEOUT_MS);

	child.on("exit", (code) => {
		clearTimeout(timer);
		resolve({ name, ok: code === 0 && !timedOut, code, timedOut, ms: Date.now() - started });
	});
	child.on("error", () => {
		clearTimeout(timer);
		resolve({ name, ok: false, code: 127, timedOut: false, ms: Date.now() - started });
	});
});

const main = async () => {
	console.log(`=== @rdsslab/agentkit :: ${suites.length} suite(s) ===`);
	const results = [];
	for (const name of suites) {
		console.log(`\n--- ${name} ---`);
		results.push(await runSuite(name));
	}

	console.log("\n=== summary ===");
	let failed = 0;
	for (const result of results) {
		if (!result.ok) {
			failed += 1;
		}
		const status = result.ok ? "PASS" : "FAIL";
		const extra = result.timedOut ? " (timeout)" : "";
		console.log(`${status}  ${result.name}  ${result.ms}ms${extra}`);
	}

	if (failed > 0) {
		console.error(`\n${failed} suite(s) failed.`);
		process.exit(1);
	}
	console.log("\nAll suites passed.");
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
