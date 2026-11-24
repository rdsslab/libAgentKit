/**
 * Web search for the agent kit.
 *
 * Default engine is DuckDuckGo's HTML endpoint; Bing HTML is the fallback. Both
 * are scraped, so parsers are exported for tests and an `http-json` provider is
 * available for deployments that already run a search endpoint.
 *
 * Always sends a browser User-Agent: requests without one were rejected with
 * 403 by the search engines.
 */

const DEFAULT_TIMEOUT = 20000;
const DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const decodeEntities = (value) => String(value || "")
	.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
	.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
	.replace(/&lt;/g, "<")
	.replace(/&gt;/g, ">")
	.replace(/&quot;/g, '"')
	.replace(/&#39;|&apos;/g, "'")
	.replace(/&nbsp;/g, " ")
	.replace(/&amp;/g, "&");

const stripTags = (value) => decodeEntities(String(value || "").replace(/<[^>]+>/g, " "))
	.replace(/\s+/g, " ")
	.trim();

const B64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const b64urlDecode = (input) => {
	const value = String(input || "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
	let output = "";
	let buffer = 0;
	let bits = 0;
	for (const char of value) {
		const index = B64_URL_ALPHABET.indexOf(char);
		if (index === -1) continue;
		buffer = (buffer << 6) | index;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			output += String.fromCharCode((buffer >> bits) & 0xff);
		}
	}
	return output;
};

// Bing wraps every result in /ck/a?u=<base64url>. Without unwrapping it, the
// model receives bing.com URLs instead of the real source (GitHub, LinkedIn...).
const fixSearchUrl = (raw) => {
	let url = decodeEntities(String(raw || "")).replace(/^\/\//, "https://");
	const bing = url.match(/[?&]u=([^&]+)/);
	if (/bing\.com\/ck\/a/.test(url) && bing) {
		let payload = bing[1];
		if (payload.startsWith("a1")) payload = payload.slice(2);
		const decoded = b64urlDecode(payload);
		if (/^https?:\/\//i.test(decoded)) url = decoded;
	}
	return resolveDuckDuckGoUrl(url);
};

const resolveDuckDuckGoUrl = (href) => {
	const raw = String(href || "").trim();
	if (!raw) {
		return "";
	}

	try {
		const parsed = new URL(raw, "https://duckduckgo.com");
		const target = parsed.searchParams.get("uddg");
		if (target) {
			return decodeURIComponent(target);
		}
		return parsed.toString();
	} catch {
		return raw;
	}
};

/**
 * Parses `html.duckduckgo.com/html/` result markup.
 *
 * @param {string} html
 * @param {number} [maxResults=5]
 * @returns {Array<{title: string, url: string, snippet: string}>}
 */
export const extractDuckDuckGoResults = (html, maxResults = 5) => {
	const source = String(html || "");
	const results = [];
	const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	const snippetPattern = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
	const snippets = [];
	let snippetMatch;

	while ((snippetMatch = snippetPattern.exec(source)) !== null) {
		snippets.push(stripTags(snippetMatch[1]));
	}

	let match;
	let index = 0;

	while ((match = linkPattern.exec(source)) !== null && results.length < maxResults) {
		const url = resolveDuckDuckGoUrl(match[1]);
		const title = stripTags(match[2]);
		if (!url || !title) {
			index += 1;
			continue;
		}
		results.push({
			title,
			url,
			snippet: snippets[index] || "",
		});
		index += 1;
	}

	return results;
};

/**
 * Parses `lite.duckduckgo.com/lite/` result markup (table layout).
 *
 * @param {string} html
 * @param {number} [maxResults=5]
 * @returns {Array<{title: string, url: string, snippet: string}>}
 */
export const extractDuckDuckGoLiteResults = (html, maxResults = 5) => {
	const source = String(html || "");
	const results = [];
	const linkPattern = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	const snippetPattern = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
	const snippets = [];
	let snippetMatch;

	while ((snippetMatch = snippetPattern.exec(source)) !== null) {
		snippets.push(stripTags(snippetMatch[1]));
	}

	let match;
	let index = 0;
	while ((match = linkPattern.exec(source)) !== null && results.length < maxResults) {
		results.push({
			title: stripTags(match[2]),
			url: resolveDuckDuckGoUrl(match[1]),
			snippet: snippets[index] || "",
		});
		index += 1;
	}

	return results.filter((result) => result.title && result.url);
};

/**
 * Parses Bing's `b_algo` result blocks.
 *
 * @param {string} html
 * @param {number} [maxResults=5]
 * @returns {Array<{title: string, url: string, snippet: string}>}
 */
export const extractBingResults = (html, maxResults = 5) => {
	const source = String(html || "");
	const blocks = source.split(/<li[^>]+class="[^"]*b_algo[^"]*"/i).slice(1);
	const results = [];

	for (const block of blocks) {
		if (results.length >= maxResults) {
			break;
		}

		const linkMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
		if (!linkMatch) {
			continue;
		}

		const url = fixSearchUrl(linkMatch[1]);
		const title = stripTags(linkMatch[2]);
		const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
			|| block.match(/class="b_caption"[^>]*>([\s\S]*?)<\/div>/i);

		if (!url || !title || !/^https?:\/\//i.test(url)) {
			continue;
		}

		results.push({
			title,
			url,
			snippet: snippetMatch ? stripTags(snippetMatch[1]) : "",
		});
	}

	return results;
};

/**
 * Parses Google News RSS, the fallback that still returns results when both
 * HTML search engines show a challenge page.
 */
export const extractGoogleNewsResults = (xml, maxResults = 5) => {
	const source = String(xml || "");
	const results = [];
	for (const item of source.match(/<item>[\s\S]*?<\/item>/gi) || []) {
		if (results.length >= maxResults) break;
		const title = item.match(/<title>([\s\S]*?)<\/title>/i);
		const link = item.match(/<link>([\s\S]*?)<\/link>/i);
		if (!title || !link) continue;
		const url = decodeEntities(link[1]).trim();
		if (!/^https?:\/\//i.test(url)) continue;
		const description = item.match(/<description>([\s\S]*?)<\/description>/i);
		const published = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
		let snippet = description ? stripTags(description[1]) : "";
		if (published) snippet = `${snippet ? `${snippet} ` : ""}(${stripTags(published[1])})`;
		results.push({ title: stripTags(title[1]), url, snippet });
	}
	return results;
};

const instantAnswerResults = (payload, query, maxResults = 5) => {
	const data = isPlainObject(payload) ? payload : {};
	const results = [];
	if (data.AbstractText) {
		results.push({
			title: `${data.Heading || query} (DuckDuckGo)`,
			url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
			snippet: String(data.AbstractText).slice(0, 700),
		});
	}
	const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
	for (const topic of topics) {
		if (results.length >= maxResults) break;
		if (!topic || topic.Topics || !topic.Text) continue;
		results.push({
			title: String(topic.Text).split(" - ")[0].slice(0, 120),
			url: String(topic.FirstURL || ""),
			snippet: String(topic.Text).slice(0, 400),
		});
	}
	return results;
};

const getFetch = (fetchImpl) => {
	const impl = fetchImpl || globalThis.fetch;
	if (typeof impl !== "function") {
		throw new Error("No fetch implementation is available for web search.");
	}
	return impl;
};

const buildSignal = (timeoutMs, externalSignal) => {
	const signals = [];
	if (externalSignal) {
		signals.push(externalSignal);
	}
	if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
		signals.push(AbortSignal.timeout(timeoutMs));
	}
	if (!signals.length) {
		return undefined;
	}
	if (signals.length === 1) {
		return signals[0];
	}
	return typeof AbortSignal.any === "function" ? AbortSignal.any(signals) : signals[0];
};

const requestHeaders = (provider) => ({
	"User-Agent": provider.userAgent || DEFAULT_USER_AGENT,
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": provider.language || "es-ES,es;q=0.9,en;q=0.8",
	...(provider.headers || {}),
});

const looksLikeSearchAnomalyPage = (html) => {
	const source = String(html || "");
	if (!source) return true;
	const lower = source.toLowerCase();
	if (lower.includes("anomaly.js") || lower.includes("anomaly-modal") || lower.includes("detected unusual traffic") || lower.includes("unusual traffic from your computer network")) {
		return true;
	}
	// Very small or challenge-like HTML without result markers.
	const hasResultMarkers = lower.includes("result__a") || lower.includes("result-link") || lower.includes("b_algo");
	if (!hasResultMarkers && /captcha|challenge|verify you are|enable javascript/i.test(source)) {
		return true;
	}
	return false;
};

const normalizeSearchQuery = (query) => {
	let q = String(query || "").trim();
	// Remove wrapping quotes and excessive whitespace; keep punctuation meaningful to intent.
	q = q.replace(/^["'¿¡\s]+|["'?!\s]+$/g, "").replace(/\s+/g, " ").trim();
	return q || String(query || "").trim();
};

/** Error with a stable `code` and a safe `userMessage` for search failures. */
export class WebSearchError extends Error {
	/**
	 * @param {string} message Internal diagnostic message.
	 * @param {{code?: string, userMessage?: string}} [options]
	 */
	constructor(message, { code = "WEB_SEARCH_FAILED", userMessage } = {}) {
		super(message);
		this.name = "WebSearchError";
		this.code = code;
		this.userMessage = userMessage || message;
	}
}

const duckDuckGoSearch = async ({ query, maxResults, provider, signal, fetchImpl }) => {
	const base = String(provider.baseUrl || "https://html.duckduckgo.com/html/").trim();
	const url = `${base}?q=${encodeURIComponent(query)}&kl=${encodeURIComponent(provider.region || "es-es")}`;
	const attempts = Math.max(1, Math.min(3, Number(provider.attempts ?? 2)));
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetchImpl(url, {
				method: "GET",
				headers: requestHeaders(provider),
				signal,
				redirect: "follow",
			});

			if (!response.ok) {
				throw new WebSearchError(`DuckDuckGo HTTP ${response.status}.`, { code: "WEB_SEARCH_HTTP" });
			}

			const html = await response.text();
			if (looksLikeSearchAnomalyPage(html)) {
				throw new WebSearchError("DuckDuckGo returned an anti-bot/challenge page.", { code: "WEB_SEARCH_BLOCKED" });
			}
			const results = extractDuckDuckGoResults(html, maxResults);
			if (results.length) {
				return { engine: "duckduckgo", results };
			}

			// Some deployments get the lite layout instead.
			const lite = extractDuckDuckGoLiteResults(html, maxResults);
			if (lite.length) {
				return { engine: "duckduckgo-lite", results: lite };
			}
			lastError = new WebSearchError("DuckDuckGo returned no parsable results.", { code: "WEB_SEARCH_NO_RESULTS" });
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError || new WebSearchError("DuckDuckGo returned no parsable results.", { code: "WEB_SEARCH_NO_RESULTS" });
};

const bingSearch = async ({ query, maxResults, provider, signal, fetchImpl }) => {
	const url = `${String(provider.baseUrl || "https://www.bing.com").replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&setlang=${encodeURIComponent(provider.language || "es")}&cc=${encodeURIComponent(provider.country || "es")}`;
	const response = await fetchImpl(url, {
		method: "GET",
		headers: requestHeaders(provider),
		signal,
		redirect: "follow",
	});

	if (!response.ok) {
		throw new WebSearchError(`Bing HTTP ${response.status}.`, { code: "WEB_SEARCH_HTTP" });
	}

	const html = await response.text();
	if (looksLikeSearchAnomalyPage(html)) {
		throw new WebSearchError("Bing returned an anti-bot/challenge page.", { code: "WEB_SEARCH_BLOCKED" });
	}
	const results = extractBingResults(html, maxResults);
	if (!results.length) {
		throw new WebSearchError("Bing returned no parsable results.", { code: "WEB_SEARCH_NO_RESULTS" });
	}

	return { engine: "bing", results };
};

const googleNewsSearch = async ({ query, maxResults, provider, signal, fetchImpl }) => {
	const base = String(provider.baseUrl || "https://news.google.com/rss/search").replace(/\/+$/, "");
	const language = provider.language || "es";
	const country = provider.country || "ES";
	const url = `${base}?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(country)}&ceid=${encodeURIComponent(`${country}:${language}`)}`;
	const response = await fetchImpl(url, {
		method: "GET",
		headers: requestHeaders(provider),
		signal,
		redirect: "follow",
	});
	if (!response.ok) {
		throw new WebSearchError(`Google News HTTP ${response.status}.`, { code: "WEB_SEARCH_HTTP" });
	}
	const results = extractGoogleNewsResults(await response.text(), maxResults);
	if (!results.length) {
		throw new WebSearchError("Google News returned no parsable results.", { code: "WEB_SEARCH_NO_RESULTS" });
	}
	return { engine: "google-news", results };
};

const duckDuckGoInstantSearch = async ({ query, maxResults, provider, signal, fetchImpl }) => {
	const base = String(provider.baseUrl || "https://api.duckduckgo.com").replace(/\/+$/, "");
	const url = `${base}/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
	const response = await fetchImpl(url, {
		method: "GET",
		headers: requestHeaders(provider),
		signal,
		redirect: "follow",
	});
	if (!response.ok) {
		throw new WebSearchError(`DuckDuckGo Instant Answer HTTP ${response.status}.`, { code: "WEB_SEARCH_HTTP" });
	}
	const payload = await response.json().catch(() => null);
	const results = instantAnswerResults(payload, query, maxResults);
	if (!results.length) {
		throw new WebSearchError("DuckDuckGo Instant Answer returned no usable results.", { code: "WEB_SEARCH_NO_RESULTS" });
	}
	return { engine: "duckduckgo-instant", results };
};

const httpJsonSearch = async ({ query, maxResults, provider, signal, fetchImpl }) => {
	const url = provider.url || provider.baseUrl;
	if (!url) {
		throw new WebSearchError(`Search provider "${provider.name}" requires a url.`, {
			code: "WEB_SEARCH_NOT_CONFIGURED",
			userMessage: "Web search is not configured: the service URL is missing."
		});
	}

	const method = String(provider.method || "POST").toUpperCase();
	const headers = { "Content-Type": "application/json", ...(provider.headers || {}) };
	let finalUrl = String(url);
	let body;

	if (method === "GET") {
		const target = new URL(finalUrl);
		target.searchParams.set(provider.queryParam || "q", query);
		target.searchParams.set(provider.limitParam || "limit", String(maxResults));
		finalUrl = target.toString();
	} else {
		body = JSON.stringify({
			[provider.queryField || "query"]: query,
			[provider.limitField || "max_results"]: maxResults,
		});
	}

	if (provider.apiKey) {
		headers.Authorization = `Bearer ${provider.apiKey}`;
	}

	const response = await fetchImpl(finalUrl, { method, headers, body, signal });
	if (!response.ok) {
		throw new WebSearchError(`Search provider HTTP ${response.status}.`, { code: "WEB_SEARCH_HTTP" });
	}

	const payload = await response.json().catch(() => null);
	const rows = Array.isArray(payload) ? payload : (payload?.results || payload?.data || []);
	const results = rows.slice(0, maxResults).map((row) => ({
		title: String(row.title ?? row.name ?? "").trim(),
		url: String(row.url ?? row.link ?? "").trim(),
		snippet: String(row.snippet ?? row.description ?? row.text ?? "").trim(),
	})).filter((row) => row.title || row.url);

	if (!results.length) {
		throw new WebSearchError("The search provider returned no results.", { code: "WEB_SEARCH_NO_RESULTS" });
	}

	return { engine: provider.name || "http-json", results };
};

const engines = {
	duckduckgo: duckDuckGoSearch,
	bing: bingSearch,
	"google-news": googleNewsSearch,
	"duckduckgo-instant": duckDuckGoInstantSearch,
	"http-json": httpJsonSearch,
};

/** @returns {string[]} Registered engine names. */
export const listWebSearchEngines = () => Object.keys(engines);

/**
 * @param {string|{query?: string}} queryOrOptions
 * @param {{maxResults?: number, provider?: string|object, providers?: object, engine?: string, timeoutMs?: number, fetchImpl?: Function, signal?: AbortSignal}} [options]
 * @returns {Promise<{ok: boolean, query: string, source: string, results: Array<{title: string, url: string, snippet: string}>, note?: string, errors?: string[]}>}
 */
export const webSearch = async (queryOrOptions, options = {}) => {
	const config = isPlainObject(queryOrOptions) ? { ...queryOrOptions, ...options } : { ...options, query: queryOrOptions };
	const rawQuery = String(config.query || "").trim();
	const query = normalizeSearchQuery(rawQuery);
	const maxResults = Math.max(1, Math.min(10, Number(config.maxResults ?? 5)));
	const timeoutMs = Number(config.timeoutMs ?? DEFAULT_TIMEOUT);

	if (!query) {
		throw new WebSearchError("A search query is required.", {
			code: "WEB_SEARCH_QUERY_REQUIRED",
			userMessage: "A search query is required."
		});
	}

	const fetchImpl = getFetch(config.fetchImpl);
	const signal = buildSignal(timeoutMs, config.signal);
	const providers = isPlainObject(config.providers) ? config.providers : {};
	const requested = config.provider ?? config.engine ?? "auto";

	const buildProvider = (name) => {
		const configured = providers[name];
		if (isPlainObject(configured)) {
			return { ...configured, name };
		}
		if (configured === false) {
			return null;
		}
		if (typeof configured === "string") {
			return { name, type: configured };
		}
		return { name, type: name };
	};

	const chain = [];
	if (requested !== "auto") {
		const explicit = buildProvider(String(requested));
		if (!explicit) {
			throw new WebSearchError(`Search provider "${requested}" is disabled.`, {
				code: "WEB_SEARCH_PROVIDER_DISABLED",
				userMessage: `The search provider "${requested}" is disabled.`
			});
		}
		chain.push(explicit);
	} else {
		const defaultEngines = ["duckduckgo", "bing", "google-news", "duckduckgo-instant"];
		const configuredNames = Object.keys(providers);
		const names = configuredNames.length
			? [...defaultEngines.filter((name) => !Object.prototype.hasOwnProperty.call(providers, name)), ...configuredNames]
			: defaultEngines;

		const seen = new Set();
		for (const name of names) {
			if (seen.has(name)) {
				continue;
			}
			seen.add(name);

			const provider = buildProvider(name);
			if (provider) {
				chain.push(provider);
			}
		}
	}

	if (!chain.length) {
		throw new WebSearchError("Web search is not configured.", {
			code: "WEB_SEARCH_NOT_CONFIGURED",
			userMessage: "Web search is not configured on this server."
		});
	}

	const errors = [];

	for (const provider of chain) {
		const type = String(provider.type || provider.name || "duckduckgo").toLowerCase();
		const engine = engines[type];

		if (!engine) {
			errors.push(`${provider.name || type}: unsupported engine "${type}"`);
			continue;
		}

		try {
			const result = await engine({
				query,
				maxResults,
				provider,
				signal,
				fetchImpl,
			});

			return {
				ok: true,
				query,
				source: provider.name || result.engine,
				results: result.results.slice(0, maxResults),
				note: provider.note,
				providersTried: chain.map((p) => p.name || p.type || "unknown"),
			};
		} catch (error) {
			errors.push(`${provider.name || type}: ${error?.message || error}`);
		}
	}

	// Returning ok:false instead of throwing lets the caller answer "I could not
	// verify this" instead of failing the whole turn.
	return {
		ok: false,
		query,
		source: null,
		results: [],
		note: "Web search did not return any usable results.",
		errors,
		providersTried: chain.map((p) => p.name || p.type || "unknown"),
	};
};

/**
 * Creates a reusable search function with fixed defaults.
 *
 * @param {object} [defaults] Defaults merged before each call.
 * @returns {(queryOrOptions: string|object, options?: object) => Promise<object>}
 */
export const createWebSearch = (defaults = {}) => (queryOrOptions, options = {}) => {
	const config = isPlainObject(queryOrOptions)
		? { ...defaults, ...queryOrOptions, ...options }
		: { ...defaults, ...options, query: queryOrOptions };
	return webSearch(config);
};
