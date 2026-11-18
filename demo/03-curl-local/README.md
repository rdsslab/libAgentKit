# 03 - Curl Local Service (`run_command`)

## Objective
Validate that the harness can execute `curl` against a local service (`http://192.168.100.126:3000`) and report a coherent result (HTTP status, content-type, service/page).

## Prompt
> "Run curl against http://192.168.100.126:3000 and summarize the response (HTTP status code, content-type, and what service/page it appears to be)."

## Ground truth (direct)
`ground-truth.mjs` runs `curl -sS -m 8 -i http://192.168.100.126:3000` and saves parsed status/content-type/title. Observed: `HTTP/1.1 200 OK`, `content-type: text/html; charset=utf-8`, title "OpenFusion API | Low-Code, AI-Friendly API Platform".

## Harness configuration
- Provider: Ollama (default `qwen3:4b-instruct-8k`, override with `AGENTKIT_MODEL`)
- Capabilities: `{ terminal: true, filesystem: false, web: false, mcp: false, documents: true, artifacts: false }`
- Tool handler: `run_command` via `createTerminalTool({ allowedBinaries: ["curl","cat","echo"], timeoutMs: 20000 })`
- `maxToolRounds: 4`, provider timeout default 900000 ms (`AGENTKIT_TIMEOUT_MS`)

**Context note:** fetching full HTML with `curl -i` can overflow small model contexts (e.g. ~14k tokens vs 8k). The run prompt guides the model to prefer `curl -I` (headers) while still targeting the same URL and reporting status/content-type/service.

See [`config.json`](./config.json).

## Run
```bash
node demo/03-curl-local/ground-truth.mjs
node demo/03-curl-local/run.mjs
AGENTKIT_MODEL=qwen3:0.6b-16k node demo/03-curl-local/run.mjs
AGENTKIT_MODEL=lfm3-omni:2b node demo/03-curl-local/run.mjs
```

## Outputs and metrics
Results saved to `results/<model>/run-<timestamp>.json` and `latest.json` with environment, config, duration, usage (tokens/tokens-per-second/context used/limit/percent/rounds), tool executions, ground truth and comparison.

## Coherence criteria
- `run_command` executed successfully
- Response mentions HTTP 200 and `text/html` (and/or identifies the service coherently)
- Compared against direct curl ground truth
