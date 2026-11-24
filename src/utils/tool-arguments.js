/**
 * Normalización defensiva de argumentos de herramientas.
 *
 * Los modelos pequeños a veces rellenan el objeto del schema en vez del valor:
 * `{ query: { type: "string", description: "...", value: "capital de Ecuador" } }`.
 * El proveedor ya normaliza antes de despachar; esta capa se aplica también en
 * `askAgent()` para que cualquier handler (incluidos los inyectados por el
 * llamador) reciba valores limpios, no envoltorios del schema.
 */

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const safeJsonParse = (value, fallbackValue = {}) => {
	if (isPlainObject(value) || Array.isArray(value)) return value;
	if (typeof value !== "string") return fallbackValue;
	try {
		const parsed = JSON.parse(value);
		return parsed == null ? fallbackValue : parsed;
	} catch {
		return fallbackValue;
	}
};

const WRAPPER_KEYS = new Set(["value", "type", "description", "title", "default", "examples"]);
const MAX_UNWRAP_DEPTH = 4;

/**
 * Unwraps repeated `{value, type, description, ...}` schema wrappers.
 *
 * @param {*} value
 * @param {number} [depth=0]
 * @returns {*} Clean value, at most four levels deep.
 */
export function unwrapToolArgumentValue(value, depth = 0) {
	if (Array.isArray(value)) {
		if (depth >= MAX_UNWRAP_DEPTH) return value;
		return value.map((item) => unwrapToolArgumentValue(item, depth + 1));
	}
	if (!isPlainObject(value) || depth >= MAX_UNWRAP_DEPTH) return value;
	if (!Object.prototype.hasOwnProperty.call(value, "value")) return value;

	const keys = Object.keys(value);
	const looksLikeSchemaWrapper = keys.every((key) => WRAPPER_KEYS.has(key));
	return looksLikeSchemaWrapper ? unwrapToolArgumentValue(value.value, depth + 1) : value;
}

/**
 * Parses tool arguments (JSON string or object) and cleans each top-level entry.
 *
 * @param {*} value
 * @returns {object} Plain object of clean arguments.
 */
export function normalizeToolArguments(value) {
	let parsed = value;
	if (!isPlainObject(parsed) && !Array.isArray(parsed)) {
		parsed = safeJsonParse(value, {});
	}
	if (!isPlainObject(parsed)) return {};

	const normalized = {};
	for (const [key, entry] of Object.entries(parsed)) {
		normalized[key] = unwrapToolArgumentValue(entry);
	}
	return normalized;
}

export default { unwrapToolArgumentValue, normalizeToolArguments };
