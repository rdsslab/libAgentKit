# libAgentKit

**Provider-agnostic agent toolkit for Node.js.**

Deterministic policies, web search, in-memory document extraction, media helpers, file
artifacts and a single `askAgent()` entry point — usable from a bot worker, an HTTP
endpoint, a CLI, a scheduled task or an MCP server.

```js
import { askAgent } from "@rdsslab/agentkit";

const answer = await askAgent({
  provider: { provider: "ollama", model: "qwen3.5:4b", baseUrl: "http://127.0.0.1:11434" },
  system: "You are a concise assistant.",
  messages: [{ role: "user", content: "What is the weather in Quito?" }],
  tools: { web_search: true },
});

console.log(answer.text);
```

## Why this exists

The harness started inside the OpenFusionAPI Telegram bot and grew into a real toolkit.
It was then extracted into `libOpenFusionAPI` (the agent kit, v14.3.x), where it was
tied to the platform's release cycle: a database migration, a Docker rebuild and a
deployment. That is the wrong cadence for a library that agents, CLIs and bots consume.

This repository is now the **single source of truth** for the harness.
`libOpenFusionAPI` depends on it and re-exports it; nothing is duplicated.

## Install

The package is distributed as a git URL (the rdsslab convention — it is not published
to npm):

```json
{
  "dependencies": {
    "@rdsslab/agentkit": "git+https://github.com/rdsslab/libAgentKit.git"
  }
}
```

```bash
npm install
```

Requires Node.js 22 or newer (`pdfjs-dist` v6 uses `Promise.withResolvers`, which
does not exist in Node 20). The install pulls five dependencies (the provider SDKs
and `pdfjs-dist`); Chromium is **not** required unless you want the built-in PDF/image
renderer (see [Artifacts](#artifacts)).

Loading the package costs ~25 ms: the provider SDKs and `pdfjs-dist` are imported on
demand, the first time a provider is used or the first PDF is extracted.

## What's inside

| Module | What it does | External dependencies |
| --- | --- | --- |
| `policies` | Deterministic decisions: is this a recall question? A web query? A quoted reply? Prompt recaps. | none |
| `buffers` | Data-URL and MIME normalisation, binary descriptors. | none |
| `websearch` | DuckDuckGo / Bing / HTTP-JSON search with a browser User-Agent. | none |
| `documents` | In-memory PDF, DOCX, HTML and text extraction (no filesystem writes). | `pdfjs-dist` |
| `media` | Images, STT/TTS provider registries, video frames and metadata via ffmpeg. | `ffmpeg` (system) |
| `artifacts` | The `create_file` contract: PDF, image, HTML, text, JSON, Markdown, CSV. | none (renderer injected) |
| `terminal` | The `run_command` tool: allowlist of binaries, approval, limits, secret scrubbing. | none (`ffmpeg` not required) |
| `mcp` | MCP configuration: servers, transports, trust levels, config discovery. | none |
| `agent` | `askAgent()` orchestration: pre-search, local tools, documents, one envelope. | loads `./ia` on demand |
| `ia` | Provider layer: OpenAI-compatible family, Anthropic, Google GenAI, plus remote MCP servers (HTTP and stdio). | `openai`, `@anthropic-ai/sdk`, `@google/genai`, `@modelcontextprotocol/sdk` |
| `tui` | Interactive terminal shell: history, menus, settings editor, themes and streaming. | `ink`, `react` |

### The provider layer is loaded on demand

Importing the package does **not** load the provider SDKs. They are pulled in the
first time `askAgent()` runs, or when you import them explicitly:

```js
import { askIAWithProviderMCP } from "@rdsslab/agentkit/ia";
```

The provider is always explicit. This package never reads credentials from a database,
from the environment or from a config file: you pass `{ provider, model, apiKey, baseUrl }`.
The **TUI** is the only exception: it reads the global/project config files so settings
can be edited from the terminal (see below). The library API stays explicit.

## Interactive TUI

```bash
npm run tui          # from a real terminal (TTY)
```

The TUI uses the same `askAgent()` engine as the library; it does not add a second
runtime. Without a TTY it exits with code 2 and a plain message instead of writing
ANSI sequences into a pipe or log.

**Layout.** Header with the real `cwd` (and git branch when available), scrollable
history with minimal Markdown, a multiline editor, footer with turn state, and an
optional side panel (usage, tool count, recent files). Only two themes exist:
`dark` and `light`.

**Keys**

| Key | Action |
| --- | --- |
| `Enter` | Send the draft |
| `Ctrl+J` / `Shift+Enter` | Newline inside the editor |
| `Ctrl+P` or `/` (empty draft) | Command palette |
| `/settings`, `/models`, `/help`, … | Slash commands (same registry as the palette) |
| `Ctrl+S`, `Ctrl+M`, `Ctrl+T`, `Ctrl+N`, `Ctrl+H`, `Ctrl+B` | Settings, models, last tool, new session, help, side panel |
| `@` | Attach a file from `cwd` (relative path only) |
| `PgUp` / `PgDn`, `↑` / `↓` | Scroll history |
| `Esc` | Close a menu, or interrupt the active turn |
| `Ctrl+C` | Interrupt the turn; when idle, exit and restore the terminal |

Tool approvals and agent questions appear inline: arrows select, `Enter` confirms,
`1`–`9` picks an option, `Esc` rejects. The terminal tool is created with
`cwd` and `allowedRoots: [cwd]`; a command already started keeps its own timeout,
so `Esc` aborts the model call but does not kill that child process.

**Settings** (`/settings` → `Enter`) are editable in the terminal and saved to disk:

- provider preset (`ollama`, `openrouter`, `openai` or `openai-compatible`), model,
  base URL and API token;
- mode (`build`/`plan`), language, theme, capabilities and compaction;
- remote MCP servers: add, edit name/URL, toggle trust, remove;
- "Save global settings" and "Save project settings".

The global file is `~/.config/agentkit/config.json` (or the platform equivalent) and
is written with mode `0600`. Tokens are masked in the UI and may be stored as
`env:NOMBRE_VAR` so the secret itself lives in the environment. Project config is
shareable: `stripSecrets()` removes tokens and authorization headers before saving.
There is no "OpenCode" preset: OpenCode-style endpoints are configured as generic
`openai-compatible` with a custom base URL and token.

## Tools

`askAgent` accepts local tools (a plain object with a `handler`) and remote MCP
servers (Streamable HTTP or stdio). Both are offered to the model in the same turn.

```js
const result = await askAgent({
  provider: { provider: "openai", model: "gpt-5", apiKey: process.env.OPENAI_API_KEY },
  messages: [{ role: "user", content: "Find the latest release notes" }],
  tools: {
    web_search: true,                                  // built-in
    my_tool: {                                          // your own
      description: "Does something useful",
      parameters: { type: "object", properties: { id: { type: "string" } } },
      handler: async ({ id }) => ({ ok: true, id }),
    },
  },
  mcpServers: [{ name: "files", url: "http://127.0.0.1:8931/mcp" }],
});
```

The envelope is always the same shape: `text`, `usedWeb`, `webQuery`, `webResults`,
`documents`, `toolExecutions`, `hasTools` and (optionally) `diagnostics`.

### Streaming (opt-in)

`askAgent()` accepts an optional `onTextDelta(delta, meta)` observer. Without it,
the provider uses exactly the same non-streaming request path as before, so an
embedded deployment is unaffected.

```js
const answer = await askAgent({
  provider: { provider: "ollama", model: "qwen3.5:4b", baseUrl: "http://127.0.0.1:11434" },
  messages: [{ role: "user", content: "Escribe un poema corto" }],
  onTextDelta: (delta) => process.stdout.write(delta),
  onToolStart: (event) => console.error("tool", event.tool),
  onToolFinish: (event) => console.error("done", event.tool, event.durationMs),
});
```

Streaming is supported for the OpenAI-compatible family (including Ollama and
OpenRouter), Anthropic and Google GenAI. A server that advertises but fails to
deliver SSE is retried once without streaming. Observers are best-effort: a
throwing callback never changes the answer. The TUI uses these hooks to render
tokens as they arrive.

## Artifacts

`create_file` is a **contract**, not an implementation: the host injects the renderer,
so the package stays free of Chromium.

```js
import { createFileTool } from "@rdsslab/agentkit";

const tool = createFileTool({
  renderPdf: (html) => myPdfRenderer(html),          // returns a Buffer
  renderImage: (html, { type }) => myImageRenderer(html, type),
});

const outcome = await tool.handler({ format: "pdf", content: "<h1>Report</h1>" });
// outcome.artifact -> { buffer, filename: "respuesta-2026-11-17.pdf", mime: "application/pdf" }
```

Text formats (`text`, `json`, `csv`, `markdown`, `html`) never need a renderer: they
are plain buffers. A missing renderer is reported as
`ARTIFACT_RENDERER_UNAVAILABLE` instead of failing silently.

If you installed Chromium yourself (`npm i puppeteer-core @sparticuz/chromium`), the
package can drive it:

```js
import { loadDefaultRenderer } from "@rdsslab/agentkit";

const renderer = await loadDefaultRenderer();   // null when Chromium is not installed
const tool = createFileTool(renderer);
```

## Terminal

`run_command` runs a binary. It is **inert until the host says which binaries may
run**: with no allowlist every command is refused.

```js
import { createTerminalTool } from "@rdsslab/agentkit";

const tool = createTerminalTool({
  allowedBinaries: ["git", "ls"],        // names, or absolute paths
  cwd: "/srv/project",
  allowedRoots: ["/srv/project"],
  approve: async ({ command, args }) => askTheUser(command, args),   // optional
  onAudit: (entry) => logger.info(entry),                            // optional
});

const result = await tool.handler({ command: "git", args: ["status", "--short"] });
```

| Guard | Detail |
| --- | --- |
| **No shell** | `spawn(bin, args, { shell: false })`. `;`, `\|`, `&&` and backticks are literal arguments, never syntax. |
| **Allowlist** | Empty by default. A name allows that binary; an absolute path allows exactly that file. A name is resolved through a restricted PATH, so an absolute path in the allowlist is the strict form. |
| **Environment** | The child does **not** inherit `process.env`: it gets a restricted PATH, `HOME` and the locale, plus whatever the host passes explicitly. The API keys of the host never reach the command. |
| **Approval** | `approve()` can veto each command. Without it, the allowlist is the only gate. |
| **Limits** | Timeout (default 30 s, then SIGKILL), output cap (default 256 KB) and a maximum number of commands per turn (default 10). |
| **Scrubbing** | Tokens in the output (`sk-…`, `ghp_…`, `AKIA…`, JWTs, private keys, `*_TOKEN=…`) are redacted, plus any literal the host registers. |
| **Audit** | `onAudit()` receives every decision, including the refusals. |

`runProcess` (the low-level wrapper) now accepts `env` and `cwd` too, for hosts that
need to drive a process directly.

## MCP

An MCP server is code that runs somewhere else. The package therefore treats the
*config file* as a trust decision, and says so explicitly.

### Transports

| Transport | Entry | Notes |
| --- | --- | --- |
| Streamable HTTP | `{ url }` | With a legacy SSE fallback. |
| stdio | `{ command, args, env, cwd }` | A local server started as a child process. The stdio transport is imported on demand. |

### Trust levels

| Level | Behaviour |
| --- | --- |
| `trusted` (default) | The tools are offered to the model and called automatically. |
| `untrusted` | The tools are offered, but **every call** needs the host's approval (`approveToolCall`). Without an approval hook the call is refused: it fails closed, because "nobody is watching" is not a decision. |
| `disabled` | The server is not connected and its tools are never exposed. |

```js
const result = await askAgent({
  provider,
  messages,
  mcpServers: [
    { name: "files", url: "http://127.0.0.1:8931/mcp", trust: "trusted" },
    { name: "git", command: "mcp-server-git", args: ["--repo", "/srv/repo"], trust: "untrusted" },
    { name: "old", url: "http://127.0.0.1:8932/mcp", trust: "disabled" },
  ],
  approveToolCall: async ({ serverName, toolName, arguments }) => {
    // return true to allow, false to refuse
    return askTheUser(`${serverName}.${toolName}`, arguments);
  },
});
```

The approval hook receives `{ serverName, toolName, toolAlias, arguments }` and may
return `true`/`false` or `{ approved: true }`. A refused call is reported in the
envelope as a failed tool execution (`TOOL_CALL_NOT_APPROVED`) instead of reaching
the server.

### Configuration file

By default only the **user-level** config is read:

```
~/.config/agentkit/config.json
```

A config file inside the project (`agentkit.config.json` or `.agentkit/config.json`)
is **not** loaded unless the host opts in with `allowProjectConfig: true`: a
repository can carry one, and a repository is not a trust boundary.

```json
{
  "mcpServers": {
    "files": { "url": "http://127.0.0.1:8931/mcp", "trust": "trusted" },
    "git": { "command": "mcp-server-git", "args": ["--repo", "/srv/repo"], "trust": "untrusted" },
    "old": { "url": "http://127.0.0.1:8932/mcp", "trust": "disabled" }
  },
  "terminal": { "allowedBinaries": ["git", "ls"] }
}
```

```js
import { loadMcpServers, findMcpConfig } from "@rdsslab/agentkit";

const servers = loadMcpServers({ allowProjectConfig: false });   // user config only
const configPath = findMcpConfig({ allowProjectConfig: true });  // explicit opt-in
```

A server entry without a `name` gets one: the hostname of the URL, or the basename
of the stdio command.

## Relationship with OpenFusionAPI

`libOpenFusionAPI` (the API platform) depends on this package and exposes it through
its JavaScript handler namespace (`askAgent`, `webSearch`, `readDocument`,
`transcribeAudio`, `synthesizeSpeech`, `extractVideoFrames`, `describeMediaSupport`
and the `agentKit` namespace). The platform's public API does not change: this is an
internal move.

## Roadmap

- **v0.2** — terminal tool: `run_command` with an allowlist of binaries, a working
  directory, timeouts, output limits, secret scrubbing and an approval hook. *Done.*
- **v0.3** — MCP over stdio, a configuration file for servers and tools, per-server
  trust levels. *Done.*
- **v1.0** — frozen public API.

### Future work (not in this release)

- Agent management in the TUI: named agents with their own instructions, tools,
  model and history — [issue #1](https://github.com/rdsslab/libAgentKit/issues/1).
- Read-only diff viewer (`/diff`) with file selection and attribution of changes —
  [issue #2](https://github.com/rdsslab/libAgentKit/issues/2).

Explicitly out of scope for the TUI in this release: `/diff` and patch panels, file
undo/redo, tabs/subagents/background queues, shell `!` mode and external editors.

## License

MIT
