import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demos = [
	"demo/01-web-search/run.mjs",
	"demo/02-get-ip/run.mjs",
	"demo/03-curl-local/run.mjs",
	"demo/04-codegen-landing/run.mjs",
	"demo/05-github-search-save-md/run.mjs",
	"demo/06-current-president-ecuador/run.mjs",
	"demo/07-jesus-landing-page/run.mjs",
];

const model = process.env.AGENTKIT_MODEL || "(default)";
console.log(`Running demos with AGENTKIT_MODEL=${model}`);

const run = (script) => new Promise((resolve) => {
	console.log(`\n>>> Running ${script}`);
	const child = spawn(process.execPath, [script], {
		cwd: ROOT,
		stdio: "inherit",
		env: process.env,
	});
	child.on("close", (code) => resolve({ script, code }));
});

let failures = 0;
for (const script of demos) {
	const { code } = await run(script);
	if (code !== 0) {
		failures += 1;
		console.error(`!!! ${script} exited with code ${code}`);
	}
}

console.log(`\nDemo run complete. Failures: ${failures}/${demos.length}`);
process.exit(failures ? 1 : 0);
