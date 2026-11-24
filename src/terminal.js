/**
 * Terminal tool: `run_command`.
 *
 * The mechanics were already there (`runProcess`: spawn with `shell:false`, an
 * argument array, a timeout and an output cap). What was missing was the
 * *policy*, and that is what this module is:
 *
 *   - **No shell, ever.** The model sends a binary and an argument array; there
 *     is no string interpolation into a shell, so `;`, `|`, `&&` or backticks
 *     are literal arguments, not syntax.
 *   - **Allowlist of binaries.** Empty by default: the tool is inert until the
 *     host says which binaries may run. A name in the allowlist means "this
 *     binary name", an absolute path means "exactly this file".
 *   - **The environment does not leak.** The child gets a minimal environment
 *     (restricted PATH, HOME, locale) plus what the host passes explicitly. The
 *     API keys of the host process never reach the command.
 *   - **Approval hook.** The host can require a human decision per command.
 *   - **Secret scrubbing.** Tokens that show up in the output are redacted.
 *   - **Audit hook.** Every execution can be reported to the host.
 *
 * The tool is inert unless configured: `createTerminalTool()` without an
 * allowlist refuses every command.
 */

import fs from "node:fs";
import path from "node:path";

import { runProcess } from "./media.js";

/** Name of the tool exposed to models. @type {string} */
export const TERMINAL_TOOL_NAME = "run_command";

/** Restricted PATH used for child processes. @type {string} */
export const DEFAULT_SEARCH_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** Default per-command timeout. @type {number} */
export const DEFAULT_TIMEOUT_MS = 30000;

/** Default cap on captured stdout/stderr. @type {number} */
export const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

/** Default number of commands allowed per turn. @type {number} */
export const DEFAULT_MAX_CALLS_PER_TURN = 10;

/** JSON Schema of the `run_command` tool arguments. @type {object} */
export const TERMINAL_TOOL_PARAMETERS = {
	type: "object",
	properties: {
		command: {
			type: "string",
			description: "Binary to run, without arguments (for example: uname, ip, curl, df). Prefer no spaces; a full command line may be normalised to {command,args} without using a shell.",
		},
		args: {
			type: "array",
			items: { type: "string" },
			description: "Arguments for the binary, one per array element. Examples: uname -> [\"-a\"] or [\"-r\"], ip -> [\"-4\",\"addr\",\"show\"] or [\"route\",\"get\",\"1.1.1.1\"], hostname -> [\"-I\"], df -> [\"-h\"], curl -> [\"-sS\",\"-m\",\"8\",\"-i\",\"http://host:port\"].",
		},
	},
	required: ["command"],
};

/**
 * Best-effort split of a simple command line into [binary, ...args].
 * No shell execution: only tokenization (whitespace + basic single/double quotes).
 * Used to recover from common model tool-call mistakes.
 *
 * @param {string} input
 * @returns {string[]} Tokens; empty when the input is blank.
 */
export const splitCommandLine = (input) => {
	const text = String(input ?? "").trim();
	if (!text) return [];
	const tokens = [];
	let current = "";
	let quote = null;

	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];

		if (quote) {
			if (ch === quote) {
				quote = null;
				continue;
			}
			if (ch === "\\" && quote === '"' && i + 1 < text.length) {
				current += text[i + 1];
				i += 1;
				continue;
			}
			current += ch;
			continue;
		}

		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		if (ch === "\\" && i + 1 < text.length) {
			current += text[i + 1];
			i += 1;
			continue;
		}
		current += ch;
	}

	if (quote) {
		// Unterminated quote: fallback to simple whitespace split to avoid dropping input.
		return text.split(/\s+/).filter(Boolean);
	}
	if (current) tokens.push(current);
	return tokens;
};

/**
 * Accepts either `{command, args}` or a full command line in `command`.
 *
 * @param {object} [options]
 * @param {string} [options.command]
 * @param {string[]} [options.args]
 * @returns {{command: string, args: string[], normalizedFrom: string|null}}
 */
export const normalizeRunCommandArgs = ({ command, args } = {}) => {
	const rawCommand = String(command ?? "").trim();
	const rawArgs = Array.isArray(args) ? args.map((v) => String(v)) : null;
	const hasArgs = Array.isArray(rawArgs) && rawArgs.length > 0;

	if (rawCommand && /\s/.test(rawCommand) && !hasArgs) {
		const parts = splitCommandLine(rawCommand);
		if (parts.length > 0) {
			return {
				command: parts[0],
				args: parts.slice(1),
				normalizedFrom: rawCommand,
			};
		}
	}

	return {
		command: rawCommand,
		args: rawArgs ?? [],
		normalizedFrom: null,
	};
};

const SECRET_PATTERNS = [
	// OpenAI / Anthropic
	{ pattern: /\bsk-ant-[A-Za-z0-9_-]{12,}/g, label: "anthropic-key" },
	{ pattern: /\bsk-[A-Za-z0-9_-]{12,}/g, label: "openai-key" },
	// GitHub
	{ pattern: /\bgithub_pat_[A-Za-z0-9_]{16,}/g, label: "github-token" },
	{ pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, label: "github-token" },
	// AWS
	{ pattern: /\bAKIA[0-9A-Z]{16}\b/g, label: "aws-key" },
	// Generic
	{ pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, label: "bearer-token" },
	{ pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, label: "jwt" },
	{ pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: "private-key" },
	{
		pattern: /\b([A-Z][A-Z0-9_]{2,}(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS))\s*[=:]\s*\S+/g,
		label: "assigned-secret",
	},
];

/**
 * Redacts the secrets that show up in a command output.
 *
 * @param {string} text
 * @param {object} [options] `{ extraSecrets: string[] }` literals to redact
 * @returns {string}
 */
export const scrubSecrets = (text, { extraSecrets = [] } = {}) => {
	let output = String(text ?? "");

	for (const { pattern } of SECRET_PATTERNS) {
		output = output.replace(pattern, "[REDACTED]");
	}

	for (const secret of extraSecrets) {
		const literal = String(secret ?? "");
		if (literal.length < 4) {
			continue;
		}
		output = output.split(literal).join("[REDACTED]");
	}

	return output;
};

/**
 * Resolves the binary to execute.
 *
 * @param {string} command binary name or absolute path
 * @param {object} options `{ allowedBinaries, searchPath }`
 * @returns {{path: string}|{error: string, code: string}}
 */
export const resolveBinary = (command, { allowedBinaries = [], searchPath = DEFAULT_SEARCH_PATH } = {}) => {
	const name = String(command || "").trim();
	const allow = new Set(allowedBinaries.map((entry) => String(entry)));

	if (!name) {
		return { error: "No binary was provided to run.", code: "COMMAND_NOT_ALLOWED" };
	}
	if (allow.size === 0) {
		return {
			error: "This server does not allow running commands: the allowed-binaries list is empty.",
			code: "COMMAND_NOT_ALLOWED",
		};
	}
	if (/\s/.test(name)) {
		return {
			error: "Pass the binary in `command` and the arguments in `args` (not a full command line).",
			code: "COMMAND_NOT_ALLOWED",
		};
	}

	const isExecutable = (candidate) => {
		try {
			const stats = fs.statSync(candidate);
			if (!stats.isFile()) {
				return false;
			}
			fs.accessSync(candidate, fs.constants.X_OK);
			return true;
		} catch {
			return false;
		}
	};

	// A path in the command is only accepted when the allowlist names that exact
	// file: "git" may run, "/tmp/evil" may not.
	if (name.includes("/")) {
		const resolved = path.resolve(name);
		if (!allow.has(name) && !allow.has(resolved)) {
			return { error: `The binary ${name} is not allowed.`, code: "COMMAND_NOT_ALLOWED" };
		}
		if (!isExecutable(resolved)) {
			return { error: `The binary ${name} does not exist or is not executable.`, code: "COMMAND_NOT_EXECUTABLE" };
		}
		return { path: resolved };
	}

	for (const directory of String(searchPath).split(":").filter(Boolean)) {
		const candidate = path.join(directory, name);
		if (!isExecutable(candidate)) {
			continue;
		}
		if (allow.has(name) || allow.has(candidate)) {
			return { path: candidate };
		}
		return {
			error: `The binary ${name} is not allowed (resolved to ${candidate}).`,
			code: "COMMAND_NOT_ALLOWED",
		};
	}

	return { error: `The binary ${name} was not found.`, code: "COMMAND_NOT_EXECUTABLE" };
};

/**
 * Builds the environment of the child process.
 *
 * The parent environment is NOT inherited: only the listed names are copied and
 * the PATH is the restricted one, so the credentials of the host (API keys,
 * tokens) never reach the command.
 *
 * @param {object} options `{ env, inheritEnv, searchPath, baseEnv }`
 * @returns {Record<string, string>}
 */
export const buildChildEnv = ({
	env = {},
	inheritEnv = ["HOME", "LANG", "LC_ALL", "TZ"],
	searchPath = DEFAULT_SEARCH_PATH,
	baseEnv = process.env,
} = {}) => {
	const childEnv = { PATH: searchPath };

	for (const name of inheritEnv) {
		const value = baseEnv?.[name];
		if (typeof value === "string" && value !== "") {
			childEnv[name] = value;
		}
	}

	for (const [key, value] of Object.entries(env || {})) {
		if (value == null) {
			continue;
		}
		childEnv[String(key)] = String(value);
	}

	return childEnv;
};

/**
 * True when `target` is inside `root` (symlinks resolved when possible).
 *
 * @param {string} target
 * @param {string|null} root Empty root means "unrestricted".
 * @returns {boolean}
 */
export const isInsideRoot = (target, root) => {
	if (!root) {
		return true;
	}
	const real = (value) => {
		try {
			return fs.realpathSync(path.resolve(value));
		} catch {
			return path.resolve(value);
		}
	};
	const resolvedTarget = real(target);
	const resolvedRoot = real(root);
	return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
};

/**
 * Builds the `run_command` tool.
 *
 * @param {object} [options]
 * @param {string[]} [options.allowedBinaries] binaries the model may run (default: none)
 * @param {string} [options.cwd] working directory
 * @param {string[]} [options.allowedRoots] directories the command may run in
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxOutputBytes]
 * @param {number} [options.maxCallsPerTurn]
 * @param {string} [options.searchPath]
 * @param {Record<string, string>} [options.env] extra environment for the child
 * @param {string[]} [options.inheritEnv] names copied from `process.env`
 * @param {string[]} [options.redact] literal secrets to remove from the output
 * @param {(request: object) => boolean|Promise<boolean>} [options.approve] approval hook
 * @param {(request: object) => boolean|Promise<boolean>} [options.validateArgs] argument validation hook
 * @param {(entry: object) => void} [options.onAudit] audit hook
 * @returns {{name: string, description: string, parameters: object, handler: Function,
 *   resetCalls: () => void}}
 */
export const createTerminalTool = (options = {}) => {
	const {
		allowedBinaries = [],
		cwd = process.cwd(),
		allowedRoots = [],
		timeoutMs = DEFAULT_TIMEOUT_MS,
		maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
		maxCallsPerTurn = DEFAULT_MAX_CALLS_PER_TURN,
		searchPath = DEFAULT_SEARCH_PATH,
		env = {},
		inheritEnv,
		redact = [],
		approve,
		validateArgs,
		onAudit,
	} = options;

	const allowed = allowedBinaries.map((entry) => String(entry));
	let calls = 0;

	const description = allowed.length > 0
		? `Run a command in the terminal (no shell). Allowed binaries: ${allowed.join(", ")}. `
			+ "Pass the binary in `command` and the arguments in `args` as an array of strings (not a full command line). "
			+ "Examples: {\"command\":\"uname\",\"args\":[\"-a\"]}, {\"command\":\"hostname\",\"args\":[\"-I\"]}, {\"command\":\"ip\",\"args\":[\"route\",\"get\",\"1.1.1.1\"]}, {\"command\":\"df\",\"args\":[\"-h\"]}, {\"command\":\"curl\",\"args\":[\"-sS\",\"-m\",\"8\",\"-i\",\"http://host:port\"]}. "
			+ "Pipes, redirects, &&, ; and shell expansions are not allowed."
		: "Run a command in the terminal (this server has no allowed binaries).";

	const audit = (entry) => {
		if (typeof onAudit !== "function") {
			return;
		}
		try {
			onAudit(entry);
		} catch {
			// an audit hook must never break the command
		}
	};

	const resetCalls = () => {
		calls = 0;
	};

	return {
		name: TERMINAL_TOOL_NAME,
		description,
		parameters: TERMINAL_TOOL_PARAMETERS,
		resetCalls,
		handler: async (args = {}) => {
			const normalized = normalizeRunCommandArgs(args);
			const command = normalized.command;
			const argv = Array.isArray(normalized.args)
				? normalized.args.map((value) => String(value))
				: [];

			if (calls >= maxCallsPerTurn) {
				return {
					ok: false,
					error: `Se alcanzo el limite de ${maxCallsPerTurn} comandos por turno.`,
					code: "TOO_MANY_COMMANDS",
				};
			}

			const resolved = resolveBinary(command, { allowedBinaries: allowed, searchPath });
			if (resolved.error) {
				audit({
					command,
					args: argv,
					cwd,
					allowed: false,
					reason: resolved.code,
					normalizedFrom: normalized.normalizedFrom,
					at: new Date().toISOString(),
				});
				const out = { ok: false, error: resolved.error, code: resolved.code, allowedBinaries: allowed };
				if (normalized.normalizedFrom) {
					out.normalized = { command, args: argv, from: normalized.normalizedFrom };
				}
				return out;
			}

			const workingDirectory = path.resolve(cwd);
			const outside = (Array.isArray(allowedRoots) ? allowedRoots : [])
				.filter(Boolean)
				.some((root) => !isInsideRoot(workingDirectory, root));
			if (outside) {
				audit({
					command,
					args: argv,
					cwd: workingDirectory,
					allowed: false,
					reason: "CWD_NOT_ALLOWED",
					normalizedFrom: normalized.normalizedFrom,
					at: new Date().toISOString(),
				});
				return {
					ok: false,
					error: "The working directory is not within the allowed paths.",
					code: "CWD_NOT_ALLOWED",
				};
			}

			if (typeof validateArgs === "function") {
				const verdict = await validateArgs({ command, args: argv, cwd: workingDirectory, binary: resolved.path });
				if (verdict === false) {
					audit({
						command,
						args: argv,
						cwd: workingDirectory,
						allowed: false,
						reason: "ARGS_NOT_ALLOWED",
						normalizedFrom: normalized.normalizedFrom,
						at: new Date().toISOString(),
					});
					return { ok: false, error: "The arguments of that command are not allowed.", code: "ARGS_NOT_ALLOWED" };
				}
			}

			if (typeof approve === "function") {
				const approved = await approve({
					command,
					args: argv,
					cwd: workingDirectory,
					binary: resolved.path,
					normalizedFrom: normalized.normalizedFrom,
				});
				if (!approved) {
					audit({
						command,
						args: argv,
						cwd: workingDirectory,
						allowed: false,
						reason: "NOT_APPROVED",
						normalizedFrom: normalized.normalizedFrom,
						at: new Date().toISOString(),
					});
					return {
						ok: false,
						error: "The command was not approved.",
						code: "COMMAND_NOT_APPROVED",
					};
				}
			}

			calls += 1;
			const startedAt = Date.now();
			const childEnv = buildChildEnv({ env, inheritEnv, searchPath });

			let result;
			try {
				result = await runProcess(resolved.path, argv, {
					cwd: workingDirectory,
					timeoutMs,
					maxStdoutBytes: maxOutputBytes,
					env: childEnv,
				});
			} catch (error) {
				const entry = {
					command,
					args: argv,
					cwd: workingDirectory,
					binary: resolved.path,
					allowed: true,
					ok: false,
					error: error?.message || String(error),
					durationMs: Date.now() - startedAt,
					normalizedFrom: normalized.normalizedFrom,
					at: new Date().toISOString(),
				};
				audit(entry);
				const out = { ok: false, error: entry.error, code: "COMMAND_FAILED" };
				if (normalized.normalizedFrom) out.normalized = { command, args: argv, from: normalized.normalizedFrom };
				return out;
			}

			const stdoutBuffer = result.stdout || Buffer.alloc(0);
			const truncated = stdoutBuffer.length >= maxOutputBytes;
			const stdout = scrubSecrets(stdoutBuffer.toString("utf8"), { extraSecrets: redact });
			const stderr = scrubSecrets(result.stderr || "", { extraSecrets: redact });

			const entry = {
				command,
				args: argv,
				cwd: workingDirectory,
				binary: resolved.path,
				allowed: true,
				ok: Boolean(result.ok),
				exitCode: result.code,
				timedOut: Boolean(result.timedOut),
				durationMs: Date.now() - startedAt,
				normalizedFrom: normalized.normalizedFrom,
				at: new Date().toISOString(),
			};
			audit(entry);

			const response = {
				ok: Boolean(result.ok),
				exitCode: result.code,
				timedOut: Boolean(result.timedOut),
				truncated,
				stdout: truncated ? stdout + "\n...[salida truncada]" : stdout,
				stderr,
				durationMs: entry.durationMs,
			};
			if (normalized.normalizedFrom) {
				response.normalized = { command, args: argv, from: normalized.normalizedFrom };
			}

			if (!response.ok) {
				const stderrText = String(stderr || "");
				const cmdName = path.basename(resolved.path);
				if (cmdName === "uname" && /extra operand|invalid option|uso:|usage:/i.test(stderrText)) {
					response.hint = "Use valid uname flags, for example args [\"-a\"] (all), [\"-r\"] (kernel release) or [\"-srm\"]. Do not pass words like 'release' as a positional argument.";
				} else if (cmdName === "ip" && /either "dev" is duplicate|command ".+" is unknown|unknown/i.test(stderrText)) {
					response.hint = "Check the ip arguments. Examples: [\"-4\",\"addr\",\"show\"], [\"route\",\"get\",\"1.1.1.1\"].";
				} else if (cmdName === "curl" && /option .*: is unknown|unrecognized option/i.test(stderrText)) {
					response.hint = "Check the curl flags. Example: [\"-sS\",\"-m\",\"8\",\"-i\",\"http://host:port\"].";
				} else if (response.timedOut) {
					response.hint = "The command timed out. Reduce the work, use a shorter curl timeout (-m), or check connectivity.";
				}
			}

			return response;
		},
	};
};
