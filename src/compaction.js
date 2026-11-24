import { short } from "./policies.js";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const messageText = (message) => {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content.map((part) => {
			if (typeof part === "string") return part;
			if (part?.type === "text") return part.text || "";
			if (part?.type === "image" || part?.type === "image_url") return "[image]";
			return "";
		}).filter(Boolean).join("\n");
	}
	try { return JSON.stringify(content ?? ""); } catch { return String(content ?? ""); }
};

/**
 * @param {object} usage `askAgent()` usage containing `context.used_percent`.
 * @param {number} [thresholdPercent=90]
 * @returns {boolean} True when the reported usage reaches the threshold.
 */
export const shouldAutoCompact = (usage, thresholdPercent = 90) => {
	const pct = Number(usage?.context?.used_percent);
	const threshold = Number(thresholdPercent);
	if (!Number.isFinite(pct) || !Number.isFinite(threshold)) return false;
	return pct >= threshold;
};

/**
 * Drops older non-system messages and inserts a note about what was removed.
 *
 * @param {Array<object>} [messages]
 * @param {object} [options]
 * @param {number} [options.keepLastMessages=12]
 * @returns {Array<object>} System messages, compaction note and recent turns.
 */
export const compactMessagesTruncate = (messages = [], { keepLastMessages = 12 } = {}) => {
	const list = Array.isArray(messages) ? messages : [];
	const system = list.filter((m) => m?.role === "system");
	const nonSystem = list.filter((m) => m?.role !== "system");
	const kept = nonSystem.slice(-Math.max(1, Number(keepLastMessages) || 12));
	const removed = Math.max(0, nonSystem.length - kept.length);
	const note = removed > 0 ? [{
		role: "system",
		content: `[Context compacted: ${removed} earlier non-system message(s) omitted to fit context window.]`,
	}] : [];
	return [...system, ...note, ...kept];
};

/**
 * Builds the prompt used to ask a model for a continuity summary.
 *
 * @param {Array<object>} [messages]
 * @param {object} [options]
 * @param {number} [options.maxMessages=40] Recent non-system messages to include.
 * @returns {string} A plain-text summarization prompt.
 */
export const buildCompactionSummaryPrompt = (messages = [], { maxMessages = 40 } = {}) => {
	const list = (Array.isArray(messages) ? messages : []).filter((m) => m?.role !== "system");
	const slice = list.slice(-Math.max(1, Number(maxMessages) || 40));
	const transcript = slice.map((m) => `${String(m?.role || "unknown").toUpperCase()}: ${short(messageText(m), 800)}`).join("\n\n");
	return [
		"Summarize the following conversation history for context continuity.",
		"Preserve: user goals, decisions, constraints, important facts, file paths, commands/results, errors, and pending tasks.",
		"Be concise and factual. Output plain text summary only.",
		"",
		"Conversation:",
		transcript || "(empty)",
	].join("\n");
};

/**
 * Replaces older turns with one summary system message. `keepLastMessages: 0`
 * is valid and keeps only the summary.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.messages]
 * @param {(messages: Array<object>) => Promise<string>|string} [options.summarize]
 * @param {number} [options.keepLastMessages=6]
 * @returns {Promise<Array<object>>} System messages, summary and recent turns.
 */
export const compactMessagesWithSummary = async ({ messages = [], summarize, keepLastMessages = 6 } = {}) => {
	const list = Array.isArray(messages) ? messages : [];
	const system = list.filter((m) => m?.role === "system");
	const nonSystem = list.filter((m) => m?.role !== "system");
	// `0` is a legitimate value: an AgentSession keeps ONLY the summary and
	// drops every turn. `Number(0) || 6` used to silently keep six messages.
	const keep = Number.isFinite(Number(keepLastMessages))
		? Math.max(0, Number(keepLastMessages))
		: 6;
	if (nonSystem.length <= keep) return list.slice();

	const toSummarize = nonSystem.slice(0, Math.max(0, nonSystem.length - keep));
	const kept = keep > 0 ? nonSystem.slice(-keep) : [];
	let summaryText = "";
	if (typeof summarize === "function") {
		try {
			summaryText = String(await summarize(toSummarize) || "").trim();
		} catch (error) {
			summaryText = `[Summary unavailable: ${error?.message || error}]`;
		}
	}
	if (!summaryText) {
		summaryText = toSummarize.map((m) => `- ${m?.role}: ${short(messageText(m), 120)}`).join("\n");
	}
	const summaryMessage = {
		role: "system",
		content: `Conversation summary (compacted context):\n${summaryText}`,
	};
	return [...system, summaryMessage, ...kept];
};

/**
 * Generic compaction entry point used by `askAgent()`.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.messages]
 * @param {"summary"|"truncate"|"hybrid"} [options.strategy=summary]
 * @param {Function} [options.summarize]
 * @param {number} [options.keepLastMessages=12]
 * @returns {Promise<Array<object>>} Compacted messages.
 */
export const compactMessages = async ({ messages = [], strategy = "summary", summarize, keepLastMessages = 12 } = {}) => {
	const mode = String(strategy || "summary").toLowerCase();
	if (mode === "truncate") return compactMessagesTruncate(messages, { keepLastMessages });
	if (mode === "hybrid") {
		const summarized = await compactMessagesWithSummary({ messages, summarize, keepLastMessages: Math.max(4, Math.floor(keepLastMessages / 2)) });
		return compactMessagesTruncate(summarized, { keepLastMessages: Math.max(6, keepLastMessages) });
	}
	return compactMessagesWithSummary({ messages, summarize, keepLastMessages });
};
