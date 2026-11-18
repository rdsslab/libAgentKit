#!/usr/bin/env node
import React, { useEffect, useMemo, useRef, useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { askAgent } from "./agent.js";
import { createTerminalTool } from "./terminal.js";
import { createFileTool } from "./artifacts.js";
import { loadEffectiveConfig, saveGlobalConfig, saveProjectConfig, defaultConfig, getGlobalConfigPath } from "./config.js";
import { getTranslator, availableLanguages } from "./i18n.js";
import { compactMessages, shouldAutoCompact } from "./compaction.js";
import { listOllamaModels } from "./ollama.js";
import { copyTextToClipboard, readImageFromClipboard, readTextFromClipboard } from "./clipboard.js";

const tryLoadImageFromPath = (maybePath) => {
	const raw = String(maybePath || "").trim().replace(/^['"]|['"]$/g, "");
	if (!raw) return null;
	const resolved = path.resolve(process.cwd(), raw);
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
	const ext = path.extname(resolved).toLowerCase();
	const mime = { ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".gif":"image/gif", ".bmp":"image/bmp" }[ext];
	if (!mime) return null;
	try {
		const data = fs.readFileSync(resolved);
		if (!data || !data.length) return null;
		return { mimeType: mime, data, fileName: path.basename(resolved), path: resolved };
	} catch { return null; }
};

const h = React.createElement;

const formatTokens = (value, na = "N/A") => {
	if (value == null || Number.isNaN(Number(value))) return na;
	return String(Math.round(Number(value)));
};

const formatPercent = (value, na = "N/A") => {
	if (value == null || Number.isNaN(Number(value))) return na;
	return `${Number(value).toFixed(1)}%`;
};

const formatRate = (value, na = "N/A") => {
	if (value == null || Number.isNaN(Number(value))) return na;
	return `${Number(value).toFixed(2)}`;
};

const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeInputRequest = (req) => {
	const type = req?.type || "text";
	return {
		id: req?.id || nowId(),
		type,
		question: req?.question || req?.title || "Input required",
		description: req?.description || "",
		options: Array.isArray(req?.options) ? req.options : [],
		required: req?.required !== false,
		multiple: Boolean(req?.multiple),
	};
};

const parseCommand = (line) => {
	const raw = String(line || "").trim();
	if (!raw.startsWith("/")) return null;
	const parts = raw.slice(1).trim().split(/\s+/);
	const name = (parts.shift() || "").toLowerCase();
	return { name, args: parts, raw };
};

const buildProviderConfig = (cfg) => {
	const p = cfg?.provider || {};
	const providerName = p.provider || p.name || "ollama";
	const base = {
		provider: providerName,
		model: p.model || "",
		baseUrl: p.baseUrl || p.baseURL || (providerName === "ollama" ? "http://127.0.0.1:11434" : undefined),
		apiKey: p.apiKey || p.api_key || undefined,
	};
	// optional context length hint if known
	if (p.contextLength || p.context_length || p.num_ctx) {
		base.contextLength = p.contextLength || p.context_length || p.num_ctx;
	}
	return base;
};

const App = () => {
	const { exit } = useApp();
	const loaded = useMemo(() => loadEffectiveConfig({ cwd: process.cwd() }), []);
	const [configState, setConfigState] = useState(loaded.config);
	const [language, setLanguage] = useState(loaded.config?.tui?.language || loaded.config?.language || "en");
	const t = useMemo(() => getTranslator(language), [language]);

	const [screen, setScreen] = useState("chat"); // chat | settings | models | form
	const [messages, setMessages] = useState([]); // conversation messages for agent
	const [display, setDisplay] = useState([]); // {id, role, text}
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	const [mode, setMode] = useState((loaded.config?.mode === "plan") ? "plan" : "build");
	const [usage, setUsage] = useState(null);
	const [models, setModels] = useState([]);
	const [modelsLoading, setModelsLoading] = useState(false);
	const [pendingInput, setPendingInput] = useState(null); // {request, resolve, reject}
	const [formValue, setFormValue] = useState("");
	const [formSelected, setFormSelected] = useState([]);
	const [settingsDraft, setSettingsDraft] = useState({
		provider: (loaded.config?.provider?.provider) || "ollama",
		model: loaded.config?.provider?.model || "",
		baseUrl: loaded.config?.provider?.baseUrl || "http://127.0.0.1:11434",
		language: loaded.config?.tui?.language || loaded.config?.language || "en",
		autoCompact: Boolean(loaded.config?.compaction?.auto ?? loaded.config?.tui?.autoCompact ?? false),
		thresholdPercent: Number(loaded.config?.compaction?.thresholdPercent ?? loaded.config?.tui?.compactThresholdPercent ?? 90),
	});
	const [attachedImage, setAttachedImage] = useState(null);
	const mountedRef = useRef(true);

	useEffect(() => () => { mountedRef.current = false; }, []);

	const pushDisplay = (role, text) => {
		setDisplay((prev) => [...prev.slice(-200), { id: nowId(), role, text: String(text ?? "") }]);
	};

	const addConversationMessage = (msg) => {
		setMessages((prev) => [...prev, msg]);
	};

	const refreshModels = async () => {
		const baseUrl = settingsDraft.baseUrl || configState?.provider?.baseUrl || "http://127.0.0.1:11434";
		setModelsLoading(true);
		try {
			const list = await listOllamaModels({ baseUrl });
			if (!mountedRef.current) return;
			setModels(list);
			setStatus(`Loaded ${list.length} model(s) from Ollama`);
		} catch (error) {
			if (!mountedRef.current) return;
			setStatus(`Could not load Ollama models: ${error?.message || error}`);
		} finally {
			if (mountedRef.current) setModelsLoading(false);
		}
	};

	useEffect(() => { refreshModels(); }, []);

	const getEffectiveProvider = () => {
		const p = configState?.provider || {};
		return {
			provider: p.provider || "ollama",
			baseUrl: p.baseUrl || "http://127.0.0.1:11434",
			model: p.model || "",
			apiKey: p.apiKey || undefined,
			contextLength: p.contextLength || p.context_length || p.num_ctx || undefined,
		};
	};

	const doCompact = async ({ silent = false } = {}) => {
		if (!messages.length) return messages;
		if (!silent) {
			setStatus(t("compacting"));
			pushDisplay("system", t("compacting"));
		}
		const providerCfg = getEffectiveProvider();
		const summarize = async (toSummarize) => {
			const summaryPrompt = `Summarize this conversation for context continuity. Preserve goals, decisions, constraints, facts, files, commands, results, errors, pending tasks.\n\n` +
				toSummarize.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n");
			const res = await askAgent({
				provider: providerCfg,
				prompt: summaryPrompt,
				system: "You are a concise conversation summarizer.",
				interactive: true,
				capabilities: { terminal: false, web: false, mcp: false, documents: false, artifacts: false, filesystem: false },
				includeDiagnostics: false,
			});
			return res.text || "";
		};
		try {
			const strategy = configState?.compaction?.strategy || "summary";
			const keepLastMessages = Number(configState?.compaction?.keepLastMessages || 12);
			const compacted = await compactMessages({ messages, strategy, summarize, keepLastMessages });
			setMessages(compacted);
			if (!silent) {
				setStatus("Context compacted");
				pushDisplay("system", "Context compacted");
			}
			return compacted;
		} catch (error) {
			const msg = `Compaction failed: ${error?.message || error}`;
			setStatus(msg);
			if (!silent) pushDisplay("system", msg);
			return messages;
		}
	};

	const maybeAutoCompact = async (lastUsage) => {
		const auto = Boolean(configState?.compaction?.auto ?? configState?.tui?.autoCompact ?? false);
		const threshold = Number(configState?.compaction?.thresholdPercent ?? configState?.tui?.compactThresholdPercent ?? 90);
		if (!auto) return;
		if (shouldAutoCompact(lastUsage, threshold)) {
			await doCompact({ silent: false });
		}
	};

	const requestUserInput = (request) => new Promise((resolve, reject) => {
		const normalized = normalizeInputRequest(request);
		setPendingInput({ request: normalized, resolve, reject });
		setFormValue("");
		setFormSelected([]);
		setScreen("form");
	});

	const submitForm = (value) => {
		if (!pendingInput) return;
		const { request, resolve } = pendingInput;
		setPendingInput(null);
		setScreen("chat");
		if (request.type === "multiselect") {
			resolve({ id: request.id, value: formSelected });
		} else {
			resolve({ id: request.id, value });
		}
	};

	const cancelForm = () => {
		if (!pendingInput) return;
		const { request, resolve } = pendingInput;
		setPendingInput(null);
		setScreen("chat");
		resolve({ id: request.id, value: null, cancelled: true });
	};

	const handleAgentResponse = async (userText, options = {}) => {
		const text = String(userText || "").trim();
		if (!text && !attachedImage) return;
		const providerCfg = getEffectiveProvider();
		if (!providerCfg.model) {
			pushDisplay("system", "No model selected. Use /model or /settings to configure a model.");
			return;
		}

		const userMsg = { role: "user", content: text || "(image)" };
		pushDisplay("user", text || (attachedImage ? "[image attached]" : ""));
		addConversationMessage(userMsg);
		setBusy(true);
		setStatus(t("thinking"));

		try {
			const terminal = createTerminalTool({
				allowedBinaries: ["bash", "sh", "ls", "cat", "uname", "df", "lsblk", "pwd", "echo", "whoami", "id", "date", "find", "grep", "sed", "awk", "head", "tail", "wc", "sort", "uniq", "cut", "tr", "stat", "du", "free", "uptime", "hostname", "ps", "env", "printenv"],
				timeoutMs: 30000,
				maxOutputBytes: 128 * 1024,
			});
			const toolHandlers = { run_command: terminal };
			const tools = { web_search: true, run_command: true };

			const result = await askAgent({
				provider: providerCfg,
				history: messages,
				messages: [userMsg],
				images: attachedImage ? [attachedImage] : undefined,
				tools,
				toolHandlers,
				mode,
				interactive: true,
				capabilities: { terminal: true, filesystem: true, web: true, mcp: true, documents: true, artifacts: true },
				onUserInputRequest: requestUserInput,
				includeDiagnostics: true,
			});

			setAttachedImage(null);
			const answer = result?.text || "";
			pushDisplay("assistant", answer || "(no response)");
			addConversationMessage({ role: "assistant", content: answer });
			if (result?.usage) setUsage(result.usage);
			setStatus("");
			await maybeAutoCompact(result?.usage);
		} catch (error) {
			const msg = error?.userMessage || error?.message || String(error);
			pushDisplay("system", `${t("error")}: ${msg}`);
			setStatus(msg);
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	const handleCommand = async (line) => {
		const cmd = parseCommand(line);
		if (!cmd) return false;
		const { name, args } = cmd;
		if (name === "quit" || name === "exit") {
			exit();
			return true;
		}
		if (name === "help") {
			pushDisplay("system", [
				"Commands:",
				"/help - show help",
				"/quit - exit",
				"/settings - open settings",
				"/save-settings - save global settings",
				"/save-project-settings - save project agentkit/config.json override",
				"/model [name] - set model or open selector",
				"/models - refresh and list models",
				"/mode build|plan - set mode",
				"/compact - compact context now",
				"/autocompact on|off - toggle auto compaction",
				"/threshold <percent> - set auto-compaction threshold",
				"/provider <name> - set provider (ollama, openai-compatible, ...)",
				"/baseurl <url> - set provider base URL",
				"/paste-image - attach image from clipboard (best effort)",
				"/attach <path> - attach image/file path",
				"/copy-last - copy last assistant message to clipboard",
				"/lang en|es - set UI language",
				"/status - show current config and metrics",
			].join("\n"));
			return true;
		}
		if (name === "settings") { setScreen("settings"); return true; }
		if (name === "save-settings") {
			try {
				const next = {
					...configState,
					language: settingsDraft.language || "en",
					mode,
					provider: {
						...(configState.provider || {}),
						provider: settingsDraft.provider || "ollama",
						model: settingsDraft.model || "",
						baseUrl: settingsDraft.baseUrl || "http://127.0.0.1:11434",
					},
					tui: {
						...(configState.tui || {}),
						language: settingsDraft.language || "en",
						compactThresholdPercent: Number(settingsDraft.thresholdPercent || 90),
						autoCompact: Boolean(settingsDraft.autoCompact),
					},
					compaction: {
						...(configState.compaction || {}),
						auto: Boolean(settingsDraft.autoCompact),
						thresholdPercent: Number(settingsDraft.thresholdPercent || 90),
					},
				};
				const saved = saveGlobalConfig(next);
				setConfigState(saved.config);
				setLanguage(saved.config.tui?.language || saved.config.language || "en");
				pushDisplay("system", `Global config saved: ${saved.path}`);
			} catch (error) {
				pushDisplay("system", `Failed to save config: ${error?.message || error}`);
			}
			return true;
		}
		if (name === "model") {
			if (args[0]) {
				const m = args.join(" ");
				const next = { ...configState, provider: { ...(configState.provider || {}), model: m } };
				setConfigState(next);
				setSettingsDraft((d) => ({ ...d, model: m }));
				pushDisplay("system", `Model set to: ${m}`);
			} else {
				setScreen("models");
			}
			return true;
		}
		if (name === "models") { await refreshModels(); pushDisplay("system", models.map((m) => m.name).join("\n") || "No models"); return true; }
		if (name === "mode") {
			const m = (args[0] || "").toLowerCase();
			if (m === "plan" || m === "build") { setMode(m); pushDisplay("system", `Mode: ${m}`); }
			else pushDisplay("system", "Usage: /mode build|plan");
			return true;
		}
		if (name === "compact") { await doCompact({ silent: false }); return true; }
		if (name === "lang") {
			const l = (args[0] || "").toLowerCase();
			if (availableLanguages().includes(l)) { setLanguage(l); setSettingsDraft((d) => ({ ...d, language: l })); pushDisplay("system", `Language: ${l}`); }
			else pushDisplay("system", `Languages: ${availableLanguages().join(", ")}`);
			return true;
		}
		if (name === "status") {
			const p = getEffectiveProvider();
			pushDisplay("system", JSON.stringify({ mode, provider: p.provider, baseUrl: p.baseUrl, model: p.model, usage, globalConfig: getGlobalConfigPath() }, null, 2));
			return true;
		}
		if (name === "copy-last") {
			const last = [...display].reverse().find((d) => d.role === "assistant");
			if (!last) { pushDisplay("system", "No assistant message to copy"); return true; }
			const res = copyTextToClipboard(last.text);
			pushDisplay("system", res.ok ? `Copied to clipboard (${res.method})` : `Copy failed: ${res.error}`);
			return true;
		}
		if (name === "paste-image") {
			const res = readImageFromClipboard();
			if (res.ok) {
				setAttachedImage({ mimeType: res.mimeType || "image/png", data: res.data });
				pushDisplay("system", `Image attached from clipboard (${res.method}, ${res.data.length} bytes)`);
			} else {
				pushDisplay("system", `Could not read image from clipboard: ${res.error}. You can also paste a file path in the message.`);
			}
			return true;
		}
		if (name === "save-project-settings") {
			try {
				const next = {
					mode,
					provider: {
						...(configState.provider || {}),
						provider: settingsDraft.provider || "ollama",
						model: settingsDraft.model || "",
						baseUrl: settingsDraft.baseUrl || "http://127.0.0.1:11434",
					},
					tui: { ...(configState.tui || {}), language: settingsDraft.language || "en", autoCompact: Boolean(settingsDraft.autoCompact), compactThresholdPercent: Number(settingsDraft.thresholdPercent || 90) },
					compaction: { ...(configState.compaction || {}), auto: Boolean(settingsDraft.autoCompact), thresholdPercent: Number(settingsDraft.thresholdPercent || 90) },
				};
				const saved = saveProjectConfig(next, { cwd: process.cwd() });
				pushDisplay("system", `Project config saved: ${saved.path}`);
			} catch (error) {
				pushDisplay("system", `Failed to save project config: ${error?.message || error}`);
			}
			return true;
		}
		if (name === "autocompact") {
			const v = (args[0] || "").toLowerCase();
			const on = v === "on" || v === "true" || v === "1";
			const off = v === "off" || v === "false" || v === "0";
			if (!on && !off) { pushDisplay("system", "Usage: /autocompact on|off"); return true; }
			setSettingsDraft((d) => ({ ...d, autoCompact: on }));
			setConfigState((c) => ({ ...c, compaction: { ...(c.compaction || {}), auto: on }, tui: { ...(c.tui || {}), autoCompact: on } }));
			pushDisplay("system", `Auto compact: ${on ? "on" : "off"}`);
			return true;
		}
		if (name === "threshold") {
			const n = Number(args[0]);
			if (!Number.isFinite(n) || n < 1 || n > 100) { pushDisplay("system", "Usage: /threshold <1-100>"); return true; }
			setSettingsDraft((d) => ({ ...d, thresholdPercent: n }));
			setConfigState((c) => ({ ...c, compaction: { ...(c.compaction || {}), thresholdPercent: n }, tui: { ...(c.tui || {}), compactThresholdPercent: n } }));
			pushDisplay("system", `Threshold: ${n}%`);
			return true;
		}
		if (name === "provider") {
			const v = (args[0] || "").trim();
			if (!v) { pushDisplay("system", "Usage: /provider <ollama|openai-compatible|anthropic|google|...>"); return true; }
			setSettingsDraft((d) => ({ ...d, provider: v }));
			setConfigState((c) => ({ ...c, provider: { ...(c.provider || {}), provider: v } }));
			pushDisplay("system", `Provider: ${v}`);
			return true;
		}
		if (name === "baseurl") {
			const v = (args[0] || "").trim();
			if (!v) { pushDisplay("system", "Usage: /baseurl <url>"); return true; }
			setSettingsDraft((d) => ({ ...d, baseUrl: v }));
			setConfigState((c) => ({ ...c, provider: { ...(c.provider || {}), baseUrl: v } }));
			pushDisplay("system", `Base URL: ${v}`);
			return true;
		}
		if (name === "attach") {
			const p = args.join(" ");
			const img = tryLoadImageFromPath(p);
			if (img) {
				setAttachedImage(img);
				pushDisplay("system", `Attached image: ${img.fileName} (${img.data.length} bytes)`);
				return true;
			}
			if (p && fs.existsSync(path.resolve(process.cwd(), p))) {
				pushDisplay("system", `Path exists but is not a supported image format: ${p}`);
			} else {
				pushDisplay("system", `File not found: ${p}`);
			}
			return true;
		}
		pushDisplay("system", `Unknown command: ${name}. Try /help`);
		return true;
	};

	const onSubmitInput = async (value) => {
		const line = String(value || "");
		setInput("");
		if (!line.trim()) return;
		if (await handleCommand(line)) return;
		// Best-effort: if the whole message is an existing image path, attach it.
		const asPath = line.trim();
		const onlyPath = !asPath.includes("\n") && (asPath.startsWith("/") || asPath.startsWith("./") || asPath.startsWith("../") || /^[A-Za-z]:\\/.test(asPath));
		const img = onlyPath ? tryLoadImageFromPath(asPath) : null;
		if (img) {
			setAttachedImage(img);
			pushDisplay("system", `Attached image path: ${img.fileName}`);
			// Ask user to send a prompt with the attached image.
			return;
		}
		await handleAgentResponse(line);
	};

	useInput((inputKey, key) => {
		if (key.ctrl && inputKey === "c") {
			exit();
		}
		if (key.escape) {
			if (screen === "form") cancelForm();
			else if (screen !== "chat") setScreen("chat");
		}
	});

	const usageLine = (() => {
		const na = t("notAvailable");
		if (!usage) return `${t("tokensIn")}: ${na} | ${t("tokensOut")}: ${na} | ${t("tokensPerSec")}: ${na} | ${t("contextUsed")}: ${na}`;
		const ctx = usage.context || {};
		const est = ctx.estimated ? ` (${t("estimated")})` : "";
		return `${t("tokensIn")}: ${formatTokens(usage.prompt_tokens, na)} | ${t("tokensOut")}: ${formatTokens(usage.completion_tokens, na)} | ${t("tokensPerSec")}: ${formatRate(usage.tokens_per_second, na)} | ${t("contextUsed")}: ${formatTokens(ctx.used_tokens, na)}/${formatTokens(ctx.limit_tokens, na)} (${formatPercent(ctx.used_percent, na)})${est}`;
	})();

	const header = h(Box, { flexDirection: "column", borderStyle: "round", paddingX: 1 },
		h(Text, { bold: true }, `${t("appTitle")}  |  ${t("mode") || "Mode"}: ${mode === "plan" ? t("modePlan") : t("modeBuild")}  |  ${t("provider")}: ${getEffectiveProvider().provider}  |  ${t("model")}: ${getEffectiveProvider().model || "(none)"}`),
		h(Text, null, usageLine),
		h(Text, { dimColor: true }, "Commands: /help /settings /model /mode /compact /copy-last /paste-image /lang /quit  (Esc: back/cancel)")
	);

	const body = (() => {
		if (screen === "settings") {
			return h(Box, { flexDirection: "column", borderStyle: "single", paddingX: 1 },
				h(Text, { bold: true }, t("settings")),
				h(Text, null, `Global path: ${getGlobalConfigPath()}`),
				h(Text, null, `Provider: ${settingsDraft.provider}  (edit via config file for advanced fields)`),
				h(Text, null, `Base URL: ${settingsDraft.baseUrl}`),
				h(Text, null, `Model: ${settingsDraft.model || "(none)"}`),
				h(Text, null, `Language: ${settingsDraft.language}`),
				h(Text, null, `Auto compact: ${settingsDraft.autoCompact ? "on" : "off"} (threshold ${settingsDraft.thresholdPercent}%)`),
				h(Text, { dimColor: true }, "Edit via commands: /provider /baseurl /model /lang /autocompact /threshold then /save-settings or /save-project-settings. Config is also editable as JSON."),
				h(Text, { dimColor: true }, "Press Esc to return to chat.")
			);
		}
		if (screen === "models") {
			const items = models.map((m) => ({ label: `${m.name}${m.details?.parameter_size ? ` (${m.details.parameter_size})` : ""}`, value: m.name }));
			return h(Box, { flexDirection: "column", borderStyle: "single", paddingX: 1 },
				h(Text, { bold: true }, t("selectModel")),
				modelsLoading ? h(Text, null, h(Spinner, { type: "dots" }), " Loading models...") :
					items.length ? h(SelectInput, {
						items,
						onSelect: (item) => {
							const next = { ...configState, provider: { ...(configState.provider || {}), model: item.value } };
							setConfigState(next);
							setSettingsDraft((d) => ({ ...d, model: item.value }));
							pushDisplay("system", `Model selected: ${item.value}`);
							setScreen("chat");
						}
					}) : h(Text, null, "No models found. Check Ollama/base URL and try /models."),
				h(Text, { dimColor: true }, "Esc to cancel")
			);
		}
		if (screen === "form" && pendingInput) {
			const req = pendingInput.request;
			if (req.type === "select") {
				const items = (req.options || []).map((o) => ({ label: o.label || String(o.value), value: o.value }));
				return h(Box, { flexDirection: "column", borderStyle: "single", paddingX: 1 },
					h(Text, { bold: true }, req.question),
					req.description ? h(Text, null, req.description) : null,
					items.length ? h(SelectInput, { items, onSelect: (item) => submitForm(item.value) }) : h(Text, null, "No options"),
					h(Text, { dimColor: true }, "Esc to cancel/deny")
				);
			}
			if (req.type === "multiselect") {
				return h(Box, { flexDirection: "column", borderStyle: "single", paddingX: 1 },
					h(Text, { bold: true }, req.question),
					req.description ? h(Text, null, req.description) : null,
					h(Text, { dimColor: true }, "Enter comma-separated values or labels. Options: " + (req.options || []).map((o) => `${o.label}=${o.value}`).join(", ")),
					h(Box, null, h(Text, null, "> "), h(TextInput, { value: formValue, onChange: setFormValue, onSubmit: () => {
						const parts = String(formValue || "").split(",").map((s) => s.trim()).filter(Boolean);
						// map labels to values when possible
						const mapped = parts.map((p) => {
							const opt = (req.options || []).find((o) => String(o.value) === p || String(o.label).toLowerCase() === p.toLowerCase());
							return opt ? opt.value : p;
						});
						setFormSelected(mapped);
						submitForm(mapped);
					} })),
					h(Text, { dimColor: true }, "Enter to submit, Esc to cancel")
				);
			}
			if (req.type === "confirm") {
				const items = [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }];
				return h(Box, { flexDirection: "column", borderStyle: "single", paddingX: 1 },
					h(Text, { bold: true }, req.question),
					req.description ? h(Text, null, req.description) : null,
					h(SelectInput, { items, onSelect: (item) => submitForm(item.value) }),
					h(Text, { dimColor: true }, "Esc to cancel")
				);
			}
			return h(Box, { flexDirection: "column", borderStyle: "single", paddingX: 1 },
				h(Text, { bold: true }, req.question),
				req.description ? h(Text, null, req.description) : null,
				h(Box, null, h(Text, null, "> "), h(TextInput, { value: formValue, onChange: setFormValue, onSubmit: () => submitForm(formValue) })),
				h(Text, { dimColor: true }, "Enter to submit, Esc to cancel")
			);
		}

		const visible = display.slice(-18);
		return h(Box, { flexDirection: "column", borderStyle: "single", paddingX: 1, flexGrow: 1 },
			...visible.map((msg) => h(Box, { key: msg.id, flexDirection: "column", marginBottom: 0 },
				h(Text, { color: msg.role === "user" ? "cyan" : msg.role === "assistant" ? "green" : "yellow", bold: true },
					msg.role === "user" ? t("you") : msg.role === "assistant" ? t("assistant") : t("system")),
				h(Text, null, msg.text)
			)),
			busy ? h(Box, null, h(Text, { color: "magenta" }, h(Spinner, { type: "dots" }), " ", status || t("thinking"))) : (status ? h(Text, { dimColor: true }, status) : null),
			attachedImage ? h(Text, { color: "blue" }, `Attached image: ${attachedImage.data?.length || 0} bytes`) : null
		);
	})();

	const inputBar = screen === "chat" ? h(Box, { borderStyle: "round", paddingX: 1 },
		h(Text, null, "> "),
		h(TextInput, { value: input, onChange: setInput, onSubmit: onSubmitInput, placeholder: busy ? "Waiting..." : "Type a message or /help" })
	) : null;

	return h(Box, { flexDirection: "column" }, header, body, inputBar);
};

render(h(App), { exitOnCtrlC: false });
