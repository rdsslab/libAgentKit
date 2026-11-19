/**
 * MCP configuration: servers, transports and trust levels.
 *
 * A remote MCP server is code that runs on someone else's machine (or on the
 * user's, over stdio). A config file is therefore a *trust decision*, and this
 * module makes that decision explicit:
 *
 *   - `trusted` (default): the tools of the server are offered to the model and
 *     called automatically.
 *   - `untrusted`: the tools are offered, but every call needs the host's
 *     approval (`approveToolCall`). Without an approval hook the call is
 *     refused: it fails closed.
 *   - `disabled`: the server is not connected and its tools are not exposed.
 *
 * The config file is read from the user directory by default. A config file
 * inside the project is **not** loaded unless the host opts in, because a
 * repository can carry one and a repository is not a trust boundary.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MCP_TRUST_LEVELS = ["trusted", "untrusted", "disabled"];

export const DEFAULT_TRUST_LEVEL = "trusted";

export const PROJECT_CONFIG_FILES = ["agentkit.config.json", path.join(".agentkit", "config.json")];

export const USER_CONFIG_FILE = path.join(".config", "agentkit", "config.json");

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const expandHome = (value, home = os.homedir()) => {
	const raw = String(value || "");
	return raw.startsWith("~/") ? path.join(home, raw.slice(2)) : raw;
};

/**
 * Normalizes one server entry.
 *
 * @param {object} entry
 * @param {number} [index]
 * @returns {object} `{ name, transport, url, command, args, env, cwd, headers, trust, enabled }`
 */
export const normalizeMcpServer = (entry, index = 0) => {
	const source = isPlainObject(entry) ? entry : {};
	const url = source.url ?? source.serverUrl ?? source.server_url ?? null;
	const command = typeof source.command === "string" && source.command.trim() !== ""
		? source.command.trim()
		: null;
	const transport = command ? "stdio" : "http";
	const trust = MCP_TRUST_LEVELS.includes(source.trust) ? source.trust : DEFAULT_TRUST_LEVEL;

	let name = source.name;
	if (!name) {
		if (url) {
			try {
				name = new URL(url).hostname;
			} catch {
				name = url;
			}
		} else if (command) {
			name = path.basename(command);
		} else {
			name = `server-${index + 1}`;
		}
	}

	return {
		name: String(name),
		transport,
		url: url ? String(url) : null,
		command,
		args: Array.isArray(source.args) ? source.args.map((value) => String(value)) : [],
		env: isPlainObject(source.env) ? { ...source.env } : undefined,
		cwd: source.cwd ? String(source.cwd) : undefined,
		headers: isPlainObject(source.headers) ? { ...source.headers } : undefined,
		trust,
		enabled: source.enabled !== false && trust !== "disabled",
	};
};

/**
 * Normalizes a list of servers (array or `{ name: entry }` map).
 *
 * @param {Array|object} servers
 * @returns {object[]}
 */
export const normalizeMcpServers = (servers) => {
	if (Array.isArray(servers)) {
		return servers.map((entry, index) => normalizeMcpServer(entry, index));
	}
	if (!isPlainObject(servers)) {
		return [];
	}
	return Object.entries(servers).map(([name, entry], index) => normalizeMcpServer(
		isPlainObject(entry) ? { name, ...entry } : { name },
		index,
	));
};

/**
 * Reads a config file.
 *
 * @param {string} configPath
 * @returns {{mcpServers: object[], terminal: object, path: string}}
 */
export const loadMcpConfig = (configPath) => {
	const resolved = path.resolve(expandHome(configPath));
	let raw;

	try {
		raw = fs.readFileSync(resolved, "utf8");
	} catch (error) {
		throw new Error(`Could not read the agent kit config at ${resolved}: ${error?.message || error}`);
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`The agent kit config at ${resolved} is not valid JSON: ${error?.message || error}`);
	}

	if (!isPlainObject(parsed)) {
		throw new Error(`The agent kit config at ${resolved} must contain a JSON object.`);
	}

	return {
		path: resolved,
		mcpServers: normalizeMcpServers(parsed.mcpServers || parsed.servers || []),
		terminal: isPlainObject(parsed.terminal) ? parsed.terminal : {},
	};
};

/**
 * Finds the config file.
 *
 * By default only the user-level config is considered (`~/.config/agentkit/config.json`).
 * A config inside the project has to be opted in explicitly: a repository can
 * carry one, and a repository is not a trust boundary.
 *
 * @param {object} [options] `{ allowProjectConfig, cwd, home }`
 * @returns {string|null} absolute path
 */
export const findMcpConfig = ({
	allowProjectConfig = false,
	cwd = process.cwd(),
	home = os.homedir(),
} = {}) => {
	const userPath = path.join(home, USER_CONFIG_FILE);
	if (fs.existsSync(userPath)) {
		return userPath;
	}

	if (!allowProjectConfig) {
		return null;
	}

	for (const relative of PROJECT_CONFIG_FILES) {
		const candidate = path.resolve(cwd, relative);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
};

/**
 * Loads the servers of the config file, if there is one.
 *
 * @param {object} [options] `{ configPath, allowProjectConfig, cwd, home }`
 * @returns {object[]}
 */
export const loadMcpServers = ({
	configPath,
	allowProjectConfig = false,
	cwd = process.cwd(),
	home = os.homedir(),
} = {}) => {
	const resolved = configPath ? path.resolve(expandHome(configPath, home)) : findMcpConfig({ allowProjectConfig, cwd, home });
	if (!resolved) {
		return [];
	}
	return loadMcpConfig(resolved).mcpServers;
};

/** Human-readable label for a trust level. */
export const describeTrust = (trust) => {
	switch (trust) {
		case "untrusted":
			return "untrusted: every call needs approval";
		case "disabled":
			return "disabled: the server is not connected";
		default:
			return "trusted: calls are automatic";
	}
};
