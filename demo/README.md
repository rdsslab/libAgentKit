# AgentKit – Demos and Reproducible Tests

This folder contains documented tests to validate the `@rdsslab/agentkit` harness with local Ollama models and compare results against direct (ground truth) executions.

## Objectives
- Measure harness capabilities and synergy with different AI models.
- Capture **all available metrics** per task: total task duration, token usage, tokens/s, context used/limit/percent/estimated, tool rounds/executions, web diagnostics, coherence.
- Record **machine/environment characteristics** where tests run (CPU, cores, RAM/swap, disk, GPU, OS/kernel, Node/npm, Ollama).
- Compare model performance/quality (e.g. `qwen3:4b-instruct-8k`, `qwen3:0.6b-16k`, `lfm3-omni:2b`).
- Identify optimization opportunities for better performance and answer quality despite model/context limitations.

## Prerequisites
- Node.js >= 22
- Project dependencies installed (`npm install`)
- Ollama running (default `http://127.0.0.1:11434`) with required models pulled
- Network access for web/curl/GitHub tests as applicable

## Common configuration
- Model: `AGENTKIT_MODEL` (default `qwen3:4b-instruct-8k`)
- Ollama base URL: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- Provider timeout: `AGENTKIT_TIMEOUT_MS` (default 600000 ms; some demos use 900000 ms)
- Results are saved to `demo/<test>/results/<model>/run-<timestamp>.json` and `latest.json`

## Test suite
| # | Folder | Description |
|---|---|---|
| 01 | `01-web-search/` | Web search: capital of Ecuador |
| 02 | `02-get-ip/` | Run command: get machine IP |
| 03 | `03-curl-local/` | Run command: curl `http://192.168.100.126:3000` |
| 04 | `04-codegen-landing/` | Code generation: simple landing page with animated buttons |
| 05 | `05-github-search-save-md/` | Two-step: find `edwinspire` on GitHub and save `.md` to disk |
| 06 | `06-current-president-ecuador/` | Web search: current president of Ecuador |
| 07 | `07-jesus-landing-page/` | Two-step: research who Jesus was and create/save an interactive professional landing page |

Each test folder includes: `README.md`, `config.json`, `run.mjs`, `ground-truth.mjs` (where applicable), `results/` (ground truth + per-model runs with full metrics), and `output/` for generated artifacts.

## Run
```bash
# environment snapshot
node --input-type=module -e "import {getEnvironmentInfo} from './demo/_lib/env.mjs'; import fs from 'node:fs/promises'; const e=await getEnvironmentInfo(); await fs.mkdir('demo/_results',{recursive:true}); await fs.writeFile('demo/_results/environment.json', JSON.stringify(e,null,2)); console.log('saved demo/_results/environment.json')"

# run a single test
node demo/01-web-search/run.mjs

# run with specific models for comparison
AGENTKIT_MODEL=qwen3:4b-instruct-8k node demo/01-web-search/run.mjs
AGENTKIT_MODEL=qwen3:0.6b-16k node demo/01-web-search/run.mjs
AGENTKIT_MODEL=lfm3-omni:2b node demo/01-web-search/run.mjs

# run all tests sequentially (can take a long time on CPU/local models)
node demo/run-all.mjs
```

## Metrics captured per run
- **Task timing:** `harness.durationMs` (and per-step timing where applicable)
- **Token/usage:** `prompt_tokens`, `completion_tokens`, `total_tokens`, `tokens_per_second`, `timing_ms`, `rounds`
- **Context:** `context.used_tokens`, `context.limit_tokens`, `context.used_percent`, `context.estimated`
- **Tooling/web:** tool executions (name, ok, args, result summary, duration), `usedWeb`, `webQuery`, `webResults`, `webErrors`, providers tried
- **Quality/coherence:** comparison checks vs ground truth/direct execution and artifact validation
- **Environment:** OS/kernel, CPU model/cores, RAM/swap, disk, GPU, Node/npm, Ollama version/models

## Reports
- Consolidated report: [`RESULTS.md`](./RESULTS.md)
- Results index: [`_results/index.json`](./_results/index.json)
- Environment snapshot: [`_results/environment.json`](./_results/environment.json)

> Notes: Web/API results and current-information answers are time-dependent; ground truths and timestamped runs are stored for reproducibility. Small local models may show variability in tool choice, reasoning, and output quality.
