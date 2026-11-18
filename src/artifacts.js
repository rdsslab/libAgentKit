/**
 * Artifacts: the `create_file` tool contract.
 *
 * The package never assumes HOW a PDF or an image is rendered. The host
 * injects a renderer:
 *
 *   const { createFileTool } = require("@rdsslab/agentkit");
 *   const tool = createFileTool({
 *     renderPdf: (html) => createPDF(html),      // any function returning a Buffer
 *     renderImage: (html, { type }) => createImage(html, type),
 *   });
 *
 * Text formats (text, json, csv, markdown, html) never touch a browser: they
 * are plain buffers built here.
 *
 * A built-in renderer is available for hosts that install Chromium themselves
 * (`npm i puppeteer-core @sparticuz/chromium`): `loadDefaultRenderer()` picks
 * it up with a dynamic import, so neither library is a dependency of this
 * package and the install stays light.
 */

const DEFAULT_MAX_CHARS = 200000;

const TEXT_FORMATS = {
	text: { extension: "txt", mime: "text/plain" },
	markdown: { extension: "md", mime: "text/markdown" },
	json: { extension: "json", mime: "application/json" },
	csv: { extension: "csv", mime: "text/csv" },
	html: { extension: "html", mime: "text/html" },
};

export const ARTIFACT_FORMATS = ["pdf", "image", ...Object.keys(TEXT_FORMATS)];

export const FILE_TOOL_DESCRIPTION =
	"Genera un archivo y lo envia al usuario. Formatos: pdf, image (png/jpeg), html, text, json, markdown, csv. "
	+ "Usalo cuando el usuario pida un archivo, un PDF, una imagen, un JSON, un TXT o codigo fuente en un archivo. "
	+ "En `content` escribe el contenido final del archivo (texto plano, codigo, JSON o HTML). "
	+ "Para pdf e image el contenido puede ser HTML; si no lo es, se muestra como texto preformateado. "
	+ "Despues de llamarla, responde solo con una confirmacion breve: el archivo ya se envio.";

export const FILE_TOOL_PARAMETERS = {
	type: "object",
	properties: {
		format: {
			type: "string",
			enum: ARTIFACT_FORMATS,
			description: "Formato del archivo a generar",
		},
		content: {
			type: "string",
			description: "Contenido final del archivo: texto, codigo, JSON o HTML segun el formato",
		},
		filename: {
			type: "string",
			description: "Nombre del archivo sin extension (opcional)",
		},
		title: {
			type: "string",
			description: "Titulo que se muestra arriba en PDF e imagen (opcional)",
		},
		image_type: {
			type: "string",
			enum: ["png", "jpeg"],
			description: "Formato de la imagen cuando format=image (por defecto png)",
		},
	},
	required: ["format", "content"],
};

const escapeHtml = (value) => String(value == null ? "" : value)
	.replace(/&/g, "&#38;")
	.replace(/</g, "&#60;")
	.replace(/>/g, "&#62;")
	.replace(/"/g, "&#34;");

/** True when the content already is an HTML document (or a fragment of one). */
export const looksLikeHtml = (text) => /^\s*(<!doctype\s+html|<html\b|<head\b|<body\b|<div\b|<h[1-6]\b|<p\b|<table\b|<ul\b|<ol\b|<pre\b|<section\b|<article\b|<style\b)/i
	.test(String(text || ""));

/**
 * Plain text and code are rendered as a preformatted document; content that is
 * already HTML is used as-is (that is the "html -> pdf/image" path).
 */
export const artifactHtml = (content, title) => {
	const head = '<meta charset="utf-8">';
	const heading = title ? "<h1>" + escapeHtml(title) + "</h1>" : "";
	if (looksLikeHtml(content)) {
		if (title && /<body[^>]*>/i.test(content)) {
			return content.replace(/<body([^>]*)>/i, "<body$1>" + heading);
		}
		return title ? head + "<body>" + heading + content + "</body>" : content;
	}
	return (
		"<!doctype html><html><head>" + head
		+ "<style>body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:28px;"
		+ "line-height:1.5;color:#16181d;white-space:pre-wrap;word-wrap:break-word}"
		+ "h1{font-size:20px;margin:0 0 18px;font-weight:600}</style>"
		+ "</head><body>" + heading + escapeHtml(content) + "</body></html>"
	);
};

/** Filesystem-safe name: only letters, digits, dot, dash and underscore. */
export const safeFileName = (name, fallback = "archivo") => {
	const clean = String(name || "")
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 80);
	// "." and ".." are valid file names but not valid *targets*: a host that
	// joins this with a directory would write outside of it.
	if (!clean || /^\.+$/.test(clean)) {
		return fallback;
	}
	return clean;
};

const toBuffer = (value) => {
	if (Buffer.isBuffer(value)) {
		return value;
	}
	if (value instanceof Uint8Array) {
		return Buffer.from(value);
	}
	if (typeof value === "string") {
		return Buffer.from(value, "utf8");
	}
	throw new Error("El renderer devolvio un valor que no es un Buffer");
};

/**
 * Builds the file the user asked for.
 *
 * @param {object} input `{ format, content, filename, title, image_type }`
 * @param {object} [deps] `{ renderPdf, renderImage }` renderers injected by the host
 * @returns {Promise<{buffer: Buffer, filename: string, mime: string}|{error: string, code?: string}>}
 */
export const buildArtifact = async (input = {}, deps = {}) => {
	const { renderPdf, renderImage } = deps;
	const format = String(input.format || "text").toLowerCase().trim();
	let content = String(input.content == null ? "" : input.content);
	const maxChars = Number(input.maxChars) > 0 ? Number(input.maxChars) : DEFAULT_MAX_CHARS;

	if (!content.trim()) {
		return { error: "El contenido del archivo esta vacio", code: "ARTIFACT_EMPTY" };
	}
	if (content.length > maxChars) {
		content = content.slice(0, maxChars) + "\n\n...[contenido truncado]";
	}

	const title = String(input.title || "").trim();
	const fallback = "respuesta-" + new Date().toISOString().slice(0, 10);
	const base = safeFileName(input.filename, fallback);

	if (format === "pdf") {
		if (typeof renderPdf !== "function") {
			return {
				error: "Este servidor no puede generar PDF (falta un renderer de PDF)",
				code: "ARTIFACT_RENDERER_UNAVAILABLE",
			};
		}
		try {
			const pdf = await renderPdf(artifactHtml(content, title), { title, filename: base + ".pdf" });
			return { buffer: toBuffer(pdf), filename: base + ".pdf", mime: "application/pdf" };
		} catch (error) {
			return { error: "No pude generar el PDF: " + String(error?.message || error).slice(0, 160), code: "ARTIFACT_RENDER_FAILED" };
		}
	}

	if (format === "image") {
		if (typeof renderImage !== "function") {
			return {
				error: "Este servidor no puede generar imagenes (falta un renderer de imagen)",
				code: "ARTIFACT_RENDERER_UNAVAILABLE",
			};
		}
		const type = String(input.image_type || "png").toLowerCase() === "jpeg" ? "jpeg" : "png";
		try {
			const shot = await renderImage(artifactHtml(content, title), { title, filename: base, type });
			return {
				buffer: toBuffer(shot),
				filename: base + (type === "jpeg" ? ".jpg" : ".png"),
				mime: type === "jpeg" ? "image/jpeg" : "image/png",
			};
		} catch (error) {
			return { error: "No pude generar la imagen: " + String(error?.message || error).slice(0, 160), code: "ARTIFACT_RENDER_FAILED" };
		}
	}

	if (format === "html") {
		const html = looksLikeHtml(content) ? content : artifactHtml(content, title);
		return { buffer: Buffer.from(html, "utf8"), filename: base + ".html", mime: "text/html" };
	}

	if (format === "json") {
		let payload = content;
		try {
			JSON.parse(content);
		} catch {
			payload = JSON.stringify({ content }, null, 2);
		}
		return { buffer: Buffer.from(payload, "utf8"), filename: base + ".json", mime: "application/json" };
	}

	const text = TEXT_FORMATS[format] || TEXT_FORMATS.text;
	return { buffer: Buffer.from(content, "utf8"), filename: base + "." + text.extension, mime: text.mime };
};

/**
 * The `create_file` tool, ready to be handed to `askAgent` as a local tool.
 *
 *   const tools = { create_file: createFileTool({ renderPdf, renderImage }) };
 *
 * The handler returns the artifact (`{ ok, file, mime, bytes, artifact }`) so
 * the host decides how to deliver it: Telegram, an HTTP response, a file on
 * disk, an object store...
 *
 * @param {object} [deps] `{ renderPdf, renderImage }`
 * @returns {{name: string, description: string, parameters: object, handler: Function}}
 */
export const createFileTool = (deps = {}) => ({
	name: "create_file",
	description: FILE_TOOL_DESCRIPTION,
	parameters: FILE_TOOL_PARAMETERS,
	handler: async (args) => {
		const artifact = await buildArtifact(args || {}, deps);
		if (artifact.error) {
			return { ok: false, error: artifact.error, code: artifact.code };
		}
		return {
			ok: true,
			file: artifact.filename,
			mime: artifact.mime,
			bytes: artifact.buffer.length,
			artifact,
		};
	},
});

/**
 * Built-in renderer for hosts that installed Chromium themselves.
 *
 * `npm i puppeteer-core @sparticuz/chromium` (or a local Chrome plus
 * `chrome-launcher`) enables it; without them the function returns null and
 * the caller decides what to do.
 *
 * @returns {Promise<{renderPdf: Function, renderImage: Function}|null>}
 */
export const loadDefaultRenderer = async () => {
	let puppeteer;
	let chromium = null;
	try {
		({ default: puppeteer } = await import("puppeteer-core"));
	} catch {
		return null;
	}
	try {
		({ default: chromium } = await import("@sparticuz/chromium"));
	} catch {
		// A local Chrome is fine too: the path comes from the environment.
	}

	let browser = null;
	let browserPromise = null;
	const getBrowser = async () => {
		if (browser) {
			return browser;
		}
		if (browserPromise) {
			return browserPromise;
		}

		browserPromise = (async () => {
			const executablePath = chromium
				? await chromium.executablePath()
				: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
			const launched = await puppeteer.launch({
				executablePath,
				args: chromium ? chromium.args : ["--no-sandbox", "--disable-dev-shm-usage"],
				headless: chromium ? chromium.headless : true,
				defaultViewport: chromium ? chromium.defaultViewport : { width: 1280, height: 900 },
			});
			browser = launched;
			return launched;
		})();

		try {
			return await browserPromise;
		} finally {
			if (!browser) {
				browserPromise = null;
			}
		}
	};

	const render = async (html, { type, format = "A4" } = {}) => {
		const active = await getBrowser();
		const page = await active.newPage();
		try {
			await page.setViewport({ width: 1280, height: 900 });
			await page.setContent(html, { waitUntil: "networkidle0", url: "http://localhost" });
			if (type) {
				return await page.screenshot({ type, quality: type === "jpeg" ? 90 : undefined, fullPage: true });
			}
			return await page.pdf({ format, printBackground: true, preferCSSPageSize: true });
		} finally {
			await page.close().catch(() => {});
		}
	};

	return {
		renderPdf: (html) => render(html, {}),
		renderImage: (html, { type } = {}) => render(html, { type: type || "png" }),
		close: async () => {
			const current = browser || browserPromise;
			browser = null;
			browserPromise = null;
			const instance = current ? await current.catch?.(() => null) ?? await current : null;
			if (instance) {
				await instance.close().catch(() => {});
			}
		},
	};
};
