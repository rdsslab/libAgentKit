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

// Named destinations are a web query even when the user does not say
// "internet": "busca en github a edwinspire" must not be treated as chit-chat.
const NAMED_SITE_RE = /\b(?:github|gitlab|bitbucket|linkedin|youtube|twitter|x\.com|facebook|instagram|tiktok|stackoverflow|stackexchange|wikipedia|reddit|npm)\b/i;
const SITE_ACTION_RE = /\b(?:busca|buscame|buscar|busque|ver|ve|mira|muestrame|revisa|consulta|investiga|perfil|cuenta|repo|repositorio|canal|video|pagina|sitio|web|user|usuario|datos|publicos|followers|seguidores)\b/i;

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
		|| (NAMED_SITE_RE.test(normalized) && SITE_ACTION_RE.test(normalized))
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

const WEB_INTENT_RE = /\b(altitud|altura|parque|clima|tiempo|precios?|distancia|poblaci[oó]n|capital|pa[ií]s|monumento|historia|horario|ubicaci[oó]n|coordenadas|repositorios?|perfil|seguidores|datos\s*p[uú]blicos|presidente|president|alcalde|mayor|gobernador|governor|primer ministro|prime minister|altitude|height|park|climate|weather|prices?|distance|population|country|monument|history|schedule|location|coordinates|repos?|profile|followers|public\s*data)\b/gi;

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

// "en github a edwinspire" carries two entities that extractEntities() misses:
// the site is lowercase and the handle is not capitalised. Keep them explicit
// instead of hoping the search engine infers them from a sentence fragment.
const extractSiteEntities = (text) => {
	const found = [];
	const pattern = /\b(?:en|de|del|from|at)\s+(github|gitlab|bitbucket|linkedin|youtube|twitter|facebook|instagram|tiktok|stackoverflow|stackexchange|wikipedia|reddit|npm)\b(?:\s*(?:a|de|user|usuario|user:|:|@)\s*([@\w][\w.-]*))?/gi;
	for (const match of String(text || "").matchAll(pattern)) {
		found.push(match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase());
		if (match[2] && !/^(?:su|la|el|el|los|las| cuenta| cuenta)$/i.test(match[2])) {
			found.push(match[2].replace(/^@/, ""));
		}
	}
	return found;
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
		...extractSiteEntities(cleaned),
		...extractEntities(context),
		...extractEntities(cleaned, { protect: true }),
	].filter((word, index, all) => all.findIndex((item) => normalizeForMatch(item) === normalizeForMatch(word)) === index);
	const intents = [...new Set((cleaned.match(WEB_INTENT_RE) || []).map((word) => word.toLowerCase()))];
	const parts = entities.length ? [...entities, ...intents] : [];
	return short(parts.join(" ") || cleaned || raw, 160);
};

const GENERIC_WEB_INSTRUCTION_RE = /^[¿¡\s]*(?:(?:tu|oye|por favor|please)\s+)?(?:busca(?:me)?|buscar|busque|investiga(?:r)?|averigua|consulta(?:r)?|search|look\s+up|find\s+out)\b(?:\s+(?:en\s+)?(?:internet|la\s+web|web|google|online|en\s+linea|en\s+ligne|im\s+web|na\s+web))?[?!.\s]*$/i;

/** True for "busca en internet" with no target: the query lives in the quoted message. */
export const isGenericWebInstruction = (text) => GENERIC_WEB_INSTRUCTION_RE.test(normalizeForMatch(text));

/**
 * Chooses what to search: the user's own words first, then the quoted question
 * when the new text is only an instruction ("busca en internet" replying to a
 * concrete request). A generic instruction never becomes the search query.
 *
 * @param {object} [options]
 * @param {string} [options.ownText] Current user message.
 * @param {string} [options.quotedText] Message the user is quoting.
 * @param {string} [options.context] Proper nouns from memory/attachments.
 * @returns {string} Search query, or an empty string when neither text looks like a web query.
 */
export const pickWebQuery = ({ ownText = "", quotedText = "", context = "" } = {}) => {
	const own = String(ownText || "");
	const quoted = String(quotedText || "");
	const ownLooks = looksLikeWebQuery(own);
	const generic = isGenericWebInstruction(own);
	const ownQuery = ownLooks ? cleanWebQuery(own, { context }) : "";

	if (ownLooks && !generic && ownQuery.length >= 8) {
		return ownQuery;
	}
	if (quoted) {
		const quotedQuery = looksLikeWebQuery(quoted)
			? cleanWebQuery(quoted, { context })
			: cleanWebQuery(quoted, { context: [ownQuery, context].filter(Boolean).join("\n") });
		if (quotedQuery && quotedQuery.length >= 3) {
			return quotedQuery;
		}
	}
	return generic && !context ? "" : ownQuery;
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
 * Check that every URL cited in an answer really came from the injected web
 * results. A made-up domain is a hallucination even when the names around it
 * happen to be right, so this is checked separately from `checkGrounding()`.
 * Pure and provider-agnostic: no network, no bot logic.
 *
 * @param {object} [options]
 * @param {string} [options.text] Model answer to verify.
 * @param {Array<object>} [options.webResults] Injected search results.
 * @returns {{ok: boolean|null, valid: string[], invalid: string[],
 *   cleanedText: string, checked: number, sourceChars: number, reason?: string}}
 */
const SOURCE_URL_KEYS = ["url", "link", "href", "uri", "source_url", "sourceUrl"];

const sourceKey = (value) => {
	let raw = String(value || "").trim().replace(/[),.;]+$/, "");
	if (!raw) return "";
	if (/^www\./i.test(raw)) raw = `https://${raw}`;
	try {
		const parsed = new URL(raw);
		if (!/^https?:$/i.test(parsed.protocol)) return "";
		return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
	} catch {
		return normalizeForMatch(raw).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
	}
};

const citedUrls = (text) => {
	const source = String(text || "");
	const found = [];
	const markdown = /\[([^\]]+)\]\((https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+)\)/gi;
	// Mask links already captured as markdown so the generic pass does not
	// count them twice, and so their positions stay valid for the cleanup.
	const rest = source.replace(markdown, (whole, label, url, offset) => {
		found.push({ url, label, start: offset, end: offset + whole.length });
		return " ".repeat(whole.length);
	});
	const bare = /(https?:\/\/|www\.)[^\s<>"')\]]+/gi;
	for (const match of rest.matchAll(bare)) {
		found.push({ url: match[0], label: "", start: match.index, end: match.index + match[0].length });
	}
	return found.sort((a, b) => a.start - b.start);
};

export const checkSources = ({ text = "", webResults = [] } = {}) => {
	const answer = String(text || "");
	const rows = Array.isArray(webResults) ? webResults : [];
	const keys = [];
	let sourceChars = 0;
	for (const row of rows) {
		for (const key of SOURCE_URL_KEYS) {
			const value = sourceKey(row?.[key]);
			if (value) keys.push(value);
		}
		const blob = [row?.title, row?.snippet, row?.text, row?.content].filter(Boolean).join(" ");
		sourceChars += blob.length;
		for (const match of blob.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi)) {
			const value = sourceKey(match[0]);
			if (value) keys.push(value);
		}
	}
	const citations = citedUrls(answer);
	const valid = [];
	const invalid = [];
	const removals = [];
	for (const citation of citations) {
		const key = sourceKey(citation.url);
		const supported = key && keys.some((entry) => (
			entry === key || entry.startsWith(`${key}/`) || key.startsWith(`${entry}/`)
		));
		if (supported) {
			valid.push(citation.url);
			continue;
		}
		invalid.push(citation.url);
		// Keep the markdown label: only the unverifiable link is dropped.
		removals.push({ ...citation, replacement: citation.label });
	}
	let cleanedText = answer;
	for (const item of removals.sort((a, b) => b.start - a.start)) {
		cleanedText = cleanedText.slice(0, item.start) + item.replacement + cleanedText.slice(item.end);
	}
	cleanedText = cleanedText.replace(/[ \t]{2,}/g, " ").trim();
	if (!citations.length) {
		return { ok: null, valid, invalid, cleanedText, checked: 0, sourceChars, reason: "no cited URLs" };
	}
	if (!keys.length) {
		return { ok: null, valid, invalid, cleanedText, checked: citations.length, sourceChars, reason: "no web sources" };
	}
	return {
		ok: invalid.length === 0,
		valid,
		invalid,
		cleanedText,
		checked: citations.length,
		sourceChars,
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

const NO_ANSWER_RE = /^(?:no\b[^.]{0,90}\b(?:se|sabe|tengo|dispongo|puedo|encuentro|hay|disponible|acceso|informacion|datos|conozco|confirmar|verificar|respuesta|saber)|no\s+lo\s+se|sin\s+(?:datos|informacion|respuesta)|i\s+(?:do\s+not|don't)\s+know|i\s+(?:cannot|can't|have\s+no)\s+(?:access|information|data)|no\s+answer)\b/i;

/**
 * True when the model only refused or disclaimed knowledge. Used to offer a
 * deterministic web-search retry instead of leaving the user without a path.
 *
 * @param {string} text Model answer.
 * @returns {boolean}
 */
export const looksLikeNoAnswer = (text) => {
	const normalized = normalizeForMatch(text).replace(/^[\s*_#>\-]+/, "");
	if (!normalized) return true;
	return NO_ANSWER_RE.test(normalized);
};

// A bare flag must stand alone or be followed by a separator. Otherwise a
// normal Spanish sentence like "no entiendo la pregunta" would be parsed as
// `false` plus a query.
const WEB_DECISION_BOOL_RE = /^(?:true|false|yes|no|si|sí|1|0)\b(?=$|\s*[:;,\-|]\s*|\s*\n\s*)/i;

const webDecisionFlag = (value) => {
	if (value === true || value === 1) return true;
	if (value === false || value === 0) return false;
	if (typeof value !== "string") return null;
	const normalized = normalizeForMatch(value).trim();
	if (/^(?:true|yes|si|1)$/.test(normalized)) return true;
	if (/^(?:false|no|0)$/.test(normalized)) return false;
	return null;
};

/**
 * Parses the router output that decides whether a turn needs a web lookup.
 *
 * The expected shape is one JSON object (`{"search":true,"query":"..."}`), but
 * a bare boolean followed by the query is accepted too. A null result means
 * "unparseable", so the caller can fall back to the deterministic policy.
 *
 * @param {string} text Model output.
 * @param {{maxQueryChars?: number}} [options]
 * @returns {{search: boolean, query: string}|null}
 */
export const parseWebDecision = (text, options = {}) => {
	let value = String(text || "").trim();
	if (!value) return null;
	value = value
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```$/, "")
		.trim();

	const objectMatch = value.match(/\{[\s\S]*?\}/);
	if (objectMatch) {
		try {
			const parsed = JSON.parse(objectMatch[0]);
			const search = webDecisionFlag(parsed.search ?? parsed.need ?? parsed.web);
			if (search != null) {
				const query = short(String(parsed.query ?? parsed.q ?? "").trim(), options.maxQueryChars ?? 300);
				return { search, query };
			}
		} catch {}
	}

	const bare = value.match(WEB_DECISION_BOOL_RE);
	if (!bare) return null;
	const search = webDecisionFlag(bare[0]);
	if (search == null) return null;
	const rest = value.slice(bare[0].length)
		.replace(/^[\s:;,\-|]+/, "")
		.replace(/^["'`]|["'`]$/g, "")
		.trim();
	return { search, query: short(rest, options.maxQueryChars ?? 300) };
};

// Cheap pre-classifier: it only answers when the message is structurally
// unambiguous. Returning null means "ask the model", which keeps the router as
// the judge for everything that is not an explicit instruction or an obvious
// fresh-data question. A false NO would produce an answer without sources, so
// the NO branch is deliberately limited to greetings and bare arithmetic.
const PREFILTER_SEARCH_VERB_RE = /\b(?:busca(?:me)?|buscar|busque|investiga(?:r)?|investigue|averigua(?:r)?|consulta(?:r)?|googlea|search|look\s+up|find\s+out|cherche|rechercher|suche|pesquise|procure)\b/i;
const PREFILTER_FRESH_RE = /\b(?:noticias?|news|nouvelles|nachrichten|clima|weather|meteo|meteorologia|pronosticos?|forecast|precios?|price|prices|cotizacion(?:es)?|exchange rate|tipo de cambio|resultados?|results?|score|marcador|standings|posiciones|elecciones?|elections?|taquilla|box office|estreno|release|lanzamiento|temperatura|temperature|bitcoin|cripto(?:moneda)?|crypto|dolar|dollar)\b/i;
const PREFILTER_ROLE_RE = /\b(?:quien(?:es)?|who(?:\s+is|\s+are)?|cual\s+es|what\s+is)\b[^.]{0,90}\b(?:presidente|president|alcalde|mayor|primer ministro|prime minister|gobernador|governor|campeon|champion|ganador|winner)\b/i;
const PREFILTER_OPINION_RE = /\b(?:opinas?|opinar|opinion|crees|consideras|piensas|think|opinion|would you say)\b/i;
// An explicit correction is a declaration that the previous fact was wrong,
// not a topic hint: "no es correcto, busca otras fuentes" must force a lookup
// even when the router would have believed the contaminated context again.
const PREFILTER_CORRECTION_RE = /\b(?:no es correct[oa]s?|no es asi|no es cierto|no es verdad|no esta bien|esta mal|incorrect[oa]s?|busca otras fuentes|otras fuentes|borra lo que dije|busca de nuevo|busca otra vez|intenta (?:otra vez|nuevamente|de nuevo)|revisa de nuevo|verifica de nuevo|corrige(?:me)?|not correct|that.s wrong|that is wrong|is wrong|wrong answer|wrong information|incorrect|try again|check again|other sources|another source|correct this)\b/i;
const PREFILTER_CORRECTION_STRIP_RE = new RegExp(PREFILTER_CORRECTION_RE.source, "gi");

// A correction names a fact, not a request to search for the word "correction".
// Strip the scaffolding before building the query; keep the original text as a
// last resort when the user did not actually name any fact to verify.
const correctionQuery = (text, maxQueryChars) => {
	const stripped = String(text || "")
		.replace(PREFILTER_CORRECTION_STRIP_RE, " ")
		.replace(/\b(?:la\s+|el\s+|las\s+|los\s+|the\s+)?informaci[oó]n\b/gi, " ")
		.replace(/\btranscripcion\b[^:\n]{0,60}:\s*/gi, " ")
		.replace(/\b(?:busca(?:me)?|buscar|busque|intenta|nuevamente|revisa|verifica|check|find|look up)\b/gi, " ")
		.replace(/^\s*(?:la|el|las|los|the)\s+/i, " ")
		.replace(/[¿¡,;:.!]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const query = short(cleanWebQuery(stripped), maxQueryChars);
	return query.length >= 3 ? query : short(String(text || "").trim(), maxQueryChars);
};
// Coincidencia completa anclada: un saludo dentro de una pregunta compuesta no
// debe convertirse en un NO automático. Las variantes largas van primero para
// que la alternancia no se quede con un prefijo más corto.
const PREFILTER_NO_RE = /^[¿¡\s]*(?:gracias por (?:tu|su|la) ayuda|gracias por ayudarme|muchisimas gracias|muchas gracias|thank you very much|thanks a lot|thank you|thanks|buenos dias|buenas tardes|buenas noches|buenas noches a todos|good morning|good afternoon|good evening|good night|hola|hi|hello|hey|ok|vale|genial|adios|nos vemos|hasta luego|hasta pronto|see you|bye|como estas|como va|que tal|que pasa|whats up|hows it going|how are you doing|how are you|bien gracias|muy bien|nice to meet you)\b[\s,!?.-]*(?:(?:how are you doing|how are you|how are you today|que tal|como estas|como va|whats up|a lot|muchas gracias|por (?:tu|su|la) ayuda)\b[\s,!?.-]*)?$/i;
const PREFILTER_MATH_RE = /^[¿¡\s]*(?:(?:cuanto es|calcula|what is|compute)\s+)?\(?\s*-?\d+(?:\s*[+\-*/x×]\s*-?\d+)+\s*\)?\s*[?!=]*$/i;

/**
 * Deterministic pre-classifier for the web decision. It never calls a model.
 *
 * @param {object} [options]
 * @param {string} [options.text] Current user message.
 * @param {string} [options.quotedText] Message the user is replying to.
 * @param {number} [options.maxQueryChars] Query cap.
 * @returns {{search: boolean, query: string, source: string}|null} `null` means
 *   the caller must ask the model; the other values skip that model call.
 */
export const prefilterWebDecision = ({ text = "", quotedText = "", maxQueryChars = 300 } = {}) => {
	const own = String(text || "").trim();
	const normalized = normalizeForMatch(own);
	if (!normalized) return null;

	const no = { search: false, query: "", source: "policy-no" };
	if (PREFILTER_NO_RE.test(normalized) || PREFILTER_MATH_RE.test(normalized)) return no;

	const quoted = String(quotedText || "").trim();
	// The user's own correction (or one in the message they reply to) skips the
	// router: it is an explicit instruction to verify, not a debatable topic.
	const correction = PREFILTER_CORRECTION_RE.test(normalized)
		|| (!!quoted && PREFILTER_CORRECTION_RE.test(normalizeForMatch(quoted)));
	if (correction) {
		const base = quoted && !PREFILTER_CORRECTION_RE.test(normalized)
			? `${quoted}\n${own}`
			: own;
		const query = correctionQuery(base, maxQueryChars);
		if (query) return { search: true, query, source: "policy-yes" };
	}

	// An opinion question must not be classified only by the nouns it mentions:
	// "¿qué opinas de las noticias de hoy?" is a request for a view, not a lookup.
	const opinion = PREFILTER_OPINION_RE.test(normalized);
	const explicit = PREFILTER_SEARCH_VERB_RE.test(normalized)
		|| isGenericWebInstruction(own)
		|| (!!quoted && PREFILTER_SEARCH_VERB_RE.test(normalizeForMatch(quoted)));
	const fresh = !opinion && (PREFILTER_FRESH_RE.test(normalized) || PREFILTER_ROLE_RE.test(normalized));
	const url = URL_RE.test(own);
	if (!explicit && !fresh && !url) return null;

	const query = short(
		cleanWebQuery(url ? own : (explicit ? (isGenericWebInstruction(own) && quoted ? quoted : own) : own)),
		maxQueryChars,
	);
	if (!query) return null;
	return { search: true, query, source: "policy-yes" };
};
