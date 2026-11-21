/**
 * Helpers compartidos entre el runner E2E y sus tests unitarios.
 *
 * Vivir en `tests/` (y no en `src/`) es intencionado: son reglas de puntuación
 * del harness, no del proveedor.
 */
import { extractCodeBlocks } from "../../src/utils/response-cleaner.js";

export const sanitizeToolName = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_]+/g, "_")
  .replace(/^_+|_+$/g, "");

const JS_KEYS = ["js", "javascript", "node", "mjs", "cjs"];
const HTML_KEYS = ["html", "htm"];

export const normalizeBlockKey = (language) => {
  const key = String(language || "").toLowerCase().trim();
  if (JS_KEYS.includes(key)) return "js";
  if (HTML_KEYS.includes(key)) return "html";
  return key || null;
};

/** Extrae el bloque del idioma pedido aceptando alias (`js`, `javascript`, ...). */
export const firstBlock = (text, language) => {
  const blocks = extractCodeBlocks(text);
  const target = normalizeBlockKey(language);
  const match = blocks.find((block) => normalizeBlockKey(block.language) === target);
  return match?.code || blocks[0]?.code || text.trim();
};

/**
 * Agrupa bloques por clave canónica (`html`, `css`, `js`) para que un bloque
 * etiquetado como `javascript` no se cuente como ausente.
 */
export const blocksByLanguage = (text) => {
  const byLanguage = {};
  for (const block of extractCodeBlocks(text)) {
    const key = normalizeBlockKey(block.language);
    if (key && !byLanguage[key]) byLanguage[key] = block.code;
  }
  if (!byLanguage.html) {
    const html = String(text || "").match(/<!DOCTYPE[\s\S]*?<\/html>/i);
    if (html) byLanguage.html = html[0];
  }
  return byLanguage;
};

const LANDING_FILES = ["html", "css", "js"];

/** Archivos que faltan tras contar también los assets incrustados en el HTML. */
export const missingBlockLanguages = (text, { embedded = {} } = {}) => {
  const bloques = blocksByLanguage(text);
  return LANDING_FILES.filter((key) => !bloques[key] && !embedded[key]);
};

/** Combina respuestas parciales: el primer bloque válido de cada idioma gana. */
export const mergeBlocks = (...texts) => {
  const merged = {};
  for (const text of texts) {
    for (const [key, code] of Object.entries(blocksByLanguage(text))) {
      if (!merged[key] && code) merged[key] = code;
    }
  }
  return merged;
};

/**
 * Contrato de la suite `web-complex`: etiqueta de bloque -> nombre de archivo.
 * Las etiquetas solo usan `[A-Za-z0-9-]` para que `extractCodeBlocks()` las
 * acepte; el nombre real se declara además en la primera línea del bloque.
 */
export const MULTIPAGE_BLOCKS = Object.freeze({
  "html-index": "index.html",
  "html-servicios": "servicios.html",
  "html-precios": "precios.html",
  "html-contacto": "contacto.html",
  css: "style.css",
  js: "script.js",
});

const PATH_COMMENTS = [
  [/^\s*<!--\s*([\w.-]+\.(?:html|css|js))\s*-->/i, 1],
  [/^\s*\/\*\s*([\w.-]+\.(?:html|css|js))\s*\*\//i, 1],
  [/^\s*\/\/\s*([\w.-]+\.(?:html|css|js))\s*$/i, 1],
];

const pathFromBlock = (block) => {
  const tag = String(block.language || "").toLowerCase().trim();
  if (MULTIPAGE_BLOCKS[tag]) return MULTIPAGE_BLOCKS[tag];
  if (/^[\w.-]+\.(?:html|css|js)$/i.test(tag)) return tag;
  const firstLine = String(block.code || "").split(/\r?\n/, 1)[0];
  for (const [pattern, group] of PATH_COMMENTS) {
    const match = firstLine.match(pattern);
    if (match) return match[group];
  }
  return null;
};

const stripPathComment = (code) => String(code || "")
  .replace(/^\s*<!--\s*[\w.-]+\.(?:html|css|js)\s*-->\s*\r?\n?/i, "")
  .replace(/^\s*\/\*\s*[\w.-]+\.(?:html|css|js)\s*\*\/\s*\r?\n?/i, "")
  .replace(/^\s*\/\/\s*[\w.-]+\.(?:html|css|js)\s*\r?\n?/i, "")
  .trim();

/**
 * Agrupa bloques por nombre de archivo (no por idioma). Varios bloques `html-*`
 * dejan de colapsar en una sola clave `html`. El primer bloque válido gana.
 */
export const blocksByPath = (text) => {
  const byPath = {};
  for (const block of extractCodeBlocks(text)) {
    const filePath = pathFromBlock(block);
    if (filePath && !byPath[filePath]) byPath[filePath] = stripPathComment(block.code);
  }
  return byPath;
};

/** Archivos del contrato multipágina que no aparecieron en la respuesta. */
export const missingBlockPaths = (text) => Object.values(MULTIPAGE_BLOCKS)
  .filter((filePath) => !blocksByPath(text)[filePath]);

/** Etiqueta de bloque que el modelo debe usar para un archivo dado. */
export const blockTagForPath = (filePath) => Object.keys(MULTIPAGE_BLOCKS)
  .find((tag) => MULTIPAGE_BLOCKS[tag] === filePath) || null;

/** Combina respuestas parciales de la suite multipágina por nombre de archivo. */
export const mergePathBlocks = (...texts) => {
  const merged = {};
  for (const text of texts) {
    for (const [filePath, code] of Object.entries(blocksByPath(text))) {
      if (!merged[filePath] && code) merged[filePath] = code;
    }
  }
  return merged;
};

/** Número de delimitadores ``` (par = bloques cerrados, impar = truncado). */
export const fenceBalance = (text) => (String(text || "").match(/```/g) || []).length;

const coincideExtension = (filePath, language) => {
  const tag = String(language || "").toLowerCase().trim();
  if (filePath.endsWith(".css")) return /(^|-)css/.test(tag) || tag === filePath.replace(/\.css$/, "");
  if (filePath.endsWith(".js")) return /^(js|javascript|mjs|node|cjs)$/.test(tag) || /js$/.test(tag);
  return /^(html|htm|html-[\w-]+)$/.test(tag) || /^[\w-]*html[\w-]*$/.test(tag);
};

/**
 * Extrae el bloque completo de una respuesta de **un solo archivo**. Primero
 * exige el nombre exacto; si el modelo usó una etiqueta genérica (`html`,
 * `javascript`), acepta el primer bloque cerrado del tipo correcto. Nunca
 * devuelve código de un fence sin cerrar.
 */
export const blockForPath = (text, filePath) => {
  const exacto = blocksByPath(text)[filePath];
  if (exacto) return { code: exacto, completo: true, fuente: "path" };
  for (const block of extractCodeBlocks(text)) {
    if (block.code && coincideExtension(filePath, block.language)) {
      return { code: stripPathComment(block.code), completo: true, fuente: "tipo" };
    }
  }
  return { code: null, completo: false, fuente: null };
};
