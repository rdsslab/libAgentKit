# Changelog

All notable versions of this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **Agent-facing API guide**: [`docs/AGENT_API_GUIDE.md`](docs/AGENT_API_GUIDE.md) maps
  `askAgent()`, `AgentSession`, events, memory, capabilities, media, config and
  deterministic web search for AI consumers. Public functions and methods across the
  core modules, config, documents, buffers, provider layer, MCP and utilities now
  carry parameter and return JSDoc.
- **Hybrid memory and recall in `AgentSession`**: lexical search always works; cosine
  similarity is added when embeddings are available. With an Ollama provider and no
  explicit config, `nomic-embed-text` is configured automatically
  (`memory.autoEmbeddings: false` disables this). The `recall` event exposes
  `matchesPreview` per retrieved episode and both Spanish and English recall phrasings
  are recognised.
- **Context calibration and verification**: `calibration.byType` tracks chars/token
  independently for `media`, `documents`, `web` and `tools`. `countTokens` runs only
  in the uncertainty band and its exact message count is added to predicted
  injections; `createOllamaTokenCounter()` provides the `/api/tokenize` →
  `prompt_eval_count` fallback. A provider-reported overflow emits `context_overflow`.
- **Bounded injections**: web/tool recaps are capped by the free context of the turn
  (`context.injectionBudgetRatio`, default `0.6` for pre-search; tool results use
  `0.5`). `injectedContext` breaks the total down by source type.
- **Grounding**: `checkGrounding()` (exported) returns `coverage` and `confidence`
  in addition to `ok`/`unsupported`; the deterministic check needs no second LLM call.
- **Compaction hysteresis**: `compactionCooldownTurns` (default `2`) and
  `urgentCompactionPercent` (default `150`) prevent cascading compactions. An
  oversized incoming turn emits `incoming_turn_too_large` and skips compaction.
- **Compact event mode**: `eventLevel: "compact"` buffers deltas into one
  `answer_text` event, which is emitted even when the provider sends no deltas.
- **Reproducible demo**: `tests/demo/ask7.js` runs a six-turn conversation (image →
  recall → web search → direct internet question → long turn → recall after
  compaction) through the real `askAgent()` pipeline, with 26 behavioural checks
  in offline dry-run mode and optional exact token counting with local Ollama.
  A startup banner makes it explicit whether the run calls a real model or is
  simulated, with `mode=fake|real` printed on every web turn.
- **Interactive TUI (`npm run tui`)** on top of the existing engine (`askAgent`), with
  no second runtime: header with the real `cwd`/branch, scrollable history, multiline
  editor, `Ctrl+P` palette and `/` commands, turn state, `Esc`/`Ctrl+C` cancellation,
  terminal restoration and a TTY guard (no TTY exits with code 2 and a plain message).
- **Settings editable in the terminal**: providers (`ollama`, `openrouter`, `openai`,
  `openai-compatible`), model, base URL, token, mode, language, theme, capabilities,
  compaction and remote MCP servers (add, edit, trust toggle, remove). Global save
  (`0600`, masked tokens or `env:VAR`) and project save (`stripSecrets()`).
- **Two themes**, dark and light, and an optional side panel with usage, tools and
  recent files.
- **`@` to attach files** under `cwd`, plus engine approvals/questions handled in
  the TUI.
- **Optional streaming**: `onTextDelta` on `askAgent`, `askIAWithProviderMCP` and the
  OpenAI-compatible/Anthropic/Google adapters, with a fallback to the non-streaming
  path. Without a callback, the embedded path is unchanged. `onToolStart`/
  `onToolFinish` are additional observers.
- **New suites**: `tui_test.js`, `tui_engine_test.js`, `streaming_test.js` and
  `tui_pty_test.js`; `test:tui` script.

### Changed

- `writeJsonFile` accepts `mode`; `saveGlobalConfig` writes the global config with `0600`.
- `src/index.js` exports `GLOBAL_CONFIG_MODE`, `resolveSecretReference`,
  `resolveConfigSecrets`, `checkGrounding` and `createOllamaTokenCounter`.

### Notes

- Agent management and a diff viewer are not implemented: they remain future requests
  in [issue #1](https://github.com/rdsslab/libAgentKit/issues/1) and
  [issue #2](https://github.com/rdsslab/libAgentKit/issues/2).
- `Esc` aborts the model request; a child already started by `run_command` still follows
  its own timeout.

### Verified

- `npm test` (8/8 suites); offline demo 26/26 checks.

---

## [0.4.0] - 2026-11-18

### Added

- **Reproducible demo suite (`demo/01`–`demo/07`)** with per-model runs, captured
  environment/metrics and result documentation.
  - Per test/run, total and per-step duration, token usage
    (`prompt/completion/total`), `tokens_per_second`, `timing_ms`, context
    (`used/limit/percent/estimated`), rounds, tool/web diagnostics and
    validation/coherence are recorded.
  - Documentation artifacts: `demo/RESULTS.md` (pre/post-improvement comparison, by
    model/test), `demo/_results/index.json`, `demo/_results/environment.json` and
    timestamped runs plus `latest.json`.

### Changed

- **More generic and robust tool harness (no task-specific hardcoded logic):**
  - `src/terminal.js` (`run_command`): safe normalisation/tokenisation of malformed
    calls when a full line is passed in `command` (e.g. `"ip route get 1.1.1.1"`)
    into `{command,args}` **without a shell** (`spawn` with argv). Allowlist, binary
    resolution, `cwd/roots` restrictions, approval/validation hooks, secret
    redaction, time/output limits and auditing are preserved; normalisation info is
    exposed for diagnostics.
  - `src/ia.js`: recoverable handling of unknown tools (a structured error with
    guidance and the available tools instead of aborting), generic mapping of
    binary-like names to `run_command` when available, truncation of large tool
    results to reduce context pressure, and a partial result with diagnostics/metrics
    (including `usage` when available) on `max_tool_rounds_exceeded` in supported paths.
  - `src/agent.js`: budget/truncation of injected context (document recaps and
    deterministic web pre-search, configurable) and propagation of diagnostic/execution
    signals (e.g. `incomplete`, `reason`) for better observability.
- **Web search (`src/websearch.js`)**: query normalisation, detection of
  anomaly/anti-bot/challenge pages to improve fallback, better provider/config
  handling and `providersTried` reporting.
- **API/exports and configuration**: additional exports in `src/index.js` and support
  modules (`capabilities`, `config`, `clipboard`, `compaction`, `i18n`, `ollama`, `tui`)
  included in the work tree, along with adjustments to buffers/documents/artifacts and
  tests.

### Fixed

- Better tolerance for malformed tool calls and better evidence preservation (partial
  executions, usage and diagnostics) in long loops or when rounds are exhausted.

### Verified

- `npm test` (4/4 suites) after the harness changes.
- Post-improvement rerun of `demo/01`–`demo/07` (sequential, three local models):
  `qwen3:0.6b-16k` (2/7 failures), `lfm3-omni:2b` (1/7),
  `qwen3:4b-instruct-8k` (1/7), with targeted improvements in tool use/recall and
  documented variability/regressions in `demo/RESULTS.md`.

---

## [0.3.0] - 2026-11-18

### Added

- **MCP transport over stdio**: a local MCP server starts as a child process and is
  spoken to over stdin/stdout. The transport is imported on demand, so an HTTP-only
  deployment does not pay for it.
  - Input: `{ command, args, env, cwd }`. The child environment is the transport's
    (`getDefaultEnvironment`) plus what the config declares, not the host's.
  - Child stderr is ignored: a noisy MCP server does not pollute the host log.
- **Per-server trust levels**: `trusted` (default), `untrusted` and `disabled`.
  - `trusted`: tools are offered to the model and run automatically.
  - `untrusted`: tools are offered, but **every call** needs the host's decision via
    `approveToolCall`. Without an approval hook the call is refused: it fails closed,
    because "nobody is watching" is not a decision.
  - `disabled`: the server is not connected and its tools are never exposed.
- **`approveToolCall` hook**: receives `{ serverName, toolName, toolAlias, arguments }`
  and returns `true`/`false` (or `{ approved: true }`). Wired into `askAgent`,
  `askIAWithMCP`, `askIAWithProviderMCP` and `AIProviderMCPClient`.
  - A refused call never reaches the server: it is recorded as a failed execution
    (`TOOL_CALL_NOT_APPROVED`) and the model receives the reason.
- **`src/mcp.js` module**: MCP server configuration.
  - `normalizeMcpServer` / `normalizeMcpServers`: normalise name, transport, URL,
    command, arguments, environment, headers and trust level. An entry without a name
    gets the URL hostname or the command basename.
  - `findMcpConfig` / `loadMcpConfig` / `loadMcpServers`: config file reading.
  - `describeTrust`: human-readable description of each level.
- **Config file** (`~/.config/agentkit/config.json` by default):
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
  - Project config (`agentkit.config.json` or `.agentkit/config.json`) is **not**
    loaded unless the host opts in with `allowProjectConfig: true`: a repository can
    carry one, and a repository is not a trust boundary.
  - Invalid JSON reports the exact file path.

### Changed

- `ia.js` delegates server normalisation to `mcp.js`: one rule for name, transport and
  trust instead of two that could diverge.
- The server catalog and diagnostics now include `command` and `trust`, so a stdio
  server no longer appears with `url: null` and no trust level.

### Verified

- `dev/test/mcp_test.js`: 15 checks (trust levels, entry/map normalisation, config
  reading, invalid JSON, project config ignored by default and with explicit opt-in,
  user config, a real stdio server connected with its tools listed, a `disabled`
  server not connected, an HTTP entry without a URL with a clear error, and four
  model-driven tool-call checks: `trusted` runs, `untrusted` without a hook fails
  closed, `untrusted` approved runs, `untrusted` refused does not run).

---

## [0.2.0] - 2026-11-17

### Added

- **`run_command` tool**: runs a binary in the terminal. Inert by default: without an
  allowlist every call is refused.
  - **No shell, ever**: `spawn(bin, args, { shell: false })`. `;`, `|`, `&&` and
    backticks arrive as literal arguments, not syntax.
  - **Binary allowlist**: a name allows that binary; an absolute path allows exactly
    that file. Names resolve through a restricted PATH
    (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`).
  - **No environment leakage**: the child does not inherit `process.env`; it gets a
    restricted PATH, `HOME` and the locale, plus whatever the host passes explicitly.
    Host credentials never reach the command.
  - **Approval**: `approve()` can veto each command.
  - **Limits**: timeout (30 s by default, then SIGKILL), output cap (256 KB) and a
    maximum of 10 commands per turn.
  - **Secret redaction** in output: `sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, bearer
    tokens, JWTs, private-key blocks and `*_TOKEN=…` assignments, plus any literal the
    host registers.
  - **Audit**: `onAudit()` receives every decision, including refusals.
  - Argument validation (`validateArgs`) and working-directory restriction
    (`allowedRoots`).
- **`runProcess` accepts `env` and `cwd`**: the low-level wrapper no longer depends on
  inheriting the process environment.

### Verified

- `dev/test/terminal_test.js`: 21 checks (inert tool without an allowlist, disallowed
  binary, nominal absolute path, no shell, full command line refused, host secrets
  absent in the child, timeout, output cap, redaction, approval hook, validation hook,
  audit hook, per-turn limit, restricted working directory).

---

## [0.1.0] - 2026-11-17

### Added

- **New repository**: the agent harness leaves `libOpenFusionAPI` (where it lived as
  `src/lib/server/agentKit/` in 14.3.x) and becomes a standalone package,
  `@rdsslab/agentkit`, distributed by git URL.
  - This repository is the **single source of truth** for the harness.
    `libOpenFusionAPI` consumes it as a dependency and re-exports it, so its public
    API does not change.
  - Reason for the extraction: the harness was tied to the platform's release cycle
    (DB migration → Docker rebuild → deployment), which is not the cadence a library
    consumed by bots, CLIs and agents needs.
- **`artifacts` module with the `create_file` contract**: generates PDF, image, HTML,
  text, JSON, Markdown and CSV.
  - The renderer is injected by the host (`renderPdf`, `renderImage`): the package does
    not depend on Chromium and installation stays light.
  - `loadDefaultRenderer()` starts its own renderer with `puppeteer-core` and
    `@sparticuz/chromium` via dynamic import, only if the host installed them.
  - Without a renderer, the tool responds with `ARTIFACT_RENDERER_UNAVAILABLE` instead
    of failing silently.
- **Artifact test suite** (`dev/test/artifacts_test.js`): text formats, valid and
  invalid JSON, HTML, truncation, empty content, injected renderer, renderer failure
  and tool contract.

### Changed

- **Provider layer (`ia.js`) loaded on demand**: importing the package no longer pulls
  in the OpenAI, Anthropic, Google GenAI and MCP SDKs. They load the first time
  `askAgent()` runs or when imported explicitly via `@rdsslab/agentkit/ia`. The core
  (policies, buffers, web search) stays free of provider dependencies.
- **`pdfjs-dist` is imported when a PDF is extracted, not when the package loads**: the
  legacy pdfjs bundle costs ~670 ms at load time. Importing the package went from
  693 ms to 24 ms; the cost is paid once, on the first PDF extraction.
- **`safeFileName` hardened**: `..` and `.` are rejected and replaced with the default
  name. Previously they could pass as filenames and, if the host concatenated them
  with a directory, the write escaped it.
- **MCP protocol client names** aligned with the package (`agentkit-runtime` instead
  of `openfusion-ia-runtime`).
- **Node.js requirement clarified: 22 or newer**. `pdfjs-dist` v6 uses
  `Promise.withResolvers`, absent in Node 20; on that runtime PDF reading failed with a
  message blaming the PDF ("looks damaged or protected") instead of the runtime. The
  error now states exactly that Node 22 is missing (`PDF_RUNTIME_UNSUPPORTED`).

### Verified

- `dev/test/agentkit_test.js` (hermetic: no network, no DB, no credentials) and
  `dev/test/artifacts_test.js` passing.
- Inherited behaviour unchanged: the multilingual recall and web-search policies,
  search parsers, document extraction, STT/TTS registries and video frame extraction
  are the same as in `libOpenFusionAPI` 14.3.2.

---

[0.1.0]: https://github.com/rdsslab/libAgentKit/releases/tag/v0.1.0
