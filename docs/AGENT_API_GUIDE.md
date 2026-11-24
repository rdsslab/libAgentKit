# Agent-facing API guide

This guide is a map of the public API an AI agent (or a service wrapping one) needs
to use AgentKit correctly. It complements [`README.md`](../README.md), which explains
the project and shows longer examples.

## Choose the entry point

| Need | Use |
| --- | --- |
| One isolated question, no memory between calls | `askAgent()` |
| Multi-turn conversation with recall and automatic compaction | `AgentSession` / `createAgentSession()` |
| Only the assistant text | `askAgentText()` (discards diagnostics) |

`askAgent()` is stateless: pass the full `messages` or `history` array on every call.
`AgentSession` owns that history and ignores `history`, `prompt`, `messages`, `onEvent`
and `onTextDelta` in `session.ask()`; all other `askAgent()` options pass through.

## Minimal call

```js
import { askAgent } from "@rdsslab/agentkit";

const answer = await askAgent({
  provider: {
    provider: "ollama",
    model: "qwen3.5:4b",
    baseUrl: "http://127.0.0.1:11434",
    contextLength: 8192,
  },
  system: "You are a concise assistant.",
  messages: [{ role: "user", content: "What is the capital of Ecuador?" }],
  tools: { web_search: true },
  preSearch: "auto",
});

console.log(answer.text);
```

The returned envelope always includes `text`, `usedWeb`, `webQuery`, `webResults`,
`webSource`, `webErrors`, `documents`, `media`, `toolExecutions`, `hasTools`, `mode`,
`usage`, `injectedContextChars` and `injectedContext`. With `includeDiagnostics: true`
it also includes the raw provider diagnostics under `diagnostics`.

## Deterministic web search

Pre-search is owned by the harness and runs before the model call; it is the reliable
path for small local models. Set `preSearch: "always"` to force it, `false` to disable
it, or keep `"auto"` to detect explicit search requests and URLs. The model-driven
`web_search` tool can still run when `tools.web_search` is enabled.

For offline tests or CI, inject the search function instead of using the network:

```js
const answer = await askAgent({
  provider,
  prompt: "Which UNESCO site is in Quito?",
  preSearch: "always",
  webSearchFn: async ({ query }) => ({
    ok: true,
    query,
    source: "fixture",
    results: [
      { title: "Quito", url: "https://example.test/quito", snippet: "UNESCO World Heritage Site" },
    ],
  }),
});
```

`webSearchFn` receives the merged web-search config, so `webSearch.query`,
`maxResults` and `signal` arrive in the same object. Use `createWebSearch(defaults)`
when several calls should share the same provider/timeout settings.

## Stateful sessions and events

```js
import { AgentSession } from "@rdsslab/agentkit";

const session = new AgentSession({
  provider,
  system: "You are a concise assistant.",
  memory: { mode: "hybrid", topK: 5, budget: 1800 },
  context: { thresholdPercent: 90, maxSummaryChars: 2400 },
  onEvent: (event) => handle(event),
});

await session.ask("Hi, I am Ana");
await session.ask("What is my name?");
```

Every notification uses one callback: `onEvent({ type, at, turn, ...data })`.
`type` is the discriminator. The most useful values are:

- `recall` — memory lookup result, including `usedEmbeddings` and `embeddingReason`.
- `context_warning`, `context_verified`, `context_overflow` — context decisions.
- `compaction_start`, `compaction_end` — history replacement and index purge.
- `grounding` — deterministic check of answer claims against injected web sources.
- `tool`, `thinking`, `answer_delta` — incremental activity in the default `full` mode.
- `answer_text` — one buffered answer in `eventLevel: "compact"`.
- `done`, `error`, `reset` — terminal states.

`eventLevel` defaults to `"full"`. Set `"compact"` when the consumer only needs
milestones: deltas are buffered into a single `answer_text` event, which is emitted
even if the provider sent no deltas.

After compaction, the live history is exactly `[system, summary]` and the memory index
is rebuilt with only that summary. The summary is flat and bounded; repeated
compactions do not nest older summaries.

## Memory and recall

`MemoryStore` is in-memory only: no filesystem or database. Lexical search always
works. Cosine similarity is added when an embedding provider is configured or
auto-detected (Ollama defaults to `nomic-embed-text`, disable with
`memory.autoEmbeddings: false`). `stats().embeddingReason` explains degradation.

```js
import { MemoryStore } from "@rdsslab/agentkit";

const memory = new MemoryStore({ mode: "hybrid", topK: 5, budget: 1800 });
await memory.addTurn("My dog is called Luna", "Noted.");
const found = await memory.search("What is my dog's name?");
```

Use `session.ask(text, { recall: false })` to skip the lookup for a turn.

## Capabilities and tools

Capabilities fail closed. `normalizeCapabilities()` fills missing categories; embedded
hosts default to disabling `terminal` and `filesystem`, while interactive hosts enable
all of them. A per-tool override wins over its category gate.

```js
import {
  applyCapabilitiesToToolHandlers,
  normalizeCapabilities,
  resolveToolCapability,
} from "@rdsslab/agentkit";

const caps = normalizeCapabilities({ terminal: false, tools: { run_command: false } });
const handlers = applyCapabilitiesToToolHandlers(myHandlers, caps);
const verdict = resolveToolCapability("web_search", caps);
```

Denied tools return a structured error (`ok: false`, `code`, `capability`, `tool`,
`userMessage`) instead of executing.

## Media and documents

Pass `attachments` for images, documents, audio and video. Each item is `{kind, data,
mimeType, name}`; `kind` can be inferred from MIME type or filename. Images are
always native. Documents are extracted to text in memory.

Audio and video use STT from the effective config (`stt` or `media.stt`) or an explicit
`media.stt` instance. If no STT provider is configured, the default path degrades with
a visible warning instead of failing the turn. Native audio/video is opt-in: declare it
in `provider.media` or `provider.capabilities.media`, and ensure
`providerSupportedMedia(provider)` includes the kind. Otherwise frames + transcript
are used.

## Config and presets

`loadEffectiveConfig()` merges global config (under the OS config dir) and the nearest
project `agentkit/config.json`; project values win. Secrets written as `env:VAR` are
resolved by `resolveConfigSecrets()` before a provider is created.

`MODEL_PRESETS` and `getModelConfig(model, taskType, overrides, baseUrl)` provide
sampling defaults and system prompts for `chat`, `code`, `web`, `longContext` and
`reasoning`. `listPresetTaskTypes()` lists them at runtime.

## Provider layer and lower-level helpers

`askAgent()` is the recommended entry point. Import `@rdsslab/agentkit/ia` only when
you need the raw provider call: `askIAWithProviderMCP()` takes provider-ready
`prompts` and applies no policies, memory, grounding, web search or compaction.
It returns the provider diagnostics envelope with `text` and `toolExecutions`.
`AI_PROVIDER_PRESETS` lists built-in provider defaults; `registerAIProviderAdapter()`
and `createAIProviderAdapter()` extend or select an adapter.

Binary and document helpers are also public:

- `toBuffer()`, `toDataUrl()` and `normalizeBinaryDescriptor()` normalise host payloads.
- `extractDocumentText()` and `DocumentReader` read PDFs, DOCX and text formats in memory.
- `MCP_TRUST_LEVELS` and `DEFAULT_TRUST_LEVEL` make MCP trust explicit; project config
  is not loaded unless the host opts in.

## Purity and determinism checklist

For a reproducible agent run:

1. Use a fixed `seed` and low `temperature` in the provider config.
2. Inject `webSearchFn` instead of calling a live search engine.
3. Pass `config` explicitly so config files on the host cannot change behavior.
4. Set `memory.autoEmbeddings: false` unless the embedding model is pinned.
5. Set `eventLevel: "compact"` if the consumer only needs milestones.
6. Keep `eventLevel: "full"` while debugging streaming or tool activity.

## Related documentation

- [`README.md`](../README.md) — install, feature tour and longer examples.
- [`CHANGELOG.md`](../CHANGELOG.md) — behavioral changes and compatibility notes.
- [`tests/e2e/07-web-search/README.md`](../tests/e2e/07-web-search/README.md) — web-search fixtures and runs.
- [`graphify-out/GRAPH_REPORT.md`](../graphify-out/GRAPH_REPORT.md) — code map and god nodes.
