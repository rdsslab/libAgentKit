/**
 * @rdsslab/agentkit — provider-agnostic agent toolkit.
 *
 * Building blocks that work the same from a bot worker, an HTTP endpoint, a
 * CLI or a scheduled task:
 *
 * - policies: deterministic decisions (web/recall detection, prompt recaps)
 * - websearch: DuckDuckGo/Bing/HTTP-JSON search with a browser User-Agent
 * - documents: in-memory PDF/DOCX/text extraction (no filesystem)
 * - media: images, STT/TTS provider registries, video frames via ffmpeg
 * - artifacts: the `create_file` contract (PDF, image, html, text, json, md, csv)
 * - agent: `askAgent()` orchestration returning a single envelope
 *
 * The provider layer lives in `./ia.js` and is loaded on demand, so importing
 * this package does not pull the OpenAI/Anthropic/Google/MCP SDKs. Import it
 * directly when you need it:
 *
 *   import { askIAWithProviderMCP } from "@rdsslab/agentkit/ia";
 */

export {
	short,
	normalizeForMatch,
	looksLikeRecall,
	formatHistoryRecap,
	looksLikeWebQuery,
	cleanWebQuery,
	pickWebQuery,
	formatWebRecap,
	trimWebResults,
	looksLikeMissingMedia,
	mergeQuoted,
	URL_RE,
} from "./policies.js";

export {
	guessMimeTypeFromName,
	isDataUrl,
	parseDataUrl,
	toBuffer,
	toDataUrl,
	normalizeBinaryDescriptor,
	isTextMimeType,
	isImageMimeType,
	isAudioMimeType,
	isVideoMimeType,
} from "./buffers.js";

export {
	webSearch,
	createWebSearch,
	listWebSearchEngines,
	extractDuckDuckGoResults,
	extractDuckDuckGoLiteResults,
	extractBingResults,
	WebSearchError,
} from "./websearch.js";

export {
	extractDocumentText,
	createDocumentReader,
	DocumentReader,
	detectDocumentKind,
	docxToText,
	htmlToText,
	DocumentExtractionError,
	SUPPORTED_DOCUMENT_TYPES,
} from "./documents.js";

export {
	MediaProviderError,
	imageToDataUrl,
	normalizeImageList,
	createSpeechToText,
	SpeechToText,
	registerSttProviderType,
	listSttProviderTypes,
	createTextToSpeech,
	TextToSpeech,
	registerTtsProviderType,
	listTtsProviderTypes,
	extractVideoFrames,
	mediaDuration,
	mp4Faststart,
	mp4Duration,
	splitJpegStream,
	runProcess,
	describeMediaSupport,
} from "./media.js";

export {
	askAgent,
	askAgentText,
	AgentError,
} from "./agent.js";

export {
	ARTIFACT_FORMATS,
	FILE_TOOL_DESCRIPTION,
	FILE_TOOL_PARAMETERS,
	artifactHtml,
	buildArtifact,
	createFileTool,
	loadDefaultRenderer,
	looksLikeHtml,
	safeFileName,
} from "./artifacts.js";
