/**
 * Validación sintáctica real de código generado (opcional).
 *
 * Se mantiene FUERA del core del proveedor: el harness puede usarlo para
 * puntuar respuestas, pero ningún proveedor depende de Node o Python.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LANGUAGE_MAP = {
	js: "javascript",
	javascript: "javascript",
	node: "javascript",
	py: "python",
	python: "python",
};

const runCommand = (command, args, { input } = {}) => new Promise((resolve) => {
	let child;
	try {
		child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
	} catch (error) {
		resolve({ code: -1, output: String(error?.message || error) });
		return;
	}

	let output = "";
	child.stdout?.on("data", (chunk) => { output += chunk; });
	child.stderr?.on("data", (chunk) => { output += chunk; });
	child.on("error", (error) => resolve({ code: -1, output: output || String(error?.message || error) }));
	child.on("close", (code) => resolve({ code: code ?? -1, output: output.trim() }));

	if (input != null) child.stdin?.end(String(input));
	else child.stdin?.end();
});

/**
 * Valida la sintaxis de un fragmento de código.
 *
 * @param {string} code
 * @param {string} language "javascript" o "python"
 * @returns {Promise<{supported: boolean, valid: boolean|null, error: string|null, language: string}>}
 */
export async function validateSyntax(code, language) {
	const normalized = LANGUAGE_MAP[String(language || "").toLowerCase()];
	if (!normalized || typeof code !== "string" || code.trim() === "") {
		return {
			supported: false,
			valid: null,
			error: normalized ? "empty code" : `unsupported language: ${language}`,
			language: normalized || String(language || ""),
		};
	}

	if (normalized === "javascript") {
		let dir;
		try {
			dir = await mkdtemp(join(tmpdir(), "agentkit-syntax-"));
			const file = join(dir, "snippet.mjs");
			await writeFile(file, code, "utf8");
			const result = await runCommand(process.execPath, ["--check", file]);
			return {
				supported: true,
				valid: result.code === 0,
				error: result.code === 0 ? null : result.output.slice(0, 2000),
				language: normalized,
			};
		} catch (error) {
			return { supported: true, valid: false, error: String(error?.message || error), language: normalized };
		} finally {
			if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	}

	const result = await runCommand("python3", [
		"-c",
		"import ast,sys\nsrc=sys.stdin.read()\nast.parse(src)\n",
	], { input: code });

	if (result.code === -1 && /ENOENT/.test(result.output)) {
		return { supported: false, valid: null, error: "python3 not available", language: normalized };
	}

	return {
		supported: true,
		valid: result.code === 0,
		error: result.code === 0 ? null : result.output.slice(0, 2000),
		language: normalized,
	};
}

/**
 * Valida todos los bloques devueltos por extractCodeBlocks().
 */
export async function validateCodeBlocks(blocks = []) {
	const results = [];
	for (const block of blocks) {
		const language = block?.language || block?.lang || null;
		const validation = language
			? await validateSyntax(block.code, language)
			: { supported: false, valid: null, error: "unknown language", language: null };
		results.push({ ...block, validation });
	}
	return results;
}

export default { validateSyntax, validateCodeBlocks };
