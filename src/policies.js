/**
 * Deterministic policies for agents backed by small or weak models.
 *
 * These are pure functions: no network, no filesystem, no Telegram. They extract
 * the decisions an agent needs to make before/after calling the model, so the
 * same rules can be reused from a bot, an HTTP endpoint or a task.
 *
 * Ported from the ollama-bot harness; kept dependency-free on purpose.
 */

/**
 * Truncates a value with an ellipsis.
 *
 * @param {*} value
 * @param {number} max Maximum output length.
 * @returns {string} Empty string when `max` is not positive.
 */
export const short = (value, max) => {
	const text = String(value == null ? "" : value);
	if (!Number.isFinite(max) || max <= 0) {
		return "";
	}
	return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};

/**
 * Lowercases and strips accents so Spanish/English regexes match either spelling.
 *
 * @param {*} value
 * @returns {string}
 */
export const normalizeForMatch = (value) => String(value || "")
	.normalize("NFD")
	.replace(/[\u0300-\u036f]/g, "")
	.toLowerCase()
	.trim();

// The recall patterns cover the phrasings that were missing and made the bot
// answer "no tengo acceso a las fotos" even though the history search could
// find them: "las ultimas cinco fotos que se revisaron", "todos los autos",
// "las fotos que me mandaste", ...
const RECALL_RE = /(recuerdas|te acuerdas|acuerdas de|te (mande|envie|pase|dije|comente|pregunte|mostre|enviaste)|lo que (hablamos|dijimos|dije|te dije|comentamos|vimos)|conversacion(es)? (pasad|anterior|de antes)|(mensajes?|historial) (anterior(es)?|pasad|viej)|(antes|anteriormente|hace (mucho|dias|semanas|meses|anos|un rato|tiempo))|(esa|aquella|la misma) (foto|imagen|video|audio)|hablamos de|habiamos hablado|como te dije|ayer|antier|la ultima vez|otra vez te|(ultim[ao]s?|anteriores|pasad[ao]s?|tod[ao]s?|revisad[ao]s?|vist[ao]s?|enviad[ao]s?|mandad[ao]s?)[^.]{0,70}(foto(?:s)?|imagen(?:es)?|video(?:s)?|audio(?:s)?|archivo(?:s)?|documento(?:s)?|auto(?:s)?|vehiculo(?:s)?|carro(?:s)?)|(foto(?:s)?|imagen(?:es)?|video(?:s)?|audio(?:s)?|auto(?:s)?|vehiculo(?:s)?|carro(?:s)?)[^.]{0,70}(ultim[ao]s?|anteriores|pasad[ao]s?|revisad[ao]s?|vist[ao]s?|enviad[ao]s?|mandad[ao]s?)|resumen de[^.]{0,50}(foto(?:s)?|imagen(?:es)?|video(?:s)?)|lista de (tod[ao]s? )?(los|las) (auto(?:s)?|vehiculo(?:s)?|carro(?:s)?|foto(?:s)?|imagen(?:es)?)|do you recall|did you (?:recall|remember)|do you remember|what did we (?:discuss|search|talk|see)|(?:we|you) (?:discussed|talked about|saw|searched) earlier|earlier (?:in|conversation|turn)|previous (?:turns?|messages?|conversation)|last time)/i;

const MEDIA_RE = /(foto(?:s)?|imagen(?:es)?|video(?:s)?|audio(?:s)?|nota de voz|voz|grabacion|captura|pantalla|auto(?:s)?|vehiculo(?:s)?|carro(?:s)?|placa(?:s)?|modelo(?:s)?|color(?:es)?)/i;
const COUNT_FOLLOWUP_RE = /(cuant[oa]s?|que (era|fue|dije|te dije|se dijo)|donde (estaba|quedo)|cual (era|fue)|lista|detalles|resumen|todos|todas|modelos|colores|placas)/i;

/**
 * True when the message asks about something said/shown earlier. Kept
 * deliberately conservative: a false positive costs one history lookup.
 *
 * @param {string} text User message.
 * @returns {boolean}
 */
export const looksLikeRecall = (text) => {
	const normalized = normalizeForMatch(text);
	if (normalized.length < 6) {
		return false;
	}
	if (RECALL_RE.test(normalized)) {
		return true;
	}
	// "cuantas gallinas habia?" only makes sense as a recall if it names media.
	return MEDIA_RE.test(normalized) && COUNT_FOLLOWUP_RE.test(normalized);
};

/**
 * Renders the rows returned by a history-search tool into prompt text.
 *
 * @param {{results?: Array<{created_at?: string, role?: string, kind?: string, content?: string, next?: {role?: string, content?: string}}>}} found
 * @param {{title?: string, budget?: number, instructions?: string}} [options]
 * @returns {string} Prompt text, or an empty string when there are no results.
 */
export const formatHistoryRecap = (found, options = {}) => {
	const rows = found && Array.isArray(found.results) ? found.results : [];
	if (!rows.length) {
		return "";
	}

	const budget = Number.isFinite(options.budget) ? options.budget : 1800;
	const lines = [];
	let remaining = budget;

	for (const row of rows) {
		const when = row?.created_at ? String(row.created_at).slice(0, 10) : "";
		const who = row?.role === "assistant" ? "assistant" : "user";
		const kind = row?.kind ? ` [${row.kind}]` : "";
		let line = `- ${when ? `${when} ` : ""}${who}${kind}: ${short(String(row?.content || ""), 320)}`;
		if (row?.next && row.next.content) {
			const whoNext = row.next.role === "assistant" ? "assistant" : "user";
			line += `\n  ${whoNext}: ${short(String(row.next.content), 320)}`;
		}
		if (line.length > remaining) {
			break;
		}
		remaining -= line.length;
		lines.push(line);
	}

	if (!lines.length) {
		return "";
	}

	const title = options.title || "PREVIOUS MESSAGES RECOVERED FROM THE USER HISTORY";
	const instructions = options.instructions
		|| "Use these messages if they answer the question. Do not claim you lack access to photos, audio or earlier conversations: the data is here. If they do not answer, say so and offer to search for something else.";

	return `${title}:\n${lines.join("\n")}\n\n${instructions}`;
};

/**
 * Matches a bare URL or `www.` link in user text.
 *
 * @type {RegExp}
 */
export const URL_RE = /(https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|ai|dev|app|es|com\.br|com\.ar|com\.mx|co\.uk)\/\S*)/i;

// Multilingual trigger words: es, en, pt, fr, de, it. The text is accent
// normalized before matching, so "noticias", "noticias" and "meteo" all hit.
const EXPLICIT_WEB_RE = /\b(busca|buscame|buscar|busque|investiga|investigue|investigar|averigua|averigüe|averiguar|consulta|consultar|googlea|search|look up|find out|cherche|chercher|rechercher|suche|suchen|cerca|cercare|pesquise|pesquisar|procure|procurar|dime|dame|muestrame|show me|tell me)\b[^.]{0,60}\b(internet|la web|web|google|online|en linea|en ligne|im web|na web)\b/;
const FRESH_DATA_RE = /\b(precios?|precos?|prix|preise|cotizaciones?|clima|meteo|meteorologia|weather|pronosticos?|prevision|temperatura|temperature|noticias?|news|nouvelles|nachrichten|notizie|resultados?|marcador|score|posiciones|standings|estrenos?|taquilla|box office|tipo de cambio|exchange rate|dolar|usd|eur|cop|mxn|criptomoneda|bitcoin|crypto|bolsa|stock market)\b/;
const FRESH_WHEN_RE = /\b(hoy|ahora|actual|actualmente|esta semana|este mes|manana|ayer|today|now|current|currently|this week|this month|tomorrow|yesterday|aujourdhui|maintenant|cette semaine|heute|jetzt|aktuell|diese woche|hoje|agora)\b/;
const STANDALONE_WEB_RE = /\b(clima|weather|meteo|precios?|precos?|prix|preise|noticias?|news|nouvelles|nachrichten|tipo de cambio|dolar)\b/;

/**
 * True when the message clearly asks for fresh web data. Small models answer
 * "no tengo acceso a internet" when handed a tool, so the harness searches first
 * and injects the results.
 *
 * A URL pasted by the user always counts as a web query, whatever the language.
 *
 * @param {string} text User message.
 * @returns {boolean}
 */
export const looksLikeWebQuery = (text) => {
	const raw = String(text || "");
	const normalized = normalizeForMatch(raw);
	if (!normalized) {
		return false;
	}
	if (URL_RE.test(raw)) {
		return true;
	}
	if (normalized.length > 300) {
		return false;
	}

	return EXPLICIT_WEB_RE.test(normalized)
		|| STANDALONE_WEB_RE.test(normalized)
		|| (FRESH_DATA_RE.test(normalized) && FRESH_WHEN_RE.test(normalized));
};

const isPlainObjectSafe = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/**
 * Decides whether the deterministic pre-search should run before the model.
 * `webAllowed` must be computed by the caller with
 * `resolveToolCapability("web_search", caps)`, so a disabled capability cannot
 * be bypassed by a prompt that says "search the internet".
 *
 * @param {object} [options]
 * @param {boolean|"auto"|"always"} [options.preSearch] Harness setting.
 * @param {string} [options.lastUserText] User message to classify.
 * @param {boolean} [options.webAllowed=true] Whether the web capability allows it.
 * @param {object} [options.webSearchConfig] Per-call web options; `query` or
 *   `preSearch: true` forces the search.
 * @returns {boolean}
 */
export const shouldRunPreSearch = ({
  preSearch,
  lastUserText,
  webAllowed = true,
  webSearchConfig = {},
} = {}) => {
  if (!webAllowed) return false;
  return preSearch === true
    || preSearch === "always"
    || (preSearch === "auto" && looksLikeWebQuery(lastUserText))
    || (isPlainObjectSafe(webSearchConfig) && webSearchConfig.preSearch === true);
};

// Relleno que no ayuda a un buscador: "datos verificables sobre el lugar que
// viste en la imagen: altitud..." debe convertirse en "Quito Ecuador altitud".
const WEB_SCAFFOLD_RE = /\b(?:datos|informacion|información|detalles|referencias|data|details|references)\s+(?:verificables?|confiables?|actuales?|verifiable|reliable|current)?\s*(?:sobre|de|acerca\s+de|about|of)?|sobre\s+(?:el\s+)?lugar\s+que\s+viste|sobre\s+lo\s+que\s+viste|que\s+viste\s+en\s+la\s+imagen|que\s+aparece\s+en\s+(?:la\s+imagen|primer\s+plano)|en\s+primer\s+plano|en\s+la\s+imagen|about\s+(?:the\s+)?place\s+in\s+the\s+image|in\s+the\s+foreground|verificables?|verifiable|please|por\s+favor/gi;

const WEB_INTENT_RE = /\b(altitud|altura|parque|clima|tiempo|precios?|distancia|poblaci[oó]n|capital|pa[ií]s|monumento|historia|horario|ubicaci[oó]n|coordenadas|altitude|height|park|climate|weather|prices?|distance|population|country|monument|history|schedule|location|coordinates)\b/gi;

// Regla estructural en lugar de un diccionario de stopwords: una palabra
// capitalizada que ABRE una frase del recap es andamiaje del harness
// ("MENSAJES ANTIGUOS...", "Based on...", "However..."), no una entidad.
// Las palabras que vienen de un slug de archivo o del mensaje del usuario van
// protegidas: son las que de verdad le interesan al buscador.
// El `¿` inicial de las preguntas en español también cuenta como apertura de
// frase: sin él, "¿Recuerdas…" se colaba como entidad del recap.
const SENTENCE_BOUNDARY_RE = /(?:[.!?:;¿¡"'(\n]\s*|[-–—]\s+)$/;

// Único resto de lista, y solo para slugs: descriptores genéricos de archivo.
// Nunca puede contener una palabra que el usuario use como intención (p. ej.
// "capital"), porque solo se aplica a tokens extraídos de nombres de archivo.
const FILE_DESCRIPTORS = new Set([
	"vista", "aerea", "imagen", "image", "foto", "fotos", "video", "webp",
	"jpg", "jpeg", "png", "pdf", "primero", "plano", "centro", "ciudad",
	"calle", "street", "msg", "turn", "usuario", "bot", "resumen", "memoria",
]);

const startsSentence = (text, index) => {
	const prefix = String(text || "").slice(0, index);
	return prefix.trim() === "" || SENTENCE_BOUNDARY_RE.test(prefix);
};

const extractEntities = (value, { protect = false } = {}) => {
	const text = String(value || "");
	const found = [];
	// Los nombres de archivo llegan como slugs en minúsculas
	// ("vista-aérea-de-quito-..."): el lugar está ahí aunque el modelo pequeño
	// no haya sabido nombrarlo. Van PRIMERO para no quedar fuera del top 5.
	for (const match of text.matchAll(/\b[a-záéíóúüñ]{3,}(?:[-_][a-záéíóúüñ]{2,})+\b/g)) {
		for (const part of match[0].split(/[-_]/)) {
			found.push({
				word: part.charAt(0).toUpperCase() + part.slice(1),
				index: match.index,
				fromSlug: true,
			});
		}
	}
	for (const match of text.matchAll(/\b[A-ZÁÉÍÓÚÜÑ][\wÁÉÍÓÚÜÑáéíóúüñ'-]+\b/g)) {
		found.push({ word: match[0], index: match.index, fromSlug: false });
	}

	const unique = [];
	for (const candidate of found) {
		const word = candidate.word.trim();
		const normalized = normalizeForMatch(word);
		if (word.length < 3 || /^[A-ZÁÉÍÓÚÜÑ]{3,}$/.test(word)) continue; // cabeceras MAYÚSCULAS
		if (candidate.fromSlug) {
			// Artículos y preposiciones del slug son ruido estructural, no léxico.
			if (word.length <= 3 || FILE_DESCRIPTORS.has(normalized)) continue;
		} else if (!protect && startsSentence(text, candidate.index)) {
			continue;
		}
		if (unique.some((item) => normalizeForMatch(item) === normalized)) continue;
		unique.push(word);
	}
	return unique.slice(0, 5);
};

/**
 * Turns a verbose instruction into a search-engine-friendly query.
 * `options.context` (typically a memory recap) supplies proper nouns the new
 * message only refers to as "the thing in the image".
 *
 * @param {string} text Verbose user instruction.
 * @param {{context?: string}} [options] Extra proper nouns to include.
 * @returns {string} Short query (max 160 chars).
 */
export const cleanWebQuery = (text, options = {}) => {
	const raw = String(text || "").trim();
	// Un verbo en imperativo al principio es una instrucción, no una entidad:
	// se quita por su POSICIÓN, sin mantener una lista de palabras prohibidas.
	const stripped = raw.replace(
		/^[¿¡\s]*(?:(?:tu|oye|por favor|please|bitte|s'il te plait)\s+)?(?:busca(?:me)?|buscar|investiga(?:r)?|averigua|consulta(?:r)?|dime|dame|search|look up|find out|cherche|rechercher|suche|cerca|pesquise|procure|analiza(?:r)?|describe(?:r)?|resume(?:n|r)?|explica(?:r)?|verifica(?:r)?|confirma(?:r)?|recuerda(?:s|r)?|cu[aá]l|qu[eé])\b(?:\s+(?:en\s+)?(?:internet|la\s+web|web|google|online|en\s+linea|en\s+ligne|im\s+web|na\s+web))?\s*[:,]?\s*/i,
		"",
	).trim();
	const cleaned = stripped
		.replace(WEB_SCAFFOLD_RE, " ")
		.replace(/\s+/g, " ")
		.replace(/^[\s:,.-]+|[\s:,.-]+$/g, "")
		.trim() || stripped;

	const context = isPlainObjectSafe(options) ? options.context : "";
	const entities = [
		...extractEntities(context),
		...extractEntities(cleaned, { protect: true }),
	].filter((word, index, all) => all.findIndex((item) => normalizeForMatch(item) === normalizeForMatch(word)) === index);
	const intents = [...new Set((cleaned.match(WEB_INTENT_RE) || []).map((word) => word.toLowerCase()))];
	const parts = entities.length ? [...entities, ...intents] : [];
	return short(parts.join(" ") || cleaned || raw, 160);
};

/**
 * Chooses what to search: the user's own words first, then the quoted question
 * when the new text is only an instruction ("reply to this message again").
 *
 * @param {object} [options]
 * @param {string} [options.ownText] Current user message.
 * @param {string} [options.quotedText] Message the user is quoting.
 * @returns {string} Search query, or an empty string when neither text looks like a web query.
 */
export const pickWebQuery = ({ ownText = "", quotedText = "" } = {}) => {
	if (looksLikeWebQuery(ownText)) {
		return cleanWebQuery(ownText);
	}
	if (quotedText && looksLikeWebQuery(quotedText)) {
		return cleanWebQuery(quotedText);
	}
	return "";
};

/**
 * Renders web-search results into prompt text.
 *
 * @param {{results?: Array<{title?: string, url?: string, snippet?: string}>, source?: string, query?: string}} found
 * @param {{budget?: number, maxResults?: number, title?: string, instructions?: string}} [options]
 * @returns {string} Prompt text, or an empty string when there are no results.
 */
export const formatWebRecap = (found, options = {}) => {
	const results = found && Array.isArray(found.results) ? found.results : [];
	if (!results.length) {
		return "";
	}

	const budget = Number.isFinite(options.budget) ? options.budget : 2200;
	const maxResults = Number.isFinite(options.maxResults) ? options.maxResults : 6;
	const lines = [];
	let remaining = budget;

	for (let index = 0; index < results.length && index < maxResults; index += 1) {
		const result = results[index] || {};
		const line = `${index + 1}. ${short(String(result.title || "(untitled)"), 160)}`
			+ `\n   ${short(String(result.url || ""), 200)}`
			+ `\n   ${short(String(result.snippet || ""), 320)}`;
		if (line.length > remaining) {
			break;
		}
		remaining -= line.length;
		lines.push(line);
	}

	if (!lines.length) {
		return "";
	}

	const engine = (found && found.source) || "web";
	const queryLabel = found && found.query ? `"${short(String(found.query), 120)}"` : "automatica";
	const title = options.title || `WEB SEARCH RESULTS (${engine}, ${queryLabel})`;
	const instructions = options.instructions
		|| "Use these results to answer and cite the source (title or URL). Do not claim you lack internet access: the data is here. If they do not answer the question, say so.";

	return `${title}:\n${lines.join("\n")}\n\n${instructions}`;
};

/**
 * Deterministic grounding check: every number and proper noun the answer
 * asserts must appear in the web sources we injected. No second LLM call, so
 * it works with tiny local models too.
 *
 * @param {object} [options]
 * @param {string} [options.text] Model answer to verify.
 * @param {Array<object>} [options.webResults] Injected search results.
 * @returns {{ok: boolean|null, unsupported: string[], supported: string[],
 *   coverage: number|null, confidence: "low"|"medium"|"high"|null,
 *   sourceChars: number, checked?: object, reason?: string}}
 */
const groundingNumbers = (text) => {
	const matches = String(text || "").match(/\d[\d.,\s]{0,12}\d/g) || [];
	const unique = new Set();
	for (const raw of matches) {
		const digits = raw.replace(/[.,\s]/g, "");
		if (digits.length >= 3) unique.add(digits); // 2.850 y 2850 son el mismo dato
	}
	return [...unique];
};

const groundingEntities = (text) => {
	// Negritas, encabezados y citas son formato, no afirmaciones: sin quitarlos,
	// `**City Altitude**:` se marcaba como entidad sin respaldo. Los sustituimos
	// por espacios (no por "") para no pegar palabras vecinas.
	const source = String(text || "").replace(/[*_#~`>]/g, " ");
	const values = [];
	const re = /\b[A-ZÁÉÍÓÚÜÑ][\wÁÉÍÓÚÜÑáéíóúüñ'-]*(?:\s+[A-ZÁÉÍÓÚÜÑ][\wÁÉÍÓÚÜÑáéíóúüñ'-]*)+\b|\b[A-ZÁÉÍÓÚÜÑ][\wÁÉÍÓÚÜÑáéíóúüñ'-]+\b/g;
	for (const match of source.matchAll(re)) {
		const phrase = match[0].trim();
		if (phrase.length < 4 || /^[A-ZÁÉÍÓÚÜÑ\s'-]+$/.test(phrase)) continue;
		if (startsSentence(source, match.index)) continue; // "Based", "The", "However"…
		// "Fuente:" es una etiqueta de cita, no una afirmación que verificar.
		if (source.slice(match.index + match[0].length).trimStart().startsWith(":")) continue;
		values.push(phrase);
	}
	return [...new Set(values)];
};

/**
 * Checks answer claims against injected web sources without a second LLM call.
 *
 * @param {object} [options]
 * @param {string} [options.text] Model answer to verify.
 * @param {Array<object>} [options.webResults] Injected search results.
 * @returns {{ok: boolean|null, unsupported: string[], supported: string[],
 *   coverage: number|null, confidence: string|null, sourceChars: number,
 *   checked?: object, reason?: string}}
 */
export const checkGrounding = ({ text = "", webResults = [] } = {}) => {
	const rows = Array.isArray(webResults) ? webResults : [];
	const source = rows
		.map((row) => [row?.title, row?.snippet, row?.text, row?.content].filter(Boolean).join(" "))
		.join(" ");
	// 2.850 y 2850 deben compararse igual; el normalizador general conserva
	// la puntuación porque en texto sirve para delimitar frases.
	const normalizedSource = normalizeForMatch(source).replace(/(\d)[.,](?=\d)/g, "$1");
	if (!normalizedSource.trim()) {
		return {
			ok: null,
			unsupported: [],
			supported: [],
			sourceChars: 0,
			coverage: null,
			confidence: null,
			reason: "no web sources",
		};
	}

	const numbers = groundingNumbers(text);
	const entities = groundingEntities(text);
	const unsupported = [];
	const supported = [];
	for (const number of numbers) {
		(normalizedSource.includes(number) ? supported : unsupported).push(number);
	}
	for (const entity of entities) {
		const words = normalizeForMatch(entity).split(/\s+/);
		let found = normalizedSource.includes(words.join(" "));
		if (!found && words.length > 1) {
			// "Quito Central Park": basta con que aparezca "quito central" o
			// "central park" para considerar respaldada la frase.
			for (let index = 0; index < words.length - 1 && !found; index += 1) {
				found = normalizedSource.includes(words.slice(index, index + 2).join(" "));
			}
		}
		(found ? supported : unsupported).push(entity);
	}
	const checkedCount = numbers.length + entities.length;
	const coverage = checkedCount ? Number((supported.length / checkedCount).toFixed(2)) : null;
	// Coverage alone is misleading: one entity in a 40-char snippet is not the
	// same evidence as five claims against a full page. Report both.
	let confidence = "low";
	if (source.length >= 600 && checkedCount >= 3 && coverage === 1) confidence = "high";
	else if (source.length >= 200 && (coverage ?? 0) >= 0.5) confidence = "medium";
	return {
		ok: unsupported.length === 0,
		unsupported,
		supported,
		coverage,
		confidence,
		sourceChars: source.length,
		checked: { numbers: numbers.length, entities: entities.length },
	};
};

/**
 * Compact tool payload: what an LLM needs, without dumping full pages (every
 * extra token costs prompt-processing time on CPU models).
 *
 * @param {object} found Raw `webSearch()` result.
 * @param {object} [options] `maxResults`, `snippetLength`, `textLength`.
 * @returns {object} Trimmed result with `ok`, `source`, `results` and `note`.
 */
export const trimWebResults = (found, { maxResults = 4, snippetLength = 300, textLength = 700 } = {}) => {
	const rows = found && Array.isArray(found.results) ? found.results : [];
	return {
		ok: Boolean(found && found.ok),
		source: (found && found.source) || null,
		results: rows.slice(0, maxResults).map((row) => {
			const item = {
				title: short(String(row?.title || ""), 140),
				url: short(String(row?.url || ""), 200),
				snippet: short(String(row?.snippet || ""), snippetLength),
			};
			if (row?.text) {
				item.text = short(String(row.text), textLength);
			}
			return item;
		}),
		note: (found && found.note) || "",
	};
};

/**
 * Detects a request to analyse media that was never attached, so the host can
 * ask for the file instead of letting the model answer "I cannot see images".
 *
 * @param {string} text User message.
 * @returns {boolean}
 */
export const looksLikeMissingMedia = (text) => {
	const normalized = normalizeForMatch(text);
	if (!normalized || normalized.length > 140) {
		return false;
	}
	if (/\b(anterior|ultima|ultimo|de antes|pasada|pasado|recuerda|recuerdas|historial|ayer|envie|mande|pase)\b/.test(normalized)) {
		return false;
	}
	return /(analiza|analizar|describe|describir|mira|mirar|revisa|revisar|lee|leer|transcribe|resume|resumir|que (se )?ve|que hay)\b[^.]{0,40}\b(esta|este|esa|ese|la|el|mi)\b[^.]{0,12}\b(imagen|foto|video|captura|pantalla)\b/.test(normalized);
};

/**
 * Merges a Telegram-style quoted message into the prompt.
 *
 * @param {string} text
 * @param {{text?: string}|null|undefined} quoted
 * @param {{label?: string}} [options]
 * @returns {string} Merged prompt text.
 */
export const mergeQuoted = (text, quoted, options = {}) => {
	const base = String(text || "").trim();
	if (!quoted || !quoted.text) {
		return base;
	}
	const label = options.label || "";

	return base ? `${base}\n\n${label}${quoted.text}` : `${label}${quoted.text}`;
};
