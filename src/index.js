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
	shouldRunPreSearch,
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

export {
	DEFAULT_MAX_CALLS_PER_TURN,
	DEFAULT_MAX_OUTPUT_BYTES,
	DEFAULT_SEARCH_PATH,
	DEFAULT_TIMEOUT_MS,
	TERMINAL_TOOL_NAME,
	TERMINAL_TOOL_PARAMETERS,
	buildChildEnv,
	createTerminalTool,
	isInsideRoot,
	resolveBinary,
	scrubSecrets,
} from "./terminal.js";

export {
	DEFAULT_TRUST_LEVEL,
	MCP_TRUST_LEVELS,
	PROJECT_CONFIG_FILES,
	USER_CONFIG_FILE,
	describeTrust,
	findMcpConfig,
	loadMcpConfig,
	loadMcpServers,
	normalizeMcpServer,
	normalizeMcpServers,
} from "./mcp.js";

export {
	CAPABILITY_CATEGORIES,
	applyCapabilitiesToToolHandlers,
	applyCapabilityToToolHandler,
	capabilityDeniedResult,
	capabilityEnabled,
	defaultCapabilitiesFor,
	normalizeCapabilities,
	resolveToolCapability,
} from "./capabilities.js";

export {
	shouldAutoCompact,
	compactMessages,
	compactMessagesTruncate,
	compactMessagesWithSummary,
	buildCompactionSummaryPrompt,
} from "./compaction.js";

export {
	MODEL_PRESETS,
	getModelConfig,
	listTaskTypes as listPresetTaskTypes,
} from "./config/presets.js";

export {
	extractCodeBlock,
	extractCodeBlocks,
	detectRefusal,
	validateMinimumContent,
} from "./utils/response-cleaner.js";

export {
	getSystemPrompt,
	getSystemPromptEN,
	getSystemPromptES,
	detectPromptLanguage,
	SYSTEM_PROMPTS_EN,
	SYSTEM_PROMPTS_ES,
} from "./utils/system-prompts-en.js";

export {
	enriquecerMensajes,
	getFewShotExample,
} from "./utils/task-enhancer.js";

export {
	validarHTMLSalida,
	validarCSSSalida,
	validarJSSalida,
	validarCodigoSalida,
	generarPromptCorreccion,
	necesitaCorreccion,
} from "./utils/output-validator.js";

export {
	validateSyntax,
	validateCodeBlocks,
} from "./utils/syntax-validator.js";

export {
	createCacheKey,
	ResponseCache,
} from "./utils/response-cache.js";

export {
	suggestTimeoutMs,
	TimeoutPolicy,
} from "./utils/adaptive-timeout.js";

export {
	MODEL_RECOMMENDATIONS,
	recommendModels,
	recommendModel,
} from "./utils/model-registry.js";

export { enhancedAskAgent } from "./utils/harness-improvements.js";

export {
	unwrapToolArgumentValue,
	normalizeToolArguments,
} from "./utils/tool-arguments.js";

export {
	MULTI_FILE_TEMPLATES,
	taskTypeForLanguage,
	buildBlockBundle,
	stripWrapperTags,
	generateMultiFile,
} from "./utils/multi-file-generator.js";

export {
	GLOBAL_CONFIG_MODE,
	PROJECT_CONFIG_CANONICAL,
	PROJECT_CONFIG_LEGACY,
	defaultConfig,
	findProjectConfigPath,
	getGlobalConfigDir,
	getGlobalConfigPath,
	loadEffectiveConfig,
	loadGlobalConfig,
	loadProjectConfig,
	readJsonFile,
	readJsonFileIfExists,
	resolveConfigSecrets,
	resolveSecretReference,
	saveGlobalConfig,
	saveProjectConfig,
	writeJsonFile,
} from "./config.js";
