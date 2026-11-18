# 04 - Code Generation: Landing Page with Button Animations

## Objective
Validate harness+LLM code generation: a simple landing page in a single HTML file with CSS and JavaScript that animates buttons.

## Prompt
> "Create a simple landing page in a single HTML file. It must include some CSS and JavaScript to animate the buttons (for example on hover or click). Return the complete HTML file code."

## Ground truth / validation
No single external answer; the generated artifact is validated automatically (`validation` in results):
- HTML structure (`<!DOCTYPE html>` / `<html>`, head/body)
- Buttons (`<button>`)
- JavaScript (`<script>` or handlers)
- Animation signals (CSS `@keyframes`/`transition`/`transform`/`animation` or JS animation)

Generated code is saved to `output/<model>/landing-page.html` (and copied per run in `results/<model>/`), with `output/landing-page.html` updated to the latest run.

## Harness configuration
- Provider: Ollama (default `qwen3:4b-instruct-8k`, override with `AGENTKIT_MODEL`)
- `mode: "build"`, no tools required (pure generation)
- Capabilities: terminal/web/mcp/filesystem/documents/artifacts disabled
- `includeDiagnostics: true`

See [`config.json`](./config.json).

## Run
```bash
node demo/04-codegen-landing/run.mjs
AGENTKIT_MODEL=qwen3:0.6b-16k node demo/04-codegen-landing/run.mjs
AGENTKIT_MODEL=lfm3-omni:2b node demo/04-codegen-landing/run.mjs
```

## Outputs and metrics
- `results/<model>/run-<timestamp>.json` and `latest.json`: response, environment, config, task duration, usage (tokens, tokens/s, context used/limit/percent, rounds), artifact info and validation
- `output/<model>/landing-page.html` and `results/<model>/landing-page-<timestamp>.html`

## Coherence criteria
- Non-empty response and extracted HTML
- Basic structure + buttons + JS + animation checks pass
- Usage/timing metrics captured
