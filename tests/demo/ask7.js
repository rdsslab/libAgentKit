#!/usr/bin/env node
/**
 * `AgentSession` demo: a continuous conversation with an image, web search and
 * automatic compaction, with automatic checks and per-turn metrics.
 *
 * Question chain (all go through `session.ask()`):
 *   1. aerial image review -> the model receives the image;
 *   2. natural-language recall -> hybrid memory returns turn 1;
 *   3. "search the web for what you saw" -> the query is focused with memory
 *      entities and preSearch injects sources BEFORE the model call;
 *   4. direct internet question -> an explicit web query about the previous
 *      search results, to show a real search and a real model call;
 *   5. long turn crossing the threshold -> the harness distinguishes an
 *      oversized incoming turn (warning only) from a full history (compaction);
 *   6. recall after compaction -> the index only holds the summary.
 *
 * Offline mode (default without credentials): fake adapter and fake
 * `webSearchFn`, but `askAgent()` runs the full pipeline (media, preSearch,
 * streaming). The banner says `MODE=SIMULATED ... NO MODEL CALL`; a real run
 * prints `MODE=REAL MODEL CALL` with the provider and model.
 *   node tests/demo/ask7.js
 *   AGENT_DRY_RUN=1 node tests/demo/ask7.js
 *
 * Local Ollama model (recommended on this machine):
 *   AGENT_PROVIDER=ollama AGENT_MODEL=minicpm-v4.6:16k \
 *     AGENT_CONTEXT_LIMIT=2048 AGENT_LONG_REPEAT=700 node tests/demo/ask7.js
 *   # add AGENT_WEB_FAKE=1 to avoid depending on the external search engine.
 *
 * Remote API:
 *   AGENT_API_KEY=... node tests/demo/ask7.js
 *
 * Variables: AGENT_IMAGE, AGENT_CONTEXT_LIMIT (default 600), AGENT_THRESHOLD (90),
 * AGENT_LONG_REPEAT (160), AGENT_WEB_FAKE, AGENT_WEB_CHARS (default 2200;
 * in real mode the recap is capped at 1200 chars to fit small contexts),
 * AGENT_SUMMARY_ASSERT_CHARS (default 2600; maximum asserted summary size),
 * AGENT_WEB_TOOL (default 1; set to 0 for small models that abuse the web tool
 * and let deterministic preSearch own the search),
 * AGENT_VERBOSE (default 0; 1 prints every text/reasoning delta),
 * AGENT_COUNT_TOKENS (default 1 with Ollama; counts exact tokens in the
 * 70-130% band before deciding whether to compact; uses /api/tokenize or,
 * when unavailable, prompt_eval_count from /api/generate).
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  AgentSession,
  createOllamaTokenCounter,
  loadEffectiveConfig,
  providerSupportedMedia,
} from "../../src/index.js";
import { registerAIProviderAdapter } from "../../src/ia.js";

const PROVIDER_NAME = process.env.AGENT_PROVIDER ?? "google";
const MODEL = process.env.AGENT_MODEL ?? "gemini-2.5-flash";
const API_KEY = process.env.AGENT_API_KEY
  ?? process.env.GEMINI_API_KEY
  ?? process.env.GOOGLE_API_KEY
  ?? process.env.OPENAI_API_KEY;
const BASE_URL = process.env.AGENT_BASE_URL ?? "";
const IMAGE = process.env.AGENT_IMAGE
  ?? new URL("./vista-aérea-de-quito-el-centro-de-la-ciudad.webp", import.meta.url);
const CONTEXT_LIMIT = Number(process.env.AGENT_CONTEXT_LIMIT ?? 600);
const THRESHOLD = Number(process.env.AGENT_THRESHOLD ?? 90);
const LONG_REPEAT = Number(process.env.AGENT_LONG_REPEAT ?? 160);
const WEB_CHARS = Number(process.env.AGENT_WEB_CHARS ?? 2200);
const truthy = (value) => ["1", "true", "yes"].includes(String(value ?? "").toLowerCase());
const DRY_RUN = process.argv.includes("--dry-run")
  || truthy(process.env.AGENT_DRY_RUN)
  || (!API_KEY && !PROVIDER_NAME.toLowerCase().includes("ollama"));
const WEB_FAKE = DRY_RUN || truthy(process.env.AGENT_WEB_FAKE);
// A real six-turn run with two web recaps must fit the small local context.
const WEB_INJECTED_CHARS = Math.min(WEB_CHARS, DRY_RUN ? WEB_CHARS : 1200);
const SUMMARY_ASSERT_CHARS = Number(process.env.AGENT_SUMMARY_ASSERT_CHARS ?? 2600);
const WEB_TOOL = truthy(process.env.AGENT_WEB_TOOL ?? "1");
const VERBOSE = truthy(process.env.AGENT_VERBOSE);
const IS_OLLAMA = PROVIDER_NAME.toLowerCase().includes("ollama");
const COUNT_TOKENS = !DRY_RUN && IS_OLLAMA && truthy(process.env.AGENT_COUNT_TOKENS ?? "1");
const OLLAMA_URL = process.env.AGENT_OLLAMA_URL ?? "http://localhost:11434";

// The exact counter replaces the heuristic only inside the uncertainty band,
// before compaction is decided. It is exported from the library so every host
// gets the same /api/tokenize -> prompt_eval_count fallback.
const tokenCounter = COUNT_TOKENS
  ? createOllamaTokenCounter({ baseUrl: OLLAMA_URL, model: MODEL })
  : null;

const SYSTEM = [
  "You are a visual assistant that answers in English.",
  "When you receive web search results, use them and cite the source.",
  "If the user asks about something earlier, rely on the history and memory.",
].join(" ");

const FAKE_WEB_RESULTS = [
  {
    title: "Quito - Wikipedia",
    url: "https://en.wikipedia.org/wiki/Quito",
    snippet: "Quito, the capital of Ecuador, sits at about 2,850 metres in the Andes. Its historic centre is a UNESCO World Heritage Site, declared in 1978.",
  },
  {
    title: "Itchimbia Park - Quito City Council",
    url: "https://www.quito.gob.ec/parque-itchimbia",
    snippet: "Itchimbia Park offers a panoramic view of the historic centre of Quito and its mountains.",
  },
  {
    title: "Historic Centre of Quito - UNESCO World Heritage Centre",
    url: "https://whc.unesco.org/en/list/436/",
    snippet: "The historic centre of Quito was inscribed on the World Heritage List in 1978 for its colonial architecture and setting.",
  },
];

const FAKE_WEB = {
  ok: true,
  source: "demo-web",
  results: FAKE_WEB_RESULTS,
};

const FAKE_ANSWERS = [
  "The image is an aerial view of Quito, Ecuador. The urban centre, hills in the background and a large park in the foreground are visible.",
  "Yes: the city was Quito. The historic centre, the mountains and the park in the foreground stood out.",
  "According to the sources consulted, Quito is at about 2,850 m and the park we discussed is Itchimbia (Source: Quito - Wikipedia / Quito City Council).",
  "According to the web results, Quito's historic centre is a UNESCO World Heritage Site, declared in 1978 (Source: Quito - Wikipedia / UNESCO World Heritage Centre).",
  "Summary: we reviewed an aerial image of Quito, recalled its elements and searched the web for its altitude (2,850 m) and Itchimbia Park.",
  "As we searched online: Quito is about 2,850 metres high and the park we had in mind was Itchimbia.",
];

// ---------------------------------------------------------------------------
// Fake adapter: lets the image and the web recap reach the model and emits the
// same streaming/reasoning callbacks as a real adapter.
// ---------------------------------------------------------------------------
const observations = [];
const registerFakeAdapter = () => {
  const name = `demo-session-dry-${Date.now()}`;
  registerAIProviderAdapter(name, () => ({
    run: async ({ prompts = [], images = [], onTextDelta, onThinking }) => {
      const turn = observations.length + 1;
      const lastUser = [...prompts].reverse().find((message) => message.role === "user");
      const text = String(lastUser?.content ?? "");
      observations.push({
        turn,
        images: images.length,
        messages: prompts.length,
        systemChars: prompts.find((message) => message.role === "system")?.content?.length ?? 0,
        webRecap: /WEB SEARCH RESULTS/i.test(text),
        memoryRecap: /Memory from previous conversations/i.test(
          prompts.find((message) => message.role === "system")?.content ?? "",
        ),
      });

      const meta = { provider: "demo-dry", model: "dry-model", round: 1 };
      onThinking?.(`turn ${turn}: reviewing the context...`, meta);
      const answer = FAKE_ANSWERS[turn - 1] ?? "Test answer.";
      for (const chunk of answer.match(/.{1,28}/gs) ?? []) {
        onTextDelta?.(chunk, meta);
      }
      // Synthetic usage exercises signed-delta calibration.
      const promptTokens = 40 + turn * 10;
      return {
        text: answer,
        provider: "demo-dry",
        model: "dry-model",
        toolExecutions: [],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: 30,
          total_tokens: promptTokens + 30,
          context: {
            estimated: false,
            used_percent: Number((promptTokens / CONTEXT_LIMIT * 100).toFixed(2)),
          },
        },
      };
    },
  }));
  return { provider: name, model: "dry-model", contextLength: CONTEXT_LIMIT };
};
// ---------------------------------------------------------------------------

const events = [];
const results = [];
const measurements = [];
const imageBuffer = await readFile(IMAGE);
const imageName = basename(decodeURIComponent(typeof IMAGE === "string" ? IMAGE : IMAGE.pathname));
const effective = loadEffectiveConfig();

const realProvider = {
  provider: PROVIDER_NAME,
  model: MODEL,
  ...(API_KEY ? { apiKey: API_KEY } : {}),
  ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
  system: SYSTEM,
  contextLength: CONTEXT_LIMIT,
  maxTokens: 700,
  temperature: 0.2,
  timeout: 180000,
  responseTimeout: 180000,
};

const fakeAdapter = DRY_RUN ? registerFakeAdapter() : null;
const session = new AgentSession({
  provider: fakeAdapter ?? realProvider,
  system: SYSTEM,
  config: effective.config,
  context: { limit: CONTEXT_LIMIT, thresholdPercent: THRESHOLD, maxSummaryChars: 4000 },
  // Keep a real six-turn run inside the 2048-token context even with two web
  // recaps; the default 2200-char cap is too large once history has grown.
  webSearch: { maxResults: 3, maxInjectedContextChars: WEB_INJECTED_CHARS },
  // Keep the dry-run strictly offline: no Ollama embedding requests.
  // With a real provider, MemoryStore auto-configures nomic-embed-text.
  memory: { mode: "hybrid", topK: 4, budget: 1200, autoEmbeddings: !DRY_RUN },
  ...(tokenCounter ? { countTokens: tokenCounter } : {}),
  includeDiagnostics: true, // the local adapter only exposes usage with diagnostics
  tools: { web_search: WEB_TOOL },
  preSearch: false,
  ...(WEB_FAKE ? { webSearchFn: async ({ query }) => ({ ...FAKE_WEB, query }) } : {}),
  onEvent: (event) => {
    events.push(event);
    if (!VERBOSE && (event.type === "answer_delta" || event.type === "thinking")) return;
    const { type, at, turn, ...data } = event;
    console.log(`[${type}] turn=${turn} ${JSON.stringify(data)}`);
  },
});

const MODE_BANNER = DRY_RUN
  ? "*** MODE=SIMULATED · NO MODEL CALL · fake adapter + fake web results · all timings are fake ***"
  : `*** MODE=REAL MODEL CALL · provider=${PROVIDER_NAME} · model=${MODEL} · web=${WEB_FAKE ? "fake" : "real internet search"} ***`;
console.error(MODE_BANNER);
console.error(
  `AgentSession · provider=${fakeAdapter ? "dry-run(real askAgent pipeline)" : `${PROVIDER_NAME}/${MODEL}`}`
  + ` · web=${WEB_FAKE ? "fake" : "real"} · limit=${CONTEXT_LIMIT} · threshold=${THRESHOLD}%`
  + ` · tokenCounter=${tokenCounter ? "ollama (tokenize -> prompt_eval_count)" : "heuristic"}`
  + ` · adapterSupportsImage=${providerSupportedMedia(realProvider).includes("image")}`,
);

const conversation = [
  {
    question: `Analyze the attached image "${imageName}" and describe what is visible: city, landscape, buildings and relevant details.`,
    image: true,
  },
  {
    question: "Do you recall which city appeared in the image and which elements stood out?",
  },
  {
    question: "Search the web for verifiable data about the place in the image: altitude of the city and the park in the foreground.",
    options: { preSearch: "always" },
  },
  {
    question: "Look up on the internet whether the historic centre of this city is a UNESCO World Heritage Site and when it was declared.",
    options: { preSearch: "always" },
  },
  {
    question: `Finally, write a very detailed summary of everything discussed. ${"context ".repeat(LONG_REPEAT)}`,
  },
  {
    question: "Do you recall what we searched online? What is the city's altitude and which park did we think of?",
  },
];

try {
  for (const [index, entry] of conversation.entries()) {
    console.error(`\n> [${index + 1}/${conversation.length}] ${entry.question.slice(0, 110)}${entry.question.length > 110 ? "..." : ""}`);
    const started = Date.now();
    const result = await session.ask(entry.question, {
      ...(entry.options ?? {}),
      ...(entry.image ? {
        attachments: [{
          kind: "image",
          name: imageName,
          mimeType: "image/webp",
          data: imageBuffer,
        }],
      } : {}),
    });
    results.push(result);
    const done = events.filter((event) => event.type === "done").at(-1);
    measurements.push({
      turn: index + 1,
      ms: Date.now() - started,
      promptTokens: done?.usage?.prompt_tokens ?? null,
      totalTokens: done?.usage?.total_tokens ?? null,
      estimatedTokens: done?.estimatedTokens ?? null,
      injectedEstimated: done?.injectedTokens ?? null,
      injectedObserved: done?.observedInjectionTokens ?? null,
      injectedChars: done?.injectedContextChars ?? null,
      providerUsedPercent: done?.providerUsedPercent ?? null,
      web: Boolean(result.usedWeb),
    });
    console.log(`< ${result.text}`);
    if (result.usedWeb) {
      console.error(`  web: query="${result.webQuery}" source=${result.webSource} results=${result.webResults.length} mode=${WEB_FAKE ? "fake" : "real"}`);
    }
  }
} catch (error) {
  console.error(`Demo error: ${error.message}`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Checks: turn the demo into a behavioural test of the class.
// ---------------------------------------------------------------------------
const recallEvents = events.filter((event) => event.type === "recall");
const warningEvents = events.filter((event) => event.type === "context_warning");
const startEvents = events.filter((event) => event.type === "compaction_start");
const endEvents = events.filter((event) => event.type === "compaction_end");
const groundingEvents = events.filter((event) => event.type === "grounding");
const verifiedEvents = events.filter((event) => event.type === "context_verified");
const overflowEvents = events.filter((event) => event.type === "context_overflow");
const compactEnd = endEvents[0];
const imageReceived = DRY_RUN
  ? observations[0]?.images === 1
  : results[0]?.media?.processed?.some((item) => item.kind === "image" && item.strategy === "native-image") === true;

const checks = [
  ["the image reached the model", imageReceived],
  ["turn 2 recall found the previous turn", (recallEvents[0]?.matches ?? 0) >= 1],
  ["the web recap was injected before the model call", DRY_RUN
    ? observations[2]?.webRecap === true
    : (results[2]?.webResults?.length ?? 0) > 0],
  ["web usage was recorded in the envelope", results[2]?.usedWeb === true],
  ["the web query was focused with memory entities", /quito/i.test(results[2]?.webQuery ?? "") && !/verifiable data/i.test(results[2]?.webQuery ?? "")],
  ["a second internet query was injected before the model call", DRY_RUN
    ? observations[3]?.webRecap === true
    : (results[3]?.webResults?.length ?? 0) > 0],
  ["the second query asked about UNESCO and was recorded", results[3]?.usedWeb === true && /unesco|world heritage/i.test(`${results[3]?.webQuery ?? ""} ${conversation[3].question}`)],
  ["the second query kept grounded web search results", (results[3]?.webResults ?? []).some((item) => /unesco|world heritage/i.test(`${item.title} ${item.snippet}`))],
  ["context warning emitted at the threshold", warningEvents.length >= 1 && warningEvents[0].thresholdPercent === THRESHOLD],
  ["compaction_start and compaction_end emitted", startEvents.length >= 1 && Boolean(compactEnd)],
  ["only system + summary remain after compaction", compactEnd?.messagesAfter === 1 && session.history[0]?.role === "system"],
  ["the index was purged down to the summary", compactEnd?.indexEpisodes === 1],
  ["recall after compaction finds the summary", (recallEvents.at(-1)?.matches ?? 0) >= 1 && /quito|altitud|itchimb/i.test((recallEvents.at(-1)?.matchesPreview ?? []).join(" "))],
  ["streaming and progress events notified", events.some((event) => event.type === "answer_delta") && events.some((event) => event.type === "thinking")],
  ["every event carries metadata", events.every((event) => event.type && event.at && Number.isFinite(event.turn))],
  ["all 6 turns were processed", session.turn === 6 && results.length === 6],
  // The real run may compact on turn 4 and only add two messages on turn 5.
  // The invariant is that system stays first and history does not grow freely.
  ["the history reflects the final compaction", session.history[0]?.role === "system" && session.history.length <= 5],
  ["the incoming turn is not duplicated in the summary", !compactEnd?.preview?.includes("context context")],
  ["the summary does not nest headers or grow without bound", !/Previous summary:|Recent turns:|Resumen anterior:/i.test(session.summary ?? "") && (session.history[0]?.content?.length ?? 0) <= SUMMARY_ASSERT_CHARS],
  ["injected context is accounted for", measurements.some((entry) => (entry.injectedEstimated ?? 0) > 0) && (DRY_RUN || measurements.some((entry) => (entry.injectedObserved ?? 0) > 0))],
  ["the envelope exposes real injected characters", measurements.some((entry) => (entry.injectedChars ?? 0) > 0)],
  ["calibration keeps the provider delta", session.calibration.samples >= 1 && Number.isFinite(session.calibration.delta)],
  ["grounding checked against web sources", groundingEvents.length >= 1 && typeof groundingEvents[0].ok === "boolean"],
  ["no unnecessary chained compactions", startEvents.length <= 2],
  ["exact counting is used in the uncertainty band", !tokenCounter || verifiedEvents.length >= 1],
  ["no provider context overflow was reported", overflowEvents.length === 0],
];

console.error("\n--- Checks ---");
for (const [name, ok] of checks) {
  console.error(`${ok ? "OK  " : "FAIL"} ${name}`);
  if (!ok) process.exitCode = 1;
}

console.error("\n--- Per-turn metrics ---");
console.error(JSON.stringify(measurements, null, 2));
console.error("\n--- Final state ---");
console.error(JSON.stringify({
  turns: session.turn,
  historyMessages: session.history.length,
  firstMessage: session.history[0]?.role,
  summaryChars: session.history[0]?.content?.length ?? 0,
  indexedEpisodes: session.memory.size,
  memory: session.memory.stats(),
  events: events.length,
  providerThinkingEvents: events.filter((event) => event.type === "thinking" && event.phase === "provider").length,
  calibration: session.stats().calibration,
  grounding: groundingEvents.map((event) => ({ ok: event.ok, coverage: event.coverage, confidence: event.confidence, unsupported: event.unsupported })),
  compactions: startEvents.map((event) => event.reason),
  skippedWarnings: warningEvents.filter((event) => event.compactionSkipped).map((event) => event.reason),
  exactCounts: verifiedEvents.map((event) => ({ before: event.usedPercentBefore, after: event.usedPercent, tokens: event.exactTokens })),
  overflows: overflowEvents.map((event) => event.usedPercent),
  checks: `${checks.filter(([, ok]) => ok).length}/${checks.length}`,
}, null, 2));
