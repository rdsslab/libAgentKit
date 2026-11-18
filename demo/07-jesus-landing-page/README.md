# 07 - Research and Create Interactive Professional Landing Page

## Objective
Validate harness synergy on a multi-step, multi-capability task: search who Jesus was, then create an interactive, professional-looking landing page with that information and save it to disk.

## Requests (steps)
- **Step 1 (research):** "Search who Jesus was (historical/religious figure) and provide a concise, factual summary with key points (life, teachings, historical significance). Cite sources found."
- **Step 2 (create + save):** "Using the information you found about Jesus, create an interactive landing page with a very professional look in a single HTML file (modern CSS, responsive layout, and JavaScript interactivity such as tabs, accordion, smooth scroll, animations, or interactive buttons/sections). Save it to disk as `jesus-landing-page.html` using write_file. Return a brief confirmation."

## Tools available
- `web_search`
- `write_file` (custom handler provided by `run.mjs`, saves to `demo/07-jesus-landing-page/output/<model>/` and latest copy)

## Ground truth / validation
- **Research:** direct web search for "who was Jesus of Nazareth historical summary" saved in `results/ground-truth.json`.
- **Artifact validation (heuristic):** saved HTML checked for structure, CSS, JS, interactivity signals (tabs/accordion/modal/menu/scroll/animation/click handlers), professional design cues (layout/sections/styles), and mention of Jesus/related content.

## Harness configuration
- Provider: Ollama (default `qwen3:4b-instruct-8k`, override with `AGENTKIT_MODEL`)
- `mode: "build"`, `interactive: true`
- Capabilities: web + (custom write_file), no terminal/mcp/filesystem/artifacts
- `maxToolRounds: 6` per turn
- Two-step conversation with history

See [`config.json`](./config.json).

## Run
```bash
node demo/07-jesus-landing-page/ground-truth.mjs
node demo/07-jesus-landing-page/run.mjs
AGENTKIT_MODEL=qwen3:0.6b-16k node demo/07-jesus-landing-page/run.mjs
AGENTKIT_MODEL=lfm3-omni:2b node demo/07-jesus-landing-page/run.mjs
```

## Outputs and metrics
- `results/<model>/run-<timestamp>.json` and `latest.json`: both steps with prompts, per-step duration/usage (tokens, tokens/s, context used/limit/percent, rounds), tool executions, environment, comparison/validation
- `output/<model>/jesus-landing-page.html` (and stamped/latest copies)

## Coherence criteria
- Step 1 provides a coherent summary about Jesus with key points/sources
- Step 2 generates and saves an interactive, professional-looking HTML landing page with content related to the research
- Metrics captured for both steps
