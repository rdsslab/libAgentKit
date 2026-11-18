# 02 - Get Machine IP (`run_command`)

## Objective
Validate that the harness can execute real system commands (`hostname -I`, `ip`) to obtain this machine's IP and return a coherent result.

## Prompt
> "Get this machine's IP address using commands and tell me its primary/local IP."

## Ground truth (direct)
`ground-truth.mjs` runs `hostname -I`, `ip -4 addr show`, `ip route get 1.1.1.1`. The primary/source IP is derived from the default route (`ip route get 1.1.1.1` → `src ...`).

## Harness configuration
- Provider: Ollama (default `qwen3:4b-instruct-8k`, override with `AGENTKIT_MODEL`)
- Capabilities: `{ terminal: true, filesystem: false, web: false, mcp: false, documents: true, artifacts: false }`
- Tool handler: `run_command` via `createTerminalTool({ allowedBinaries: ["hostname","ip","uname","cat","echo"], timeoutMs: 20000 })`
- `maxToolRounds: 5`, `includeDiagnostics: true`

See [`config.json`](./config.json).

## Run
```bash
node demo/02-get-ip/ground-truth.mjs
node demo/02-get-ip/run.mjs
AGENTKIT_MODEL=qwen3:0.6b-16k node demo/02-get-ip/run.mjs
AGENTKIT_MODEL=lfm3-omni:2b node demo/02-get-ip/run.mjs
```

## Outputs and metrics
Saved to `results/<model>/run-<timestamp>.json` and `latest.json`, including environment, config, task `durationMs`, `usage` (tokens, tokens/s, context used/limit/percent), tool executions (command/args/ok/result), ground truth and coherence comparison.

## Coherence criteria
- `run_command` executed successfully
- Response mentions the primary IP from ground truth (or a valid IP present in ground truth)
- Metrics captured
