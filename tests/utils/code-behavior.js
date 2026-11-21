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
import { createDomStub } from "./dom-stub.js";

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

const MULTIPAGE_PAGES = ["index.html", "servicios.html", "precios.html", "contacto.html"];

const MULTIPAGE_HOOKS = [
  "data-nav-toggle",
  "data-theme-toggle",
  "data-faq-toggle",
  "data-price-toggle",
  "data-contacto",
  "data-form-exito",
  "data-mensual",
  "data-anual",
];

const countMatches = (text, pattern) => (String(text).match(pattern) || []).length;

const htmlIds = (text) => new Set(
  [...String(text).matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]),
);

const jsReferencedIds = (text) => [
  ...[...String(text).matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/gi)].map((match) => match[1]),
  ...[...String(text).matchAll(/querySelector\(\s*["']#([\w-]+)["']\s*\)/gi)].map((match) => match[1]),
];

const CASOS_INTERACCION = [
  "dom_ready", "eventos_registrados", "nav_toggle", "theme_toggle", "faq_toggle",
  "price_toggle", "formulario_rechaza_invalido", "formulario_acepta_valido",
  "reveal_observer", "scroll_progress",
];

function validateWebInteractions(js, ids = []) {
  const stub = createDomStub({ ids });
  const casos = [];
  const report = (name, passed, detail = "") => {
    casos.push({ name, passed: Boolean(passed), detail });
  };
  const safe = (name, fn) => {
    try { return fn(); } catch (error) {
      report(name, false, String(error?.message || error));
      return null;
    }
  };
  const totalListeners = (target, type) => target?.__listeners?.get(type)?.length || 0;

  try {
    vm.runInNewContext(`;(function () {\n${String(js || "")}\n})();`, stub.sandbox, { timeout: 2500 });
    report("ejecucion_js", true);
  } catch (error) {
    const motivo = `JS no ejecutable: ${String(error?.message || error)}`;
    report("ejecucion_js", false, motivo);
    // Antes se devolvían solo los casos ejecutados hasta el fallo. Eso hacía
    // que un JS roto puntuara MEJOR que uno que ejecuta pero falla algunas
    // interacciones: las interacciones ni se contaban. Se marcan como fallidas
    // para que la puntuación sea comparable entre corridas.
    for (const nombre of CASOS_INTERACCION) report(nombre, false, motivo);
    return summarize(casos);
  }

  safe("dom_ready", () => {
    stub.fire(stub.document, "DOMContentLoaded");
    stub.fire(stub.window, "load");
    const total = totalListeners(stub.document, "DOMContentLoaded")
      + totalListeners(stub.window, "load")
      + totalListeners(stub.document, "readystatechange");
    report("dom_ready", total > 0, `${total} listener(s) de arranque`);
  });

  safe("eventos_registrados", () => {
    const clicks = [
      "data-nav-toggle", "data-theme-toggle", "data-faq-toggle", "data-price-toggle",
    ].reduce((sum, hook) => sum + totalListeners(stub.bySelector(`[${hook}]`), "click"), 0);
    const submits = totalListeners(stub.bySelector("[data-contacto]"), "submit");
    const keys = totalListeners(stub.document, "keydown") + totalListeners(stub.window, "keydown");
    report("eventos_registrados", clicks > 0 && submits > 0, `click=${clicks} submit=${submits} keydown=${keys}`);
  });

  const objetivoDe = (element, atributo) => stub.bySelector(element.getAttribute(atributo) || "") || element;
  const estadoDe = (element, objetivo) => [
    element.getAttribute("aria-expanded") || "",
    element.className || "",
    objetivo.className || "",
  ].join("|");

  safe("nav_toggle", () => {
    const nav = stub.bySelector("[data-nav-toggle]");
    const objetivo = objetivoDe(nav, "data-nav-toggle");
    nav.setAttribute("aria-expanded", "false");
    const antes = estadoDe(nav, objetivo);
    stub.fire(nav, "click");
    const despues = estadoDe(nav, objetivo);
    report("nav_toggle", antes !== despues, `antes=${antes} despues=${despues}`);
  });

  safe("theme_toggle", () => {
    const boton = stub.bySelector("[data-theme-toggle]");
    const raiz = objetivoDe(boton, "data-theme-toggle");
    stub.localStorage.clear();
    stub.document.documentElement.setAttribute("data-theme", "claro");
    const claseInicial = raiz.className;
    stub.fire(boton, "click");
    const tema = stub.localStorage.getItem("theme") || stub.localStorage.getItem("tema")
      || stub.document.documentElement.dataset.theme;
    const cambioClase = raiz.className !== claseInicial;
    report(
      "theme_toggle",
      Boolean((tema && tema !== "claro") || cambioClase),
      `tema=${tema || "sin cambio"} clase=${cambioClase}`,
    );
  });

  safe("faq_toggle", () => {
    const faq = stub.bySelector("[data-faq-toggle]");
    const objetivo = objetivoDe(faq, "data-faq-toggle");
    faq.setAttribute("aria-expanded", "false");
    const antes = estadoDe(faq, objetivo);
    stub.fire(faq, "click");
    const despues = estadoDe(faq, objetivo);
    report("faq_toggle", antes !== despues, `antes=${antes} despues=${despues}`);
  });

  safe("price_toggle", () => {
    const boton = stub.bySelector("[data-price-toggle]");
    const objetivo = objetivoDe(boton, "data-price-toggle");
    const importesAntes = [...stub.mensuales, ...stub.anuales].map((item) => item.textContent).join("|");
    const claseAntes = objetivo.className;
    stub.fire(boton, "click");
    const importesDespues = [...stub.mensuales, ...stub.anuales].map((item) => item.textContent).join("|");
    const cambio = importesAntes !== importesDespues || objetivo.className !== claseAntes;
    report("price_toggle", cambio, cambio ? "el periodo cambió" : "los importes y el destino no cambiaron");
  });

  const form = stub.bySelector("[data-contacto]");
  const fields = Object.values(form.elements || {});
  const exito = stub.bySelector("[data-form-exito]");

  safe("formulario_rechaza_invalido", () => {
    for (const field of fields) {
      field.value = "";
      field.__valid = false;
      field.setAttribute("aria-invalid", "false");
      field.__focusCount = 0;
    }
    exito.textContent = "";
    exito.hidden = true;
    stub.alerts.length = 0;
    stub.fire(form, "submit");
    const marcados = fields.filter((field) => field.getAttribute("aria-invalid") === "true").length;
    const enfocados = fields.filter((field) => field.__focusCount > 0).length;
    const aviso = stub.alerts.some((mensaje) => /complete|falt|por favor|error|inval/i.test(mensaje));
    report(
      "formulario_rechaza_invalido",
      marcados > 0 || enfocados > 0 || aviso,
      `aria-invalid=${marcados} focus=${enfocados} aviso=${aviso}`,
    );
  });

  safe("formulario_acepta_valido", () => {
    const ejemplo = {
      nombre: "María",
      email: "maria@example.com",
      telefono: "600123456",
      servicio: "consultas",
      mensaje: "Quisiera pedir cita para mi gato.",
    };
    for (const field of fields) {
      field.value = ejemplo[field.getAttribute("name")] || "valor de prueba";
      field.__valid = true;
      field.setAttribute("aria-invalid", "false");
    }
    exito.textContent = "";
    exito.hidden = true;
    stub.alerts.length = 0;
    stub.fire(form, "submit");
    const visible = Boolean(String(exito.textContent).trim())
      || exito.hidden === false
      || /^(?!none$).+/.test(exito.style.display || "")
      || stub.alerts.some((mensaje) => /gracias|correct|enviad|éxito/i.test(mensaje));
    report("formulario_acepta_valido", visible, visible ? "confirmación visible" : "sin confirmación");
  });

  safe("reveal_observer", () => {
    const observados = stub.observers.reduce((sum, observer) => sum + observer.simulate(), 0);
    report("reveal_observer", observados > 0, `${observados} elemento(s) observados`);
  });

  safe("scroll_progress", () => {
    const progress = stub.bySelector("[data-scroll-progress]");
    const objetivo = objetivoDe(progress, "data-scroll-progress");
    const estado = () => [
      progress.style.width || "",
      progress.style.transform || "",
      progress.textContent,
      objetivo.className,
    ].join("|");
    objetivo.className = "";
    const antes = estado();
    stub.window.scrollY = 500;
    stub.document.documentElement.scrollTop = 500;
    stub.document.body.scrollTop = 500;
    stub.document.scrollingElement = stub.document.documentElement;
    stub.fire(stub.window, "scroll");
    stub.fire(stub.document, "scroll");
    stub.observers.forEach((observer) => observer.simulate());
    const despues = estado();
    report("scroll_progress", antes !== despues, antes === despues ? "la barra no cambió" : "progreso actualizado");
  });

  return summarize(casos);
}

/**
 * Valida la landing multipágina: entregable, diseño, anti-plantilla e
 * interacciones reales sobre un DOM stub. `pages` se indexa por nombre de
 * archivo (salida de `blocksByPath()`).
 */
export function validateMultiPage({ pages = {}, css = "", js = "" } = {}) {
  const archivos = pages && typeof pages === "object" ? pages : {};
  const nombres = new Set(Object.keys(archivos));
  const html = [...nombres]
    .filter((name) => /\.html$/i.test(name))
    .map((name) => archivos[name])
    .join("\n");
  const cssTexto = String(css || "");
  const jsTexto = String(js || "");
  const ids = [...htmlIds(html)];
  const referencedIds = jsReferencedIds(jsTexto);
  const idsFaltantes = referencedIds.filter((id) => !htmlIds(html).has(id));
  const hooksFaltantes = MULTIPAGE_HOOKS.filter((hook) => {
    if (hook === "data-contacto") {
      return !jsTexto.includes(hook)
        && !/(?:querySelector|getElementsByTagName)\(\s*["']form["']\s*\)/i.test(jsTexto);
    }
    return !jsTexto.includes(hook);
  });
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+\.html)(?:#[^"']*)?["']/gi)]
    .map((match) => match[1])
    .filter((link) => !/^https?:\/\//i.test(link));
  const linksRotos = [...new Set(links.filter((link) => !nombres.has(link)))];

  const casos = [
    {
      name: "paginas_entregadas",
      passed: MULTIPAGE_PAGES.every((name) => String(archivos[name] || "").trim().length > 40),
      detail: MULTIPAGE_PAGES.filter((name) => !archivos[name]).join(", ") || "4/4",
    },
    {
      name: "titulo_por_pagina",
      passed: MULTIPAGE_PAGES.every((name) => /<title[^>]*>[\s\S]+?<\/title>/i.test(String(archivos[name] || ""))),
      detail: "",
    },
    {
      name: "estructura_semantica",
      passed: MULTIPAGE_PAGES.every((name) => {
        const page = String(archivos[name] || "");
        return /<header/i.test(page) && /<nav/i.test(page) && /<main/i.test(page) && /<footer/i.test(page);
      }),
      detail: "",
    },
    {
      name: "h1_unico",
      passed: MULTIPAGE_PAGES.every((name) => countMatches(archivos[name] || "", /<h1\b/gi) === 1),
      detail: "",
    },
    {
      name: "enlaza_assets",
      passed: MULTIPAGE_PAGES.every((name) => {
        const page = String(archivos[name] || "");
        return /style\.css/i.test(page) && /script\.js/i.test(page);
      }),
      detail: "",
    },
    {
      name: "links_resueltos",
      passed: links.length > 0 && linksRotos.length === 0,
      detail: linksRotos.length ? `rotos: ${linksRotos.join(", ")}` : `${links.length} enlace(s)`,
    },
    {
      name: "data_page_por_pagina",
      passed: MULTIPAGE_PAGES.every((name) => {
        const match = String(archivos[name] || "").match(/data-page\s*=\s*["']([^"']+)["']/i);
        return Boolean(match && match[1] === name.replace(/\.html$/i, ""));
      }),
      detail: "",
    },
    {
      name: "ids_referenciados_existen",
      passed: idsFaltantes.length === 0,
      detail: idsFaltantes.length ? `faltan: ${idsFaltantes.join(", ")}` : `${referencedIds.length} referencia(s)`,
    },
    { name: "css_tokens", passed: countMatches(cssTexto, /--[\w-]+\s*:/g) >= 4, detail: "" },
    { name: "css_animaciones", passed: countMatches(cssTexto, /@keyframes/gi) >= 2, detail: "" },
    { name: "css_responsive", passed: countMatches(cssTexto, /@media/gi) >= 2, detail: "" },
    { name: "css_reduced_motion", passed: /prefers-reduced-motion/i.test(cssTexto), detail: "" },
    { name: "css_focus_visible", passed: /:focus-visible/.test(cssTexto), detail: "" },
    { name: "css_clamp", passed: /clamp\s*\(/i.test(cssTexto), detail: "" },
    {
      name: "html_svg_inline",
      passed: /<svg\b/i.test(html) && /stroke\s*=\s*["']currentColor["']/i.test(html),
      detail: "",
    },
    {
      name: "js_hooks_testeables",
      passed: hooksFaltantes.length === 0,
      detail: hooksFaltantes.length ? `faltan: ${hooksFaltantes.join(", ")}` : "todos",
    },
    { name: "js_tema_persistente", passed: /localStorage/.test(jsTexto), detail: "" },
    { name: "js_reveal_observer", passed: /IntersectionObserver/.test(jsTexto), detail: "" },
    { name: "sin_fetch", passed: !/\bfetch\s*\(/.test(jsTexto), detail: "" },
    { name: "sin_eval", passed: !/\beval\s*\(|new\s+Function\s*\(/.test(jsTexto), detail: "" },
    {
      name: "sin_handlers_inline",
      passed: !/\bon(?:click|submit|change|load|mouseover|mouseenter)\s*=/i.test(html),
      detail: "",
    },
    {
      name: "sin_recursos_externos",
      passed: !/https?:\/\//i.test(
        `${html}\n${cssTexto}\n${jsTexto}`.replace(/https?:\/\/www\.w3\.org\/[^\s"']+/gi, ""),
      ) && !/@import\s+url/i.test(cssTexto),
      detail: "",
    },
    { name: "no_lorem_ipsum", passed: !/lorem ipsum|tu empresa aquí|placeholder/i.test(html), detail: "" },
    { name: "no_emoji", passed: !/[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}]/u.test(html), detail: "" },
    { name: "no_gradient_generico", passed: !/#667eea/i.test(cssTexto) && !/linear-gradient\s*\(\s*135deg/i.test(cssTexto), detail: "" },
  ];

  const dinamico = ids.length || referencedIds.length || jsTexto.trim()
    ? validateWebInteractions(jsTexto, ids)
    : { soportado: true, ok: false, puntuacion: 0, casos: [{ name: "ejecucion_js", passed: false, detail: "JS vacío" }] };

  const todos = [...casos, ...dinamico.casos];
  const originalidad = summarize(todos.filter((caso) => (
    /^no_|_svg_inline|css_animaciones|css_clamp|css_reduced_motion/.test(caso.name)
  )));

  return {
    ...summarize(todos),
    originalidad,
    paginas: nombres.size,
    dinamico: { soportado: dinamico.soportado, ok: dinamico.ok, puntuacion: dinamico.puntuacion },
  };
}

/** Despacha por lenguaje/tarea para que el runner no conozca los casos. */
export function validateCodeBehavior(code, language) {
  if (language === "javascript") return validateEmailBehavior(code);
  if (language === "python") return validateReadFileBehavior(code);
  return { soportado: false, ok: null, puntuacion: null, casos: [] };
}
