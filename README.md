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
| `agent` | `askAgent()` orchestration: pre-search, local tools, documents, one envelope. | loads `./ia` on demand |
| `ia` | Provider layer: OpenAI-compatible family, Anthropic, Google GenAI, plus remote MCP servers. | `openai`, `@anthropic-ai/sdk`, `@google/genai`, `@modelcontextprotocol/sdk` |

### The provider layer is loaded on demand

Importing the package does **not** load the provider SDKs. They are pulled in the
first time `askAgent()` runs, or when you import them explicitly:

```js
import { askIAWithProviderMCP } from "@rdsslab/agentkit/ia";
```

The provider is always explicit. This package never reads credentials from a database,
from the environment or from a config file: you pass `{ provider, model, apiKey, baseUrl }`.

## Tools

`askAgent` accepts local tools (a plain object with a `handler`) and remote MCP
servers (Streamable HTTP). Both are offered to the model in the same turn.

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

## Relationship with OpenFusionAPI

`libOpenFusionAPI` (the API platform) depends on this package and exposes it through
its JavaScript handler namespace (`askAgent`, `webSearch`, `readDocument`,
`transcribeAudio`, `synthesizeSpeech`, `extractVideoFrames`, `describeMediaSupport`
and the `agentKit` namespace). The platform's public API does not change: this is an
internal move.

## Roadmap

- **v0.2** — terminal tool: `run_command` with an allowlist of binaries, a working
  directory, timeouts, output limits, secret scrubbing and an approval hook.
- **v0.3** — MCP over stdio, a configuration file for servers and tools, per-server
  trust levels.
- **v1.0** — frozen public API.

## License

MIT
