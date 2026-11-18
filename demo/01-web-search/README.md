# 01 - Web Search (`web_search`)

## Objective
Validate that the harness can use `web_search` to answer a factual query and compare with a direct `webSearch()` call.

## Prompt
> "Search the internet: what is the capital of Ecuador? Answer with the capital and the source found."

## Ground truth (direct)
`ground-truth.mjs` runs `webSearch({ query: "capital of Ecuador", maxResults: 5 })` and saves `results/ground-truth.json`. Expected coherent answer: **Quito** (capital of Ecuador), with sources such as Wikipedia.

## Harness configuration
- Provider: Ollama (default `qwen3:4b-instruct-8k`, override with `AGENTKIT_MODEL`)
- Base URL: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- `mode: "build"`, `interactive: true`
- Capabilities: `{ terminal: false, filesystem: false, web: true, mcp: false, documents: true, artifacts: false }`
- Tools: `{ web_search: true }`
- `maxToolRounds: 5`, `includeDiagnostics: true`
- Provider timeout: `AGENTKIT_TIMEOUT_MS` (default 600000 ms)

See [`config.json`](./config.json).

## Run
```bash
# direct ground truth
node demo/01-web-search/ground-truth.mjs

# harness + LLM (saves to results/<model>/run-<timestamp>.json and latest.json)
node demo/01-web-search/run.mjs

# run with another model for comparison
AGENTKIT_MODEL=qwen3:0.6b-16k node demo/01-web-search/run.mjs
AGENTKIT_MODEL=lfm3-omni:2b node demo/01-web-search/run.mjs
```

## Outputs and metrics
Each run result includes:
- `environment`: machine specs (OS/kernel, CPU, cores, RAM/swap, disk, GPU, Node/npm, Ollama version/models)
- `config`: provider/model, mode, tools, capabilities, timeout
- `harness.durationMs`: total task time
- `harness.usage`: `prompt_tokens`, `completion_tokens`, `total_tokens`, `tokens_per_second`, `timing_ms`, `context.{used_tokens,limit_tokens,used_percent,estimated}`, `rounds`
- `harness.toolExecutions`, `usedWeb`, `webQuery`, `webResults`, `webErrors`
- `groundTruth` and `comparison` (coherence checks)

## Coherence criteria
- `harness.ok === true`
- Answer mentions Quito as capital of Ecuador
- Web evidence available (`usedWeb` or relevant direct results)
- Metrics present
