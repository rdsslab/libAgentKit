# E2E-07: Web search

Verifies that the core agent can search the web, inject a deterministic recap
before the model call, and ground the answer in the returned sources.

## Requirements

- Node.js 22 or newer
- Ollama running at `http://127.0.0.1:11434` for live mode
- Model `qwen3:0.6b-16k` or similar
- Internet access for real search results

## How to run

```bash
# Live mode (Ollama + real search)
node run.mjs

# Offline mode (fake adapter + fake search results, no network)
node run.mjs --dry
AGENT_DRY_RUN=1 node run.mjs
```

## What it checks

- deterministic `preSearch` injects a `WEB SEARCH RESULTS` recap before the model
- the recap and its token cost are reported in `injectedContext`
- queries are trimmed before being sent to the search provider
- `checkGrounding()` returns `ok`, `coverage`, `confidence` and `unsupported`
- in live mode, the model-driven `web_search` tool is also exercised

The offline mode is deterministic and exits with code 1 if any check fails.
