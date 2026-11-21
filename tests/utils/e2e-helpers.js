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
