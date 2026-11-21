/**
 * Generación multi-archivo por descomposición de tareas.
 *
 * Los modelos pequeños fallan sobre todo en el CUMPLIMIENTO DEL FORMATO: una
 * sola petición que pide HTML + CSS + JS en tres bloques suele devolver solo
 * el primero. En lugar de pedir los tres a la vez, el harness pide un archivo
 * por turno con un system prompt específico y extrae ese único bloque.
 *
 * Es una utilidad opcional del harness. El core del proveedor sigue siendo
 * agnóstico: aquí solo se orquestan llamadas a `askAgent`.
 */

import { askAgent } from "../agent.js";
import { getSystemPrompt } from "./system-prompts-en.js";

export const MULTI_FILE_TEMPLATES = {
  landing: [
    {
      key: "html",
      fileName: "index.html",
      language: "html",
      instruction: "Incluye DOCTYPE, etiquetas semánticas, header, formulario accesible y enlaces a style.css y script.js. No incrustes CSS ni JS.",
    },
    {
      key: "css",
      fileName: "style.css",
      language: "css",
      instruction: "Incluye :root con variables, box-sizing, estilos de body, :hover y al menos una media query. No incluyas HTML.",
    },
    {
      key: "js",
      fileName: "script.js",
      language: "javascript",
      instruction: "Usa JavaScript vanilla, addEventListener, DOM ready y validación de formulario. No incluyas HTML ni CSS.",
    },
  ],
};

const TASK_TYPE_BY_LANGUAGE = {
  html: "html",
  htm: "html",
  css: "css",
  js: "js",
  javascript: "js",
  python: "code",
  py: "code",
};

/** Los modelos pequeños suelen envolver el CSS/JS en etiquetas aunque se les pida un archivo. */
export function stripWrapperTags(language, texto = "") {
  const value = String(texto || "").trim();
  const normalizado = String(language || "").toLowerCase();
  if (normalizado === "css") {
    const partido = value.match(/^<style[^>]*>([\s\S]*?)<\/style>$/i);
    if (partido) return partido[1].trim();
  }
  if (["js", "javascript"].includes(normalizado)) {
    const partido = value.match(/^<script[^>]*>([\s\S]*?)<\/script>$/i);
    if (partido) return partido[1].trim();
  }
  return value;
}

export const taskTypeForLanguage = (language) => TASK_TYPE_BY_LANGUAGE[String(language || "").toLowerCase()] || "code";

/** Compone los archivos generados en un único texto con bloques etiquetados. */
export function buildBlockBundle(archivos = {}, files = MULTI_FILE_TEMPLATES.landing) {
  return files
    .filter((file) => archivos[file.key]?.texto)
    .map((file) => `\`\`\`${file.language}\n${archivos[file.key].texto.trim()}\n\`\`\``)
    .join("\n\n");
}

/**
 * Genera cada archivo en una llamada separada.
 *
 * @param {object} options
 * @param {object} options.provider Configuración base del proveedor.
 * @param {string} options.brief Descripción global del resultado.
 * @param {Array<object>} [options.files] Archivos a generar.
 * @param {string} [options.idioma] Idioma del system prompt ("en"|"es").
 * @param {Object<string, Function>} [options.validators] Validadores opcionales por key.
 * @param {number} [options.maxTokensPorArchivo]
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.parallel=false] Genera los archivos en paralelo (por defecto secuencial).
 * @param {number} [options.concurrency=3] Tope de llamadas simultáneas cuando `parallel`.
 * @param {Function} [options.ask] Inyectable en tests; por defecto `askAgent`.
 */
export async function generateMultiFile({
  provider,
  brief,
  files = MULTI_FILE_TEMPLATES.landing,
  idioma = "en",
  validators = {},
  maxTokensPorArchivo,
  signal,
  parallel = false,
  concurrency = 3,
  ask = askAgent,
} = {}) {
  const definitions = Array.isArray(files) ? files : [];
  const archivos = {};
  const usageByIndex = [];

  const generateOne = async (file, index) => {
    const system = getSystemPrompt(taskTypeForLanguage(file.language), idioma);
    const prompt = [
      brief,
      `Genera ÚNICAMENTE el contenido del archivo ${file.fileName || file.key} (${file.language || "texto"}).`,
      file.instruction,
      "Devuelve solo el código del archivo, sin explicaciones ni bloques markdown.",
    ].filter(Boolean).join("\n\n");

    const startedAt = Date.now();
    try {
      const resultado = await ask({
        provider: {
          ...provider,
          system,
          ...(Number(maxTokensPorArchivo) > 0
            ? { maxTokens: maxTokensPorArchivo, max_tokens: maxTokensPorArchivo }
            : {}),
        },
        messages: [{ role: "user", content: prompt }],
        responseProcessing: {
          extractCodeBlocks: true,
          detectRefusal: true,
          validateMinimumContent: true,
          language: file.language,
        },
        includeDiagnostics: false,
        signal,
      });

      const texto = stripWrapperTags(file.language, resultado?.text);
      const validador = validators?.[file.key];
      const validacion = typeof validador === "function"
        ? await validador(texto, file)
        : null;
      if (resultado?.usage) usageByIndex[index] = resultado.usage;

      archivos[file.key] = {
        key: file.key,
        fileName: file.fileName,
        language: file.language,
        texto,
        ok: texto.length > 0 && validacion?.valido !== false,
        validacion,
        duracionMs: Date.now() - startedAt,
        usage: resultado?.usage || null,
        error: texto ? null : "respuesta vacía",
      };
    } catch (error) {
      archivos[file.key] = {
        key: file.key,
        fileName: file.fileName,
        language: file.language,
        texto: "",
        ok: false,
        validacion: null,
        duracionMs: Date.now() - startedAt,
        usage: null,
        error: String(error?.message || error),
      };
    }
  };

  if (parallel) {
    // Pool acotado: en CPU/iGPU varios modelos simultáneos se roban RAM, así
    // que el llamador decide el techo en vez de lanzar N peticiones a la vez.
    const limit = Math.max(1, Math.min(definitions.length || 1, Math.floor(Number(concurrency) || 1)));
    let nextIndex = 0;
    await Promise.all(Array.from({ length: limit }, async () => {
      while (nextIndex < definitions.length) {
        const index = nextIndex;
        nextIndex += 1;
        await generateOne(definitions[index], index);
      }
    }));
  } else {
    for (const [index, file] of definitions.entries()) {
      await generateOne(file, index);
    }
  }

  const usage = usageByIndex.filter(Boolean);
  const faltantes = definitions.filter((file) => !archivos[file.key]?.texto).map((file) => file.key);
  return {
    ok: faltantes.length === 0,
    archivos,
    faltantes,
    texto: buildBlockBundle(archivos, definitions),
    usage,
    errores: definitions
      .filter((file) => archivos[file.key]?.error)
      .map((file) => ({ key: file.key, error: archivos[file.key].error })),
  };
}

export default { MULTI_FILE_TEMPLATES, taskTypeForLanguage, buildBlockBundle, generateMultiFile };
