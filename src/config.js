/**
 * Configuration loading and persistence for AgentKit.
 *
 * Global config location (cross-platform):
 * - Linux:   $XDG_CONFIG_HOME/agentkit/config.json or ~/.config/agentkit/config.json
 * - macOS:   ~/Library/Application Support/agentkit/config.json
 * - Windows: %APPDATA%\agentkit\config.json
 *
 * Project/session override (canonical): `agentkit/config.json` searched from cwd upward.
 * Legacy project locations are also recognized for compatibility.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/** Canonical project-local config path, relative to the project root. @type {string} */
export const PROJECT_CONFIG_CANONICAL = path.join("agentkit", "config.json");
/** Legacy project-local config paths, still read for compatibility. @type {ReadonlyArray<string>} */
export const PROJECT_CONFIG_LEGACY = Object.freeze([
	"agentkit.config.json",
	path.join(".agentkit", "config.json"),
]);

const deepMerge = (base, override) => {
	if (!isPlainObject(base) || !isPlainObject(override)) {
		return override === undefined ? base : override;
	}
	const out = { ...base };
	for (const [key, value] of Object.entries(override)) {
		if (Array.isArray(value)) {
			out[key] = value.slice();
		} else if (isPlainObject(value) && isPlainObject(out[key])) {
			out[key] = deepMerge(out[key], value);
		} else {
			out[key] = value;
		}
	}
	return out;
};

/**
 * Resolves the OS-specific directory that holds the global config.
 *
 * @param {object} [options]
 * @param {string} [options.platform=process.platform] Platform override for tests.
 * @param {object} [options.env=process.env] Environment override for tests.
 * @param {string} [options.home=os.homedir()] Home override for tests.
 * @returns {string} Absolute directory path.
 */
export const getGlobalConfigDir = ({ platform = process.platform, env = process.env, home = os.homedir() } = {}) => {
	if (platform === "win32") {
		const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
		return path.join(appData, "agentkit");
	}
	if (platform === "darwin") {
		return path.join(home, "Library", "Application Support", "agentkit");
	}
	const xdg = env.XDG_CONFIG_HOME || path.join(home, ".config");
	return path.join(xdg, "agentkit");
};

/**
 * @param {object} [options] Same seams as `getGlobalConfigDir()`.
 * @returns {string} Absolute path of the global `config.json`.
 */
export const getGlobalConfigPath = (options = {}) => path.join(getGlobalConfigDir(options), "config.json");

/**
 * Creates a directory recursively when needed.
 *
 * @param {string} dirPath
 * @returns {string} The resolved directory path.
 */
export const ensureDir = (dirPath) => {
	fs.mkdirSync(dirPath, { recursive: true });
	return dirPath;
};

/**
 * Reads and validates a JSON config file.
 *
 * @param {string} filePath
 * @returns {{path: string, config: object}} Resolved path and parsed object.
 * @throws {Error} When the file cannot be read or is not a JSON object.
 */
export const readJsonFile = (filePath) => {
	const resolved = path.resolve(filePath);
	let raw;
	try {
		raw = fs.readFileSync(resolved, "utf8");
	} catch (error) {
		throw new Error(`Could not read config at ${resolved}: ${error?.message || error}`);
	}
	try {
		const parsed = JSON.parse(raw);
		if (!isPlainObject(parsed)) {
			throw new Error("config must be a JSON object");
		}
		return { path: resolved, config: parsed };
	} catch (error) {
		throw new Error(`Config at ${resolved} is not valid JSON: ${error?.message || error}`);
	}
};

/**
 * @param {string} filePath
 * @returns {{path: string, config: object}|null} Null when the file does not exist.
 */
export const readJsonFileIfExists = (filePath) => {
	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) return null;
	return readJsonFile(resolved);
};

/** File mode used for global config, which may contain secrets. @type {number} */
export const GLOBAL_CONFIG_MODE = 0o600;

/**
 * Writes pretty-printed JSON, creating parent directories as needed.
 *
 * @param {string} filePath
 * @param {object} data
 * @param {object} [options]
 * @param {number} [options.mode] Optional POSIX mode, also applied after writing.
 * @returns {string} Resolved path.
 */
export const writeJsonFile = (filePath, data, { mode } = {}) => {
	const resolved = path.resolve(filePath);
	ensureDir(path.dirname(resolved));
	fs.writeFileSync(resolved, `${JSON.stringify(data, null, 2)}\n`, {
		encoding: "utf8",
		...(Number.isInteger(mode) ? { mode } : {}),
	});
	if (Number.isInteger(mode)) fs.chmodSync(resolved, mode);
	return resolved;
};

/**
 * Resolves `env:VAR` references to their value. A missing variable resolves to
 * `undefined` so the provider layer can report the failure clearly. Everything
 * else is returned untouched, which keeps existing literal tokens working.
 *
 * @param {*} value
 * @param {object} [env=process.env]
 * @returns {*} Resolved value, or undefined when a referenced variable is missing.
 */
export const resolveSecretReference = (value, env = process.env) => {
	if (typeof value !== "string") return value;
	const match = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(value.trim());
	if (!match) return value;
	const resolved = env[match[1]];
	return typeof resolved === "string" && resolved.length > 0 ? resolved : undefined;
};

/**
 * Deep copy of a config with every `env:VAR` secret reference resolved.
 *
 * @param {*} config
 * @param {object} [env=process.env]
 * @returns {*} Deep copy with secrets resolved.
 */
export const resolveConfigSecrets = (config, env = process.env) => {
	if (Array.isArray(config)) return config.map((item) => resolveConfigSecrets(item, env));
	if (!isPlainObject(config)) return resolveSecretReference(config, env);
	const out = {};
	for (const [key, value] of Object.entries(config)) {
		out[key] = resolveConfigSecrets(value, env);
	}
	return out;
};

/**
 * Searches upward from `cwd` for canonical or legacy project config.
 *
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()]
 * @param {string} [options.stopAt] Directory where the upward search stops.
 * @returns {string|null} Absolute config path, or null when none exists.
 */
export const findProjectConfigPath = ({ cwd = process.cwd(), stopAt } = {}) => {
	let current = path.resolve(cwd);
	const root = path.parse(current).root;
	const stop = stopAt ? path.resolve(stopAt) : null;

	while (true) {
		const canonical = path.join(current, PROJECT_CONFIG_CANONICAL);
		if (fs.existsSync(canonical)) return canonical;
		for (const relative of PROJECT_CONFIG_LEGACY) {
			const candidate = path.join(current, relative);
			if (fs.existsSync(candidate)) return candidate;
		}
		if (current === root || (stop && current === stop)) break;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
};

/** @returns {object} Fresh default config with embedded-safe capabilities. */
export const defaultConfig = () => ({
	version: 1,
	language: "en",
	provider: {
		provider: "ollama",
		baseUrl: "http://127.0.0.1:11434",
		model: "",
	},
	providers: {},
	capabilities: {
		terminal: false,
		filesystem: false,
		web: true,
		mcp: true,
		documents: true,
		artifacts: true,
	},
	tui: {
		language: "en",
		compactThresholdPercent: 90,
		autoCompact: false,
	},
	compaction: {
		auto: false,
		thresholdPercent: 90,
		strategy: "summary", // summary | truncate | hybrid
		keepLastMessages: 12,
	},
	mode: "build",
	mcpServers: [],
	terminal: {},
	// Media is optional by design: with no `stt.providers`, audio/video
	// attachments degrade to a visible warning instead of failing the call.
	stt: {
		providers: {},
		defaultProvider: undefined,
		language: undefined,
		timeoutMs: undefined,
	},
	media: {
		maxFrames: 6,
		frameWidth: 640,
		onError: "degrade", // degrade | throw
	},
});

/**
 * Loads global config, merged over `defaultConfig()` when present.
 *
 * @param {object} [options] Same seams as `getGlobalConfigDir()`.
 * @returns {{path: string, exists: boolean, config: object}}
 */
export const loadGlobalConfig = (options = {}) => {
	const configPath = getGlobalConfigPath(options);
	const loaded = readJsonFileIfExists(configPath);
	if (!loaded) {
		return { path: configPath, exists: false, config: defaultConfig() };
	}
	return { path: loaded.path, exists: true, config: deepMerge(defaultConfig(), loaded.config) };
};

/**
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()]
 * @returns {{path: string|null, exists: boolean, config: object}} Empty config when no project file exists.
 */
export const loadProjectConfig = ({ cwd = process.cwd() } = {}) => {
	const configPath = findProjectConfigPath({ cwd });
	if (!configPath) return { path: null, exists: false, config: {} };
	const loaded = readJsonFile(configPath);
	return { path: loaded.path, exists: true, config: loaded.config };
};

/**
 * Merges global and project config and reports where each came from.
 * Project values win; `language` falls back to `tui.language` then `"en"`.
 *
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()]
 * @param {object} [options.globalOptions] Seams for `loadGlobalConfig()`.
 * @returns {{globalPath: string, globalExists: boolean, projectPath: string|null,
 *   projectExists: boolean, global: object, project: object, config: object}}
 */
export const loadEffectiveConfig = ({ cwd = process.cwd(), globalOptions } = {}) => {
	const global = loadGlobalConfig(globalOptions);
	const project = loadProjectConfig({ cwd });
	const effective = deepMerge(global.config, project.config || {});
	// If project sets tui/compaction thresholds etc., keep merge behavior; ensure required minimums.
	if (!isPlainObject(effective.provider)) effective.provider = defaultConfig().provider;
	if (!effective.language) effective.language = effective.tui?.language || "en";
	return {
		globalPath: global.path,
		globalExists: global.exists,
		projectPath: project.path,
		projectExists: project.exists,
		global: global.config,
		project: project.config || {},
		config: effective,
	};
};

/**
 * Merges over the defaults and writes global config with owner-only permissions.
 *
 * @param {object} config
 * @param {object} [options] Same seams as `getGlobalConfigDir()`.
 * @returns {{path: string, config: object}}
 */
export const saveGlobalConfig = (config, options = {}) => {
	const configPath = getGlobalConfigPath(options);
	const base = defaultConfig();
	const merged = deepMerge(base, isPlainObject(config) ? config : {});
	// The global config can hold provider tokens: keep it owner-only, even when
	// the file already existed with looser permissions.
	writeJsonFile(configPath, merged, { mode: GLOBAL_CONFIG_MODE });
	return { path: configPath, config: merged };
};

/**
 * Writes project config to an existing file or to the canonical location.
 *
 * @param {object} config
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()]
 * @param {boolean} [options.canonical=true] Use the canonical path for new files.
 * @returns {{path: string, config: object}}
 */
export const saveProjectConfig = (config, { cwd = process.cwd(), canonical = true } = {}) => {
	const existing = findProjectConfigPath({ cwd });
	const configPath = existing || path.join(path.resolve(cwd), canonical ? PROJECT_CONFIG_CANONICAL : PROJECT_CONFIG_LEGACY[0]);
	const merged = isPlainObject(config) ? config : {};
	writeJsonFile(configPath, merged);
	return { path: configPath, config: merged };
};
