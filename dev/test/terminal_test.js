/**
 * Terminal suite (hermetic).
 *
 * The terminal tool is the part of this package that can do real damage, so
 * the suite checks the *guards*, not just the happy path:
 *
 *   - an empty allowlist refuses every command
 *   - a binary outside the allowlist is refused
 *   - there is no shell: metacharacters are literal arguments
 *   - the child does not inherit the secrets of the host environment
 *   - the timeout kills the process
 *   - the output is capped and the secrets in it are redacted
 *   - the approval hook can veto a command
 *   - the audit hook sees every decision
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	buildChildEnv,
	createTerminalTool,
	isInsideRoot,
	resolveBinary,
	scrubSecrets,
} from "../../src/index.js";

const checks = {};
const check = async (name, fn) => {
	await fn();
	checks[name] = true;
};

const NODE = process.execPath;

const main = async () => {
	await check("inert without allowlist", async () => {
		const tool = createTerminalTool();
		const result = await tool.handler({ command: "echo", args: ["hola"] });
		assert.equal(result.ok, false);
		assert.equal(result.code, "COMMAND_NOT_ALLOWED");
	});

	await check("binary outside the allowlist is refused", async () => {
		const tool = createTerminalTool({ allowedBinaries: ["echo"] });
		const result = await tool.handler({ command: "cat", args: ["/etc/passwd"] });
		assert.equal(result.ok, false);
		assert.equal(result.code, "COMMAND_NOT_ALLOWED");
	});

	await check("allowlisted binary runs", async () => {
		const tool = createTerminalTool({ allowedBinaries: [NODE] });
		const result = await tool.handler({ command: NODE, args: ["-e", "console.log('hola kit')"] });
		assert.equal(result.ok, true);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /hola kit/);
	});

	await check("absolute path must be named exactly", async () => {
		const tool = createTerminalTool({ allowedBinaries: [NODE] });
		const result = await tool.handler({ command: "/bin/sh", args: ["-c", "echo pwned"] });
		assert.equal(result.ok, false);
		assert.equal(result.code, "COMMAND_NOT_ALLOWED");

		const exact = createTerminalTool({ allowedBinaries: [NODE] });
		const ok = await exact.handler({ command: NODE, args: ["-e", "console.log(1)"] });
		assert.equal(ok.ok, true);
	});

	await check("there is no shell", async () => {
		const tool = createTerminalTool({ allowedBinaries: [NODE] });
		const result = await tool.handler({
			command: NODE,
			args: ["-e", "console.log(process.argv.slice(1).join('|'))", "; rm -rf /", "| cat"],
		});
		assert.equal(result.ok, true);
		// the metacharacters arrived as literal arguments
		assert.match(result.stdout, /; rm -rf \//);
		assert.match(result.stdout, /\| cat/);
	});

	await check("a full command line is normalized and executed safely (no shell)", async () => {
		const tool = createTerminalTool({ allowedBinaries: [NODE] });
		const result = await tool.handler({ command: `${NODE} -e "console.log('hola-normalizado')"`, args: [] });
		assert.equal(result.ok, true);
		assert.equal(result.normalized?.command, NODE);
		assert.deepEqual(result.normalized?.args, ["-e", "console.log('hola-normalizado')"]);
		assert.match(result.stdout, /hola-normalizado/);
	});

	await check("a full command line with disallowed binary is still refused", async () => {
		const tool = createTerminalTool({ allowedBinaries: [NODE] });
		const result = await tool.handler({ command: "echo hola" });
		assert.equal(result.ok, false);
		assert.equal(result.code, "COMMAND_NOT_ALLOWED");
	});

	await check("the host secrets do not reach the child", async () => {
		process.env.AGENTKIT_TEST_SECRET = "sk-verysecretvalue123456";
		try {
			const tool = createTerminalTool({ allowedBinaries: [NODE] });
			const result = await tool.handler({
				command: NODE,
				args: ["-e", "console.log(process.env.AGENTKIT_TEST_SECRET || 'undefined')"],
			});
			assert.equal(result.ok, true);
			assert.match(result.stdout, /undefined/);
			assert.ok(!result.stdout.includes("sk-verysecretvalue123456"));
		} finally {
			delete process.env.AGENTKIT_TEST_SECRET;
		}
	});

	await check("the child environment is explicit", () => {
		const env = buildChildEnv({ env: { MI_VAR: "1" } });
		assert.equal(env.MI_VAR, "1");
		assert.ok(env.PATH);
		assert.equal(env.AGENTKIT_TEST_SECRET, undefined);
	});

	await check("the timeout kills the process", async () => {
		const tool = createTerminalTool({ allowedBinaries: [NODE], timeoutMs: 300 });
		const result = await tool.handler({ command: NODE, args: ["-e", "setTimeout(() => {}, 10000)"] });
		assert.equal(result.ok, false);
		assert.equal(result.timedOut, true);
	});

	await check("the output is capped", async () => {
		const tool = createTerminalTool({ allowedBinaries: [NODE], maxOutputBytes: 1024 });
		const result = await tool.handler({
			command: NODE,
			args: ["-e", "console.log('x'.repeat(20000))"],
		});
		assert.equal(result.truncated, true);
		assert.ok(result.stdout.length < 4000);
		assert.match(result.stdout, /salida truncada/);
	});

	await check("secrets in the output are redacted", async () => {
		const tool = createTerminalTool({ allowedBinaries: [NODE] });
		const result = await tool.handler({
			command: NODE,
			args: ["-e", "console.log('key=sk-abcdefghijklmnopqrstuvwxyz012345')"],
		});
		assert.ok(!result.stdout.includes("sk-abcdefghijklmnopqrstuvwxyz012345"));
		assert.match(result.stdout, /\[REDACTED\]/);
	});

	await check("scrubSecrets covers the usual shapes", () => {
		assert.match(scrubSecrets("ghp_abcdefghijklmnopqrstuvwxyz012345"), /\[REDACTED\]/);
		assert.match(scrubSecrets("AKIAIOSFODNN7EXAMPLE"), /\[REDACTED\]/);
		assert.match(scrubSecrets("Authorization: Bearer abcdefghijklmnop"), /\[REDACTED\]/);
		assert.match(scrubSecrets("MY_SECRET=whatever"), /\[REDACTED\]/);
		assert.match(scrubSecrets("literal", { extraSecrets: ["literal"] }), /\[REDACTED\]/);
		// short literals are not redacted: they would blank half the output
		assert.equal(scrubSecrets("abc", { extraSecrets: ["abc"] }), "abc");
	});

	await check("the approval hook can veto", async () => {
		const seen = [];
		const tool = createTerminalTool({
			allowedBinaries: [NODE],
			approve: async (request) => {
				seen.push(request);
				return false;
			},
		});
		const result = await tool.handler({ command: NODE, args: ["-e", "console.log(1)"] });
		assert.equal(result.ok, false);
		assert.equal(result.code, "COMMAND_NOT_APPROVED");
		assert.equal(seen.length, 1);
		assert.equal(seen[0].command, NODE);
	});

	await check("the approval hook can allow", async () => {
		const tool = createTerminalTool({
			allowedBinaries: [NODE],
			approve: async () => true,
		});
		const result = await tool.handler({ command: NODE, args: ["-e", "console.log('ok')"] });
		assert.equal(result.ok, true);
	});

	await check("the argument validation hook can veto", async () => {
		const tool = createTerminalTool({
			allowedBinaries: [NODE],
			validateArgs: async ({ args }) => !args.includes("-e"),
		});
		const result = await tool.handler({ command: NODE, args: ["-e", "console.log(1)"] });
		assert.equal(result.ok, false);
		assert.equal(result.code, "ARGS_NOT_ALLOWED");
	});

	await check("the audit hook sees every decision", async () => {
		const entries = [];
		const tool = createTerminalTool({
			allowedBinaries: [NODE],
			onAudit: (entry) => entries.push(entry),
		});
		await tool.handler({ command: "cat", args: [] });
		await tool.handler({ command: NODE, args: ["-e", "console.log(1)"] });
		assert.equal(entries.length, 2);
		assert.equal(entries[0].allowed, false);
		assert.equal(entries[0].reason, "COMMAND_NOT_ALLOWED");
		assert.equal(entries[1].allowed, true);
		assert.equal(entries[1].ok, true);
		assert.equal(typeof entries[1].durationMs, "number");
	});

	await check("the number of commands per turn is capped", async () => {
		const tool = createTerminalTool({ allowedBinaries: [NODE], maxCallsPerTurn: 2 });
		await tool.handler({ command: NODE, args: ["-e", "console.log(1)"] });
		await tool.handler({ command: NODE, args: ["-e", "console.log(2)"] });
		const third = await tool.handler({ command: NODE, args: ["-e", "console.log(3)"] });
		assert.equal(third.ok, false);
		assert.equal(third.code, "TOO_MANY_COMMANDS");
	});

	await check("the working directory is restricted", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentkit-cwd-"));
		try {
			const tool = createTerminalTool({
				allowedBinaries: [NODE],
				cwd: tmpDir,
				allowedRoots: [os.tmpdir()],
			});
			const result = await tool.handler({ command: NODE, args: ["-e", "console.log(process.cwd())"] });
			assert.equal(result.ok, true);
			assert.ok(result.stdout.includes(path.basename(tmpDir)));
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	await check("a cwd outside the roots is refused", async () => {
		const tool = createTerminalTool({
			allowedBinaries: [NODE],
			cwd: "/etc",
			allowedRoots: [os.tmpdir()],
		});
		const result = await tool.handler({ command: NODE, args: ["-e", "console.log(1)"] });
		assert.equal(result.ok, false);
		assert.equal(result.code, "CWD_NOT_ALLOWED");
	});

	await check("isInsideRoot", () => {
		assert.equal(isInsideRoot("/srv/repo/sub", "/srv/repo"), true);
		assert.equal(isInsideRoot("/srv/repo", "/srv/repo"), true);
		assert.equal(isInsideRoot("/srv/repository", "/srv/repo"), false);
		assert.equal(isInsideRoot("/etc/passwd", "/srv/repo"), false);
	});

	await check("resolveBinary reports why it refused", () => {
		const empty = resolveBinary("ls", { allowedBinaries: [] });
		assert.equal(empty.code, "COMMAND_NOT_ALLOWED");

		const missing = resolveBinary("definitely-not-a-binary", { allowedBinaries: ["definitely-not-a-binary"] });
		assert.equal(missing.code, "COMMAND_NOT_EXECUTABLE");
	});

	console.log(JSON.stringify({ ok: true, checks }, null, 2));
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
