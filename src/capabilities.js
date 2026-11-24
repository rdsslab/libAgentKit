/**
 * Capability / sandbox helpers.
 *
 * The agent kit can be embedded in other projects (bots, services, CLIs). A host
 * must be able to restrict what the model can do: running commands, accessing the
 * filesystem/artifacts, searching the web, connecting MCP servers or reading
 * documents.
 *
 * Capabilities are intentionally explicit and fail closed: if a category/tool is
 * not enabled, the operation is denied with a structured error the caller and
 * the model can understand.
 */

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/** Categories a host can enable or disable explicitly. @type {ReadonlyArray<string>} */
export const CAPABILITY_CATEGORIES = Object.freeze([
	"terminal",
	"filesystem",
	"web",
	"mcp",
	"documents",
	"artifacts",
]);

const DEFAULT_EMBEDDED_CAPABILITIES = Object.freeze({
	terminal: false,
	filesystem: false,
	web: true,
	mcp: true,
	documents: true,
	artifacts: true,
});

const DEFAULT_INTERACTIVE_CAPABILITIES = Object.freeze({
	terminal: true,
	filesystem: true,
	web: true,
	mcp: true,
	documents: true,
	artifacts: true,
});

const TOOL_CATEGORY = Object.freeze({
	run_command: "terminal",
	web_search: "web",
	create_file: "artifacts",
	read_document: "documents",
});

const normalizeCapabilityValue = (value, fallback = true) => {
	if (value === false) return false;
	if (value === true) return true;
	if (isPlainObject(value)) {
		return {
			enabled: value.enabled !== false,
			...value,
		};
	}
	return fallback;
};

/**
 * Fills missing categories with safe defaults and preserves per-tool overrides.
 *
 * @param {object} [capabilities] Host capability config.
 * @param {{interactive?: boolean}} [options] Interactive hosts default to all
 *   capabilities enabled; embedded hosts disable terminal and filesystem.
 * @returns {object} Normalized categories, `tools` overrides and `mode`.
 */
export const normalizeCapabilities = (capabilities, { interactive = false } = {}) => {
	const defaults = interactive ? DEFAULT_INTERACTIVE_CAPABILITIES : DEFAULT_EMBEDDED_CAPABILITIES;
	const input = isPlainObject(capabilities) ? capabilities : {};
	const normalized = {};

	for (const category of CAPABILITY_CATEGORIES) {
		const fallback = defaults[category] !== false;
		normalized[category] = normalizeCapabilityValue(input[category], fallback);
	}

	// Per-tool overrides live under tools: { run_command: false, web_search: true }
	const tools = isPlainObject(input.tools) ? input.tools : {};
	normalized.tools = {};
	for (const [name, value] of Object.entries(tools)) {
		normalized.tools[String(name)] = normalizeCapabilityValue(value, true);
	}

	normalized.mode = typeof input.mode === "string" ? input.mode : (input.mode ?? null);
	return normalized;
};

/**
 * @param {object} capabilities Normalized capabilities.
 * @param {string} category Category name from `CAPABILITY_CATEGORIES`.
 * @returns {boolean} Whether the category is enabled.
 */
export const capabilityEnabled = (capabilities, category) => {
	const value = capabilities?.[category];
	if (value === false) return false;
	if (value === true || value == null) return value !== false;
	if (isPlainObject(value)) return value.enabled !== false;
	return Boolean(value);
};

/**
 * Resolves a tool's effective permission: per-tool override wins, then the
 * category gate, then the fail-closed default.
 *
 * @param {string} toolName Tool name (`run_command`, `web_search`, ...).
 * @param {object} capabilities Normalized capabilities.
 * @returns {{allowed: boolean, capability: string, tool: string}}
 */
export const resolveToolCapability = (toolName, capabilities) => {
	const name = String(toolName || "").trim();
	const toolOverride = capabilities?.tools?.[name];
	if (toolOverride === false) {
		return { allowed: false, capability: TOOL_CATEGORY[name] || name, tool: name };
	}
	if (isPlainObject(toolOverride) && toolOverride.enabled === false) {
		return { allowed: false, capability: TOOL_CATEGORY[name] || name, tool: name };
	}

	const category = TOOL_CATEGORY[name] || null;
	if (category && !capabilityEnabled(capabilities, category)) {
		return { allowed: false, capability: category, tool: name };
	}

	return { allowed: true, capability: category || name, tool: name };
};

/**
 * Builds the structured result returned to the model when a capability denies a tool.
 *
 * @param {object} [options]
 * @param {string} [options.capability]
 * @param {string} [options.tool]
 * @param {string} [options.message] Optional replacement for both messages.
 * @returns {{ok: false, error: string, code: string, capability: string,
 *   tool: string|null, message: string, userMessage: string}}
 */
export const capabilityDeniedResult = ({ capability, tool, message } = {}) => {
	const cap = capability || "unknown";
	const label = tool ? `tool "${tool}"` : `capability "${cap}"`;
	return {
		ok: false,
		error: "capability_disabled",
		code: "CAPABILITY_DISABLED",
		capability: cap,
		tool: tool || null,
		message: message || `You do not have permission to use ${label}: this capability is disabled in the current configuration.`,
		userMessage: message || `I cannot use ${label} because this capability is disabled.`,
	};
};

/**
 * @param {{interactive?: boolean}} [options]
 * @returns {object} Defaults for an embedded (restricted) or interactive host.
 */
export const defaultCapabilitiesFor = ({ interactive = false } = {}) => normalizeCapabilities({}, { interactive });

/**
 * Wraps a single tool handler so denied calls return a structured error instead
 * of executing.
 *
 * @param {string} name Tool name.
 * @param {Function} handler Original `async (args, context) => result`.
 * @param {object} capabilities Normalized capabilities.
 * @returns {Function} Guarded handler, or the original value if it is not a function.
 */
export const applyCapabilityToToolHandler = (name, handler, capabilities) => {
	if (typeof handler !== "function") {
		return handler;
	}

	return async (args, context) => {
		const verdict = resolveToolCapability(name, capabilities);
		if (!verdict.allowed) {
			return capabilityDeniedResult({ capability: verdict.capability, tool: name });
		}
		return handler(args, context);
	};
};

/**
 * Applies capability gates to a whole tool-handler map.
 *
 * @param {object} [handlers] Map of name → function or `{handler, ...}` definition.
 * @param {object} capabilities Normalized capabilities.
 * @returns {object} Same shape, with denied handlers replaced by structured errors.
 */
export const applyCapabilitiesToToolHandlers = (handlers = {}, capabilities) => {
	const wrapped = {};
	for (const [name, definition] of Object.entries(handlers || {})) {
		if (definition && typeof definition === "object" && typeof definition.handler === "function") {
			const verdict = resolveToolCapability(name, capabilities);
			if (!verdict.allowed) {
				wrapped[name] = {
					...definition,
					handler: async () => capabilityDeniedResult({ capability: verdict.capability, tool: name }),
				};
			} else {
				wrapped[name] = definition;
			}
			continue;
		}
		if (typeof definition === "function") {
			wrapped[name] = applyCapabilityToToolHandler(name, definition, capabilities);
			continue;
		}
		wrapped[name] = definition;
	}
	return wrapped;
};
