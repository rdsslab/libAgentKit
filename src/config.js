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

export const PROJECT_CONFIG_CANONICAL = path.join("agentkit", "config.json");
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

export const getGlobalConfigPath = (options = {}) => path.join(getGlobalConfigDir(options), "config.json");

export const ensureDir = (dirPath) => {
	fs.mkdirSync(dirPath, { recursive: true });
	return dirPath;
};

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

export const readJsonFileIfExists = (filePath) => {
	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) return null;
	return readJsonFile(resolved);
};

export const writeJsonFile = (filePath, data) => {
	const resolved = path.resolve(filePath);
	ensureDir(path.dirname(resolved));
	fs.writeFileSync(resolved, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	return resolved;
};

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
});

export const loadGlobalConfig = (options = {}) => {
	const configPath = getGlobalConfigPath(options);
	const loaded = readJsonFileIfExists(configPath);
	if (!loaded) {
		return { path: configPath, exists: false, config: defaultConfig() };
	}
	return { path: loaded.path, exists: true, config: deepMerge(defaultConfig(), loaded.config) };
};

export const loadProjectConfig = ({ cwd = process.cwd() } = {}) => {
	const configPath = findProjectConfigPath({ cwd });
	if (!configPath) return { path: null, exists: false, config: {} };
	const loaded = readJsonFile(configPath);
	return { path: loaded.path, exists: true, config: loaded.config };
};

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

export const saveGlobalConfig = (config, options = {}) => {
	const configPath = getGlobalConfigPath(options);
	const base = defaultConfig();
	const merged = deepMerge(base, isPlainObject(config) ? config : {});
	writeJsonFile(configPath, merged);
	return { path: configPath, config: merged };
};

export const saveProjectConfig = (config, { cwd = process.cwd(), canonical = true } = {}) => {
	const existing = findProjectConfigPath({ cwd });
	const configPath = existing || path.join(path.resolve(cwd), canonical ? PROJECT_CONFIG_CANONICAL : PROJECT_CONFIG_LEGACY[0]);
	const merged = isPlainObject(config) ? config : {};
	writeJsonFile(configPath, merged);
	return { path: configPath, config: merged };
};
