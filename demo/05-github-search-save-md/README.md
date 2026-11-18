# 05 - Two-Step: GitHub Search and Save Markdown

## Objective
Validate a two-step conversational flow with the same context:
1. Find who `edwinspire` is on GitHub.
2. Using the information found, save a `.md` file to disk.

## Requests (turns)
- **Step 1:** "Find who edwinspire is on GitHub. Use run_command with curl to https://api.github.com/users/edwinspire to get the profile and give me a summary (username, name, bio, location, public repos, followers, profile link)."
- **Step 2:** "Using the information you found about edwinspire on GitHub, save a Markdown file to disk named `edwinspire-github.md` with that information (...) Use write_file."

## Tools available
- `run_command` (allowlist: `curl`, `cat`, `echo`) to query APIs like `https://api.github.com/users/edwinspire`
- `web_search` (enabled)
- `write_file` (custom handler provided by `run.mjs`): writes files to `demo/05-github-search-save-md/output/<model>/` and also updates `output/` latest copy

> Note: disk persistence is done via the custom `write_file` tool included in the demo script to make the test reproducible.

## Ground truth
`ground-truth.mjs` queries `https://api.github.com/users/edwinspire` and saves `results/ground-truth.json` (login, name, location, public repos, followers, profile URL).

## Harness configuration
- Provider: Ollama (default `qwen3:4b-instruct-8k`, override with `AGENTKIT_MODEL`)
- `mode: "build"`, `interactive: true`
- `maxToolRounds: 6` per turn
- Multi-turn conversation: step 1 result is added to history before step 2

See [`config.json`](./config.json).

## Run
```bash
node demo/05-github-search-save-md/ground-truth.mjs
node demo/05-github-search-save-md/run.mjs
AGENTKIT_MODEL=qwen3:0.6b-16k node demo/05-github-search-save-md/run.mjs
AGENTKIT_MODEL=lfm3-omni:2b node demo/05-github-search-save-md/run.mjs
```

## Outputs and metrics
- `results/<model>/run-<timestamp>.json` and `latest.json`: both steps with prompts, per-step harness results, **duration and usage metrics (tokens, tokens/s, context used/limit/percent, rounds)**, tool executions, comparison, environment
- `output/<model>/edwinspire-github.md` (+ stamped copy) and `output/edwinspire-github.md` (latest)

## Coherence criteria
- Step 1 identifies `edwinspire` with key profile data consistent with ground truth
- Step 2 uses `write_file` and produces a `.md` on disk with profile information
- Metrics captured for both steps
