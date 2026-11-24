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

For a task-oriented map of the public API — sessions, events, memory, capabilities,
media and deterministic web search — see the [Agent-facing API guide](docs/AGENT_API_GUIDE.md).

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
| `media` | Images, STT/TTS provider registries, audio/video extraction and metadata via ffmpeg. | `ffmpeg` (system) |
| `video` | `analyzeVideo()`: frames + STT + `askAgent()` for any chat provider, with a pluggable native handler. | `ffmpeg` (system) |
| `media-context` | Automatic `attachments` in `askAgent()`: images, documents, audio and video prepared before the model call, with STT from config and graceful degradation. | `ffmpeg` (system), optional STT |
| `artifacts` | The `create_file` contract: PDF, image, HTML, text, JSON, Markdown, CSV. | none (renderer injected) |
| `terminal` | The `run_command` tool: allowlist of binaries, approval, limits, secret scrubbing. | none (`ffmpeg` not required) |
| `mcp` | MCP configuration: servers, transports, trust levels, config discovery. | none |
| `agent` | `askAgent()` orchestration: pre-search, local tools, documents, one envelope. | loads `./ia` on demand |
| `ia` | Provider layer: OpenAI-compatible family, Anthropic, Google GenAI, plus remote MCP servers (HTTP and stdio). | `openai`, `@anthropic-ai/sdk`, `@google/genai`, `@modelcontextprotocol/sdk` |
| `tui` | Interactive terminal shell: history, menus, settings editor, themes and streaming. | `ink`, `react` |

### Video analysis

`analyzeVideo()` assembles frames and a transcript with the existing media
utilities, then calls `askAgent()` with a normal provider config. It is not tied
to a model or vendor:

```js
import { analyzeVideo, createSpeechToText } from "@rdsslab/agentkit";

const stt = createSpeechToText({ /* STT provider registry */ });

const result = await analyzeVideo({
  provider,              // any askAgent provider config
  video: videoBytes,
  stt,
  prompt: "Summarise the clip.",
  frameCaption: "Frames from the clip:",
  transcriptLabel: "Transcript:",
  strategy: "frames+stt", // or "frames", "stt", "native"
  framePlacement: "history", // or "prompt", "images"
});

// result.text, result.transcription, result.frames, result.meta
```

`strategy: "native"` requires a `nativeHandler` supplied by a provider adapter
that really accepts video; the core does not pretend Ollama exposes one.

### Automatic media attachments

`askAgent()` can also prepare media itself. Pass `attachments` and it converts
them before the provider call. By default audio/video use the STT registry
resolved from effective config (`stt` or `media.stt`) plus frames from ffmpeg.
With no STT configured, it degrades with a visible warning in
`result.media.warnings` and in the prompt instead of failing.

```js
const result = await askAgent({
  provider,
  prompt: "Summarise the attached material.",
  attachments: [
    { kind: "image", data: webpBytes, mimeType: "image/webp", name: "map.webp" },
    { kind: "document", data: pdfBytes, mimeType: "application/pdf", name: "notes.pdf" },
    { kind: "audio", data: wavBytes, mimeType: "audio/wav", name: "voice.wav" },
    { kind: "video", data: mp4Bytes, mimeType: "video/mp4", name: "clip.mp4" },
  ],
  media: { maxFrames: 6, language: "es" },
});

// result.media = { strategy, nativeMedia, stt, processed, warnings, frameCount, transcriptChars }
```

`images` and `documents` keep working exactly as before and are merged with the
attachments. See `tests/demo/ask5.js` for a runnable example.

#### Native audio/video (opt-in)

Nothing is inferred from a model name. The **host** declares what its provider
really accepts, and the adapter must also implement it:

```js
const provider = {
  provider: "google",
  model: "gemini-2.5-flash",
  apiKey,
  media: { audio: true, video: true }, // or capabilities: { media: { ... } }
};

// For a custom adapter name, point at the wire format it implements:
const custom = {
  provider: "my-gateway",
  model: "anything",
  media: { audio: true, adapter: "openai" }, // image/audio -> input_audio
};
```

`providerSupportedMedia()` (exported from the package) reports the adapter's
capabilities:

| Adapter | Native media |
| --- | --- |
| `google`, `gemini`, `google-gemini` | image, audio, video (`inlineData`) |
| `openai`, `openai-compatible`, `azure*`, `openrouter`, `groq`, `mistral`, `xai`, `deepseek` | image, audio (`input_audio`) |
| `anthropic`, `claude` | image, document (no audio/video) |
| `ollama`, `ollama-native` | image only |

A declared kind the adapter cannot send is **not** an error: it falls back to
the text/frames path and adds `NATIVE_MEDIA_UNSUPPORTED` to `warnings`. With
`media.onError: "throw"` it throws instead. `result.media.strategy` is `native`,
`fallback` or `mixed`, and `result.media.nativeMedia` shows what was declared
and what the adapter supports. Native audio/video never needs an STT server.
See `tests/demo/ask6.js`; `AGENT_DRY_RUN=1 node tests/demo/ask6.js` shows the
prepared payload without a network call or API key.

### The provider layer is loaded on demand

Importing the package does **not** load the provider SDKs. They are pulled in the
first time `askAgent()` runs, or when you import them explicitly:

```js
import { askIAWithProviderMCP } from "@rdsslab/agentkit/ia";
```

The provider is always explicit. This package never reads *provider credentials* from a
database, environment or config file: you pass `{ provider, model, apiKey, baseUrl }`.
The **TUI** reads global/project config so settings can be edited from the terminal.
The one library-level exception is media STT: `attachments` of kind `audio`/`video`
resolve `stt` from effective config (or from an injected `config`/`media.stt`).
`resolveConfigSecrets()` supports `env:VAR` references there. See `ask5.js`.

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
`documents`, `toolExecutions`, `hasTools`, `injectedContextChars`,
`injectedContext: { media, documents, web, tools }` and (optionally) `diagnostics`.
`injectedContextChars` counts exactly what `askAgent()` appends **after** the
caller builds the prompt (media captions, document/web recaps, tool results), so
the session can calibrate its own estimate against the provider's real
`prompt_tokens`.

### Streaming (opt-in)

`askAgent()` accepts an optional `onTextDelta(delta, meta)` observer. Without it,
the provider uses exactly the same non-streaming request path as before, so an
embedded deployment is unaffected.

```js
const answer = await askAgent({
  provider: { provider: "ollama", model: "qwen3.5:4b", baseUrl: "http://127.0.0.1:11434" },
  messages: [{ role: "user", content: "Write a short poem" }],
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

`onThinking(delta, meta)` is also available. It reports **real provider
reasoning** when the provider emits it (OpenAI `reasoning_content`, Ollama
`thinking`, Anthropic `thinking_delta`, Gemini thought parts) and activates
streaming on its own. Providers that do not emit reasoning simply produce no
events; the spinner based on the first `onTextDelta` still works.

## Stateful sessions

`askAgent()` is a function: it does not remember anything between calls, so a
multi-turn conversation must re-send the previous messages every time.
`AgentSession` keeps that history internally, searches it when the user asks
about the past and compacts it automatically:

```js
import { AgentSession } from "@rdsslab/agentkit";

const session = new AgentSession({
  provider: { provider: "ollama", model: "llama3.2", contextLength: 8192 },
  system: "You are a concise assistant.",
  memory: { mode: "hybrid", topK: 5, budget: 1800 },
  onEvent: (event) => console.log(event.type, event),
});

await session.ask("Hi, I am Ana");
await session.ask("What is my name?"); // the history is already inside the session
```

All notifications go through a single `onEvent({ type, at, turn, ...data })`:

| `type` | Useful payload |
| --- | --- |
| `context_warning` | `reason` (`context_threshold`, `incoming_turn_too_large`, `compaction_cooldown`), `usedPercent`, `contextLimit`, `estimatedTokens`, `thresholdPercent`, `incomingTokens`, `historyTokens`, `incomingShare`, `compactionSkipped`, `verified`, `message`, `preview` |
| `context_verified` | `source: "countTokens"`, `estimatedTokensBefore`, `usedPercentBefore`, `exactMessageTokens`, `injectedTokens`, `exactTokens`, `usedPercent` |
| `context_verification_failed` | `message`, `fallback: "heuristic"` (the decision is unchanged) |
| `context_overflow` | `usedPercent`, `promptTokens`, `contextLimit`, `injectedContextChars`, `injectedContext`, `message` |
| `compaction_start` | `reason`, `usedPercent`, `messagesBefore`, `preview`, `message` |
| `compaction_end` | `summaryChars`, `removedMessages`, `messagesAfter`, `usedPercentAfter`, `indexEpisodes`, `preview` |
| `recall` | `matches`, `mode`, `usedEmbeddings`, `embeddingReason`, `chars`, `scores`, `matchesPreview`, `preview` |
| `grounding` | `ok`, `unsupported`, `supported`, `sourceChars`, `checked`, `coverage`, `confidence`, `message` |
| `thinking` | `phase: "request"|"provider"`, `text`, `provider`, `model`, `round` |
| `answer_delta` | `text`, `provider`, `model`, `round` |
| `answer_text` | `text`, `chars`, `streamedChars` (only with `eventLevel: "compact"`) |
| `tool` | `phase: "start"|"finish"`, `tool`, `server`, `ok`, `durationMs` |
| `done` | `text`, `chars`, `usage`, `providerUsedPercent`, `providerTokensEstimated`, `injectedTokens`, `injectedContextChars`, `observedInjectionTokens`, `calibration`, `grounding`, `toolCount`, `mediaStrategy`, `usedPercent`, `preview` |
| `error`, `reset` | `code`, `message`, `phase` / `reason` |

**Compaction.** With a known context limit, reaching 90% (`context.thresholdPercent`,
default `90`) emits `context_warning`, then `compaction_start`, then
`compaction_end` in that order. After compaction the live history contains only
one `system` message with the summary; every previous turn is dropped, and the
search index is purged and reindexed with **only that summary** as episode.
`summarize(messages)` can be injected; by default the summary is deterministic
and makes no extra LLM call. Successive compactions produce **one flat, bounded
summary** (`context.maxSummaryChars`, default `2400`): no nested
`Previous summary` / `Recent turns` sections and no unbounded growth (legacy
Spanish headers from older summaries are still flattened). The incoming turn is
never added to the summary; it is re-sent as the next prompt.
If no context limit is known the session degrades silently (no threshold events),
exactly like `askAgent()`.

**Injected context.** `estimateMessagesTokens()` cannot see web/tool recaps,
documents or images appended later by `askAgent()`, so the session adds a
predicted `injectedTokens` to the threshold calculation. `done` also reports
`observedInjectionTokens` (provider `prompt_tokens` minus the local estimate)
when `includeDiagnostics: true`. Web queries are focused with proper nouns from
the memory recap and from attachment filenames, so "search for what you saw in
the image" becomes e.g. `Quito altitude park` instead of the raw instruction.
The noise filter is **structural, not a stopword list**: a capitalized word that
opens a sentence of the recap is harness scaffolding (`PREVIOUS MESSAGES…`,
`Based on…`, `However…`) and is discarded by its position; tokens from filenames
and from the user's own message are protected, so a word like `capital` is never
deleted just for appearing in a dictionary.

Both the deterministic pre-search recap and the model-driven `web_search` tool
result are capped by the free context of the current turn:
`context.injectionBudgetRatio` (default `0.6`) reserves part of the window for
the answer; tool results use the same idea with a `0.5` ratio and an estimated
2 chars/token for URLs and markdown. `injectedContext` breaks the total down by
`media`, `documents`, `web` and `tools`.

**Calibration.** `done.observedInjectionTokens` is `realPromptTokens − localPromptTokens`,
**with sign**: an overestimate is as useful as an underestimate. Each turn updates
an EMA (`session.calibration.delta`, `charsPerToken`, `imageTokens`, also exposed by
`stats()` and by `done.calibration`) that feeds the next prediction. The heuristic
starts at 4 chars/token for media/documents, 2 chars/token for web/tools and
384 tokens/image; the first real image from Ollama, for example, calibrated to
80 tokens. `calibration.byType` tracks samples, characters, tokens and a learned
chars/token ratio independently for `media`, `documents`, `web` and `tools`, so a
URL-heavy search does not distort the document estimate. A provider that reports
`context.estimated: true` is never used for calibration.

**Exact counting in the uncertainty band.** Pass `countTokens({ messages, text,
system, provider, signal }) -> { tokens }` (or `context.countTokens`) to replace the
heuristic only when the estimate falls between `context.verifyBandStartPercent` and
`verifyBandEndPercent` (defaults: `threshold − 20` and `threshold + 40`). It runs
**before** compaction, so a false alarm can be discarded: in the demo, 116.94% estimated
became 66.7% real and no compaction happened. The counter only sees the messages
built by the session, so its exact count is added to the predicted injections
rather than replacing them; `context_verified` reports both
`exactMessageTokens` and the final `exactTokens`. If the counter fails, the
heuristic is kept and `context_verification_failed` is emitted.

`createOllamaTokenCounter({ baseUrl, model })` (exported from the package) builds
this hook for Ollama: it uses `/api/tokenize` and, on versions such as 0.40.x where
that route is absent, reads `prompt_eval_count` from `/api/generate` with
`num_predict: 1`. If the provider accepts a prompt that is over its window, a
`context_overflow` event is emitted instead of calibrating in silence.

**Hysteresis.** `context.compactionCooldownTurns` (default `2`) prevents compacting on
consecutive turns unless `context.urgentCompactionPercent` (default `150`) is reached
or the provider reported `>= 98%` usage. If the incoming turn alone accounts for
`>= 70%` of the estimated messages and at least half the threshold, the warning uses
`reason: "incoming_turn_too_large"` and **no compaction** is attempted: dropping the
history would not free the tokens that are actually causing the overflow.

**Grounding.** When `usedWeb` is true, every number (>= 3 digits, with `2.850` and
`2850` treated as equal) and every proper noun asserted in the answer is compared
against the injected sources. `1. **City Altitude**:` is formatting, not a claim:
markdown markers and `Label:` headers are stripped before extracting entities.
The deterministic `checkGrounding()` helper (exported from the package) returns
`{ ok, unsupported, supported, sourceChars, checked, coverage, confidence }`.
`coverage` is the fraction of checked claims found in the sources and `confidence`
is `low`/`medium`/`high` based on coverage and source length; with no web sources
`ok`, `coverage` and `confidence` are `null`. No second LLM call is needed, so it
also works with tiny local models.

**Event volume.** `eventLevel: "full"` (default, backwards compatible) forwards every
`answer_delta` and provider `thinking` chunk. `eventLevel: "compact"` buffers them
and emits one `answer_text` when the turn ends; milestone events are unchanged.

**Memory.** Recall is only triggered when `looksLikeRecall(question)` matches
(Spanish and English phrasings such as "do you recall" or "what did we discuss").
Search is hybrid: lexical normalization (accents stripped) always works and
cosine similarity is added when embeddings are available. Embedding config is
read from the constructor first, then from the effective config
(`emb.providers` / `embeddings.providers` / `memory.embeddings`); if it is
missing or the request fails, search degrades to lexical and the event reports
`embeddingReason`. `env:VAR` secrets are resolved as in the rest of the config.
With an Ollama provider and no explicit config, `nomic-embed-text` is configured
automatically (`memory.autoEmbeddings: false` disables this). The recall event
also exposes `matchesPreview` (one short preview per retrieved episode), so a
consumer can verify that a specific fact was found.

```js
const session = new AgentSession({
  provider,
  memory: {
    embeddings: { provider: "ollama", model: "nomic-embed-text", baseUrl: "http://127.0.0.1:11434" },
  },
});
```

`session.compact()`, `session.reset()`, `session.history`, `session.summary`,
`session.memory` and `session.memory.stats()` are available for inspection.
See `tests/demo/ask7.js`; `node tests/demo/ask7.js` (dry-run by default) runs a
6-turn Q&A (image review → recall → web search about the image → direct internet
question about UNESCO → long turn that crosses the threshold → recall after
compaction) through the real `askAgent()` pipeline with a fake adapter and fake
`webSearchFn`, then asserts **26 behavioural checks** without a network call or
embedding requests. The startup banner says `MODE=SIMULATED · NO MODEL CALL`; a
real run prints `MODE=REAL MODEL CALL` with the provider and model. For a real
local model and real web search:

```sh
AGENT_PROVIDER=ollama AGENT_MODEL=minicpm-v4.6:16k \
  AGENT_CONTEXT_LIMIT=2048 AGENT_LONG_REPEAT=700 AGENT_WEB_TOOL=0 \
  node tests/demo/ask7.js
```

`AGENT_WEB_TOOL=0` disables model-driven web calls so the deterministic
`preSearch` owns the search; small models otherwise call the tool with a bad
query and inject thousands of tokens after compaction. In real mode the injected
web recap is capped at 1200 characters (override with `AGENT_WEB_CHARS`) so two
searches still fit a 2048-token context. With Ollama,
`AGENT_COUNT_TOKENS=1` (default) counts exact tokens in the uncertainty band:
it tries `/api/tokenize` and, on versions such as 0.40.x where that route is
absent, reads `prompt_eval_count` from `/api/generate` with `num_predict: 1`.
Set `AGENT_COUNT_TOKENS=0` to force the heuristic. The demo prints per-turn
latency, provider token counts, injection estimates, calibration, grounding and
the final compaction/count timeline.

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
// outcome.artifact -> { buffer, filename: "report-2026-11-17.pdf", mime: "application/pdf" }
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
