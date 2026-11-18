# 06 - Current President of Ecuador (`web_search`)

## Objective
Validate that the harness can find current, time-sensitive information via web search and return a coherent answer.

## Prompt
> "Who is the current president of Ecuador? Answer with the name and cite the source found."

## Ground truth (direct)
`ground-truth.mjs` runs a direct web search for "current president of Ecuador" and saves results. As of 2026, the expected answer is **Daniel Noboa** (verify against saved ground truth/sources at run time).

## Harness configuration
- Provider: Ollama (default `qwen3:4b-instruct-8k`, override with `AGENTKIT_MODEL`)
- Capabilities: web enabled, terminal/filesystem/mcp/artifacts disabled
- Tools: `{ web_search: true }`
- `maxToolRounds: 5`, `includeDiagnostics: true`

See [`config.json`](./config.json).

## Run
```bash
node demo/06-current-president-ecuador/ground-truth.mjs
node demo/06-current-president-ecuador/run.mjs
AGENTKIT_MODEL=qwen3:0.6b-16k node demo/06-current-president-ecuador/run.mjs
AGENTKIT_MODEL=lfm3-omni:2b node demo/06-current-president-ecuador/run.mjs
```

## Outputs and metrics
`results/<model>/run-<timestamp>.json` and `latest.json` include environment, config, task duration, usage (tokens, tokens/s, context used/limit/percent, rounds), web/tool diagnostics, ground truth and coherence comparison.

## Coherence criteria
- Answer identifies Daniel Noboa (or the correct current president per ground truth/sources)
- Web evidence/source present
- Metrics captured
