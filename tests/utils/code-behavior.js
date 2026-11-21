/**
 * Validación FUNCIONAL del código generado (solo harness, nunca el core).
 *
 * La validación sintáctica dice "esto compila"; esta dice "esto hace lo que se
 * pidió". Se ejecuta en subprocess/VM con timeout para que un bucle infinito
 * del modelo no se coma la suite E2E.
 */
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const summarize = (casos) => {
  const passed = casos.filter((caso) => caso.passed).length;
  return {
    soportado: true,
    ok: casos.length > 0 && passed === casos.length,
    puntuacion: casos.length ? Math.round((passed / casos.length) * 100) : 0,
    casos,
  };
};

const cleanGeneratedCode = (code, functionName) => {
  const texto = String(code || "");
  const withoutExport = texto
    .replace(/^\s*export\s+default\s+(?=(?:async\s+)?function\b)/gm, "")
    .replace(/^\s*export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, "");
  // Algunos modelos devuelven el bloque con la firma en español del prompt.
  const alias = { isValidEmail: ["validarEmail", "esEmailValido"], leer_archivo: ["leerArchivo", "read_file"] }[functionName] || [];
  return { code: withoutExport, names: [functionName, ...alias] };
};

function runJavaScriptFunction(code, { functionName, cases, timeoutMs = 2000 }) {
  const { code: cleanCode, names } = cleanGeneratedCode(code, functionName);
  const resultados = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    exports: {},
    __report: (name, passed, detail) => resultados.push({ name, passed: Boolean(passed), detail }),
  };
  sandbox.globalThis = sandbox;

  const harness = `
;(function () {
  const names = ${JSON.stringify(names)};
  const candidates = names.map((name) => {
    try { return eval(name); } catch (error) { return undefined; }
  });
  const fn = candidates.find((candidate) => typeof candidate === "function")
    || Object.values(module.exports || {}).find((candidate) => typeof candidate === "function");
  if (typeof fn !== "function") {
    __report("definicion", false, "no se encontró la función " + names.join("/"));
    return;
  }
  for (const item of ${JSON.stringify(cases)}) {
    let actual;
    try {
      actual = fn(item.input);
    } catch (error) {
      __report(item.name, false, "lanzó excepción: " + (error && error.message ? error.message : String(error)));
      continue;
    }
    __report(item.name, actual === item.expected, "devolvió " + JSON.stringify(actual));
  }
})();
`;

  try {
    vm.runInNewContext(`${cleanCode}\n${harness}`, sandbox, { timeout: timeoutMs });
  } catch (error) {
    resultados.push({ name: "ejecucion", passed: false, detail: String(error?.message || error) });
  }
  return summarize(resultados);
}

const EMAIL_CASES = [
  { name: "email_valido", input: "usuario@example.com", expected: true },
  { name: "email_con_punto_y_tag", input: "a.b+tag@sub.example.co.uk", expected: true },
  { name: "sin_arroba", input: "usuarioexample.com", expected: false },
  { name: "sin_dominio_punto", input: "usuario@example", expected: false },
  { name: "vacio", input: "", expected: false },
  { name: "con_espacio", input: "usuario space@example.com", expected: false },
];

export function validateEmailBehavior(code) {
  return runJavaScriptFunction(code, { functionName: "isValidEmail", cases: EMAIL_CASES });
}

const PYTHON_DRIVER = String.raw`
import builtins
import contextlib
import io
import json
import sys

code_path, existing_path, missing_path = sys.argv[1:4]
results = []

def report(name, passed, detail):
    results.append({"name": name, "passed": bool(passed), "detail": str(detail)})

def blocked_input(*args, **kwargs):
    raise RuntimeError("input() bloqueado por el harness")

builtins.input = blocked_input
namespace = {"__name__": "generated"}
try:
    with open(code_path, encoding="utf-8") as handle:
        exec(compile(handle.read(), code_path, "exec"), namespace)
except Exception as error:
    report("definicion", False, str(error))
    print(json.dumps({"results": results}))
    sys.exit(0)

fn = namespace.get("leer_archivo") or namespace.get("leerArchivo")
if not callable(fn):
    report("definicion", False, "no se encontró leer_archivo")
    print(json.dumps({"results": results}))
    sys.exit(0)

captured = io.StringIO()
try:
    with contextlib.redirect_stdout(captured):
        value = fn(existing_path)
except Exception as error:
    report("archivo_existente", False, "lanzó excepción: " + str(error))
else:
    text = (value if isinstance(value, str) else "") + captured.getvalue()
    report("archivo_existente", "contenido de prueba" in text, "devolvió " + repr(value)[:120])

try:
    with contextlib.redirect_stdout(io.StringIO()):
        missing_value = fn(missing_path)
except Exception as error:
    report("archivo_ausente", False, "excepción no manejada: " + str(error))
else:
    text = (missing_value if isinstance(missing_value, str) else "").lower()
    handled = (
        missing_value is None
        or missing_value == ""
        or any(word in text for word in ("error", "no existe", "no encontr", "no se pudo", "failed", "not found"))
    )
    report("archivo_ausente", handled, "devolvió " + repr(missing_value)[:120])

print(json.dumps({"results": results}))
`;

export function validateReadFileBehavior(code, { timeoutMs = 5000 } = {}) {
  let tempDir;
  try {
    tempDir = mkdtempSync(join(tmpdir(), "agentkit-behavior-"));
    const codePath = join(tempDir, "generado.py");
    const driverPath = join(tempDir, "driver.py");
    const existingPath = join(tempDir, "existe.txt");
    const missingPath = join(tempDir, "no_existe.txt");
    writeFileSync(codePath, String(code || ""), "utf8");
    writeFileSync(driverPath, PYTHON_DRIVER, "utf8");
    writeFileSync(existingPath, "contenido de prueba\n", "utf8");

    const child = spawnSync("python3", [driverPath, codePath, existingPath, missingPath], {
      encoding: "utf8",
      timeout: timeoutMs,
    });
    if (child.error || child.status !== 0) {
      const detail = String(child.error?.message || child.stderr || child.stdout || `python3 salió con ${child.status}`).trim();
      return summarize([{ name: "ejecucion", passed: false, detail: detail.slice(0, 300) }]);
    }
    const parsed = JSON.parse(child.stdout.trim().split("\n").pop() || "{}");
    const casos = Array.isArray(parsed.results) ? parsed.results : [];
    return casos.length
      ? summarize(casos)
      : summarize([{ name: "ejecucion", passed: false, detail: "el driver Python no devolvió casos" }]);
  } catch (error) {
    return summarize([{ name: "ejecucion", passed: false, detail: String(error?.message || error) }]);
  } finally {
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

/** Comprueba que el JS "enganche" con el HTML generado (IDs y eventos). */
export function validateLandingWiring({ html = "", css = "", js = "" } = {}) {
  const htmlIds = new Set(
    [...String(html).matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]),
  );
  const jsIds = [
    ...[...String(js).matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/gi)].map((match) => match[1]),
    ...[...String(js).matchAll(/querySelector\(\s*["']#([\w-]+)["']\s*\)/gi)].map((match) => match[1]),
  ];
  const idsFaltantes = [...new Set(jsIds.filter((id) => !htmlIds.has(id)))];
  const casos = [
    { name: "html_con_formulario", passed: /<form\b/i.test(html), detail: "" },
    { name: "js_escucha_eventos", passed: /addEventListener\s*\(\s*["'](?:submit|click|DOMContentLoaded)/i.test(js) || /\.onsubmit\s*=/.test(js), detail: "" },
    { name: "js_referencia_ids", passed: jsIds.length > 0, detail: `${jsIds.length} IDs referenciados` },
    { name: "ids_coinciden", passed: jsIds.length > 0 && idsFaltantes.length === 0, detail: idsFaltantes.length ? `faltan: ${idsFaltantes.join(", ")}` : "todos existen" },
    { name: "enlaza_css", passed: /style\.css/i.test(html), detail: "" },
    { name: "enlaza_js", passed: /script\.js/i.test(html), detail: "" },
    { name: "css_con_reglas", passed: /[.#\w-]+\s*\{[^}]+:[^}]+\}/.test(css), detail: "" },
  ].map((caso) => ({ ...caso, passed: Boolean(caso.passed) }));
  return summarize(casos);
}

/** Despacha por lenguaje/tarea para que el runner no conozca los casos. */
export function validateCodeBehavior(code, language) {
  if (language === "javascript") return validateEmailBehavior(code);
  if (language === "python") return validateReadFileBehavior(code);
  return { soportado: false, ok: null, puntuacion: null, casos: [] };
}
