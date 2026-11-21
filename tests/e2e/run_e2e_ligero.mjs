/**
 * E2E ligero - Solo P05 (código) y P06 (landing page) para modelos pendientes.
 */

import { askAgent } from "../../src/agent.js";
import { getModelConfig } from "../../src/config/presets.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://192.168.100.126:11434";

const MODELOS = [
  { model: "qwen2.5-coder:3b", categoria: "code-3b", tamanoGB: 1.9 },
];

const RESULTADOS_DIR = path.join(process.cwd(), "resultados_por_modelo");

const TIMEOUT_WEB = 300000;
const TIMEOUT_CODE = 300000;
const MAX_TOKENS_WEB = 384;
const MAX_TOKENS_CODE = 384;

function extraerCodigoBloque(texto, lenguaje) {
  const inicio = "```" + lenguaje;
  const fin = "```";
  const regex = new RegExp(inicio + "[\\s\\S]*?" + fin, 'g');
  const match = regex.exec(texto);
  if (match) {
    return match[0].replace(new RegExp("^" + inicio), '').replace(new RegExp(fin + "$"), '').trim();
  }
  return texto.trim();
}

function detectarContaminacionHTML(contenido) {
  const patrones = [
    /<!DOCTYPE\s+html>/i,
    /<html[^>]*>/i,
    /<head[^>]*>/i,
    /<body[^>]*>/i,
    /<style[^>]*>/i,
    /<\/html>/i,
  ];
  const encontrados = patrones.filter(p => p.test(contenido));
  return {
    estaContaminado: encontrados.length > 0,
    patronesEncontrados: encontrados,
    puntuacion: Math.max(0, 100 - (encontrados.length * 20)),
  };
}

function detectarContaminacionCSSEnHTML(contenido) {
  const patrones = [
    /<style[^>]*>/i,
    /<\/style>/i,
  ];
  const encontrados = patrones.filter(p => p.test(contenido));
  return {
    estaContaminado: encontrados.length > 0,
    puntuacion: Math.max(0, 100 - (encontrados.length * 30)),
  };
}

function validarHTML(contenido) {
  const checks = {
    tieneDoctype: /<!DOCTYPE\s+html>/i.test(contenido),
    tieneHtml: /<html[^>]*>/i.test(contenido),
    tieneBody: /<body[^>]*>/i.test(contenido),
    tieneCSSLink: /style\.css/.test(contenido),
    tieneJSScript: /script\.js/.test(contenido),
    tieneHeader: /<header/i.test(contenido),
    tieneForm: /<form/i.test(contenido),
  };
  const contaminacion = detectarContaminacionCSSEnHTML(contenido);
  const puntuacionBase = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
  const puntuacion = Math.round((puntuacionBase + contaminacion.puntuacion) / 2);
  return { checks, puntuacion, contaminacionCSS: contaminacion };
}

function validarCSS(contenido) {
  const checks = {
    tieneBody: /body\s*\{/.test(contenido),
    tieneHover: /:hover/.test(contenido),
    tieneMediaQuery: /@media/.test(contenido),
    tieneColorHex: /#[0-9a-fA-F]{3,6}/.test(contenido),
    tieneTransition: /transition/.test(contenido),
    tieneVariables: /--[\w-]+:/ .test(contenido),
  };
  const puntuacion = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
  return { checks, puntuacion };
}

function validarJS(contenido) {
  const checks = {
    tieneEventListener: /addEventListener/.test(contenido),
    tieneSeleccionDOM: /getElementById|querySelector/.test(contenido),
    tieneForm: /form/.test(contenido.toLowerCase()),
    noJQuery: !/\$\s*\(|jQuery/.test(contenido),
    tieneFuncion: /function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>/.test(contenido),
  };
  const contaminacion = detectarContaminacionHTML(contenido);
  const puntuacionBase = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
  const puntuacion = Math.round((puntuacionBase + contaminacion.puntuacion) / 2);
  return { checks, puntuacion, contaminacionHTML: contaminacion };
}

async function askConConfig(modelo, taskType, prompt) {
  const timeoutMs = taskType === "web" ? TIMEOUT_WEB : TIMEOUT_CODE;
  const maxTokens = taskType === "web" ? MAX_TOKENS_WEB : MAX_TOKENS_CODE;
  const config = getModelConfig(modelo.model, taskType, {
    baseUrl: BASE_URL,
    maxTokens: maxTokens,
  });

  const start = Date.now();
  let result = null;
  let error = null;
  try {
    result = await askAgent({
      provider: config,
      messages: [{ role: "user", content: prompt }],
      mode: "build",
      capabilities: {
        terminal: false, web: false, mcp: false,
        documents: false, artifacts: false, filesystem: false,
      },
      autoCompact: true,
      compactionThresholdPercent: 25,
      compactionKeepLastMessages: 3,
      includeDiagnostics: true,
    });
  } catch (err) {
    error = err.message;
  }
  const end = Date.now();

  return {
    success: !error,
    error,
    duracionMs: end - start,
    respuesta: result?.text || "",
    configUsada: {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      num_ctx: config.num_ctx,
      taskType,
    },
  };
}

async function main() {
  console.log("=".repeat(70));
  console.log("E2E LIGERO - P05 y P06 para modelos pendientes");
  console.log("=".repeat(70));
  console.log(`Servidor: ${BASE_URL}\n`);

  const resultadosGenerales = {};

  for (const modelo of MODELOS) {
    console.log("\n" + "=".repeat(70));
    console.log(`MODELO: ${modelo.model}`);
    console.log("=".repeat(70));

    const carpetaModelo = path.join(RESULTADOS_DIR, modelo.model.replace(/[\/:]/g, "_"));
    if (!fs.existsSync(carpetaModelo)) fs.mkdirSync(carpetaModelo, { recursive: true });

    const resultadosModelo = {};

    // ── P05: Código ──
    console.log("\n[P05] Generación de código...");
    const tareas = [
      {
        nombre: "javascript_funcion_utilitaria",
        prompt: "Escribe una función en JavaScript que valide si un correo electrónico es válido usando expresión regular. Incluye comentarios. SOLO CÓDIGO JAVASCRIPT, sin explicaciones.",
        lenguaje: "javascript",
      },
      {
        nombre: "python_lectura_archivo",
        prompt: "Escribe un script en Python que lea un archivo de texto e imprima líneas con 'error'. Incluye manejo de excepciones. SOLO CÓDIGO PYTHON, sin explicaciones.",
        lenguaje: "python",
      },
    ];
    const res05 = [];
    for (const tarea of tareas) {
      console.log(`  ${tarea.nombre}...`);
      const r = await askConConfig(modelo, "code", tarea.prompt);
      const ext = tarea.lenguaje === "javascript" ? "js" : "py";
      const nombreArchivo = `codigo_${tarea.nombre}.${ext}`;
      const rutaArchivo = path.join(carpetaModelo, nombreArchivo);
      let archivoGuardado = false;
      let calidad = null;
      if (r.success && r.respuesta) {
        const codigoLimpio = extraerCodigoBloque(r.respuesta, tarea.lenguaje);
        fs.writeFileSync(rutaArchivo, codigoLimpio, "utf8");
        archivoGuardado = fs.existsSync(rutaArchivo);
        const indicadores = tarea.lenguaje === "javascript"
          ? [["tieneFuncion", /function\s+\w+/], ["tieneRegex", new RegExp("RegExp|\\\\")], ["tieneRetorno", /return/]]
          : [["tieneFuncion", /def\s+\w+/], ["tieneManejoErrores", /try\s*:|except/], ["tieneAperturaArchivo", /open\(/]];
        calidad = {
          tieneComentarios: /\/\/|\/\*[\s\S]*?\*\//.test(codigoLimpio),
          noPlaceholders: !/TODO|FIXME|placeholder/i.test(codigoLimpio),
          noTextoExplicativo: !/lo siento|no puedo/i.test(codigoLimpio.trim().split('\n')[0]),
          ...Object.fromEntries(indicadores.map(([n, re]) => [n, re.test(codigoLimpio)])),
        };
        const keys = Object.keys(calidad);
        calidad.puntuacion = Math.round((keys.filter(k => calidad[k]).length / keys.length) * 100);
      }
      res05.push({
        tarea: tarea.nombre,
        lenguaje: tarea.lenguaje,
        exito: r.success,
        duracionMs: r.duracionMs,
        error: r.error,
        archivoGuardado,
        calidad,
      });
      console.log(`    ${r.success ? "✓" : "✗"} ${r.duracionMs.toFixed(0)}ms | calidad: ${calidad ? calidad.puntuacion : 0}%${r.error ? " (error: " + r.error + ")" : ""}`);
    }
    resultadosModelo["05_code_generation"] = {
      exito: res05.every(r => r.exito),
      resultados: res05,
    };

    // ── P06: Landing page ──
    console.log("\n[P06] Landing page HTML/CSS/JS...");
    const promptsLP = {
      html: `Crea SOLO el HTML de una landing page para una clínica veterinaria llamada "Patitas Felices". HTML5 semántico completo. Enlaces a style.css y script.js. Secciones: header, hero, servicios, tabla de precios, formulario de contacto, footer. REGLA ESTRICTA: NO CSS, NO JavaScript, NO <style>, NO <script>. SOLO HTML puro.`,
      css: `Crea SOLO el CSS para landing page de clínica veterinaria "Patitas Felices". Diseño responsive, paleta verde (#2e7d32) y naranja (#ff9800), animaciones hover, tarjetas con sombra, tabla zebra, formulario stylizado, header fijo. REGLA ESTRICTA: SOLO CSS puro. NO HTML.`,
      js: `Crea SOLO el JavaScript para landing page de clínica veterinaria "Patitas Felices". Menú móvil toggle, formulario con validación, mensaje de confirmación, smooth scroll, botón CTA con alert. Vanilla JS sin frameworks. REGLA ESTRICTA: SOLO JS puro. NO HTML.`,
    };
    const res06 = {};
    for (const [tipo, prompt] of Object.entries(promptsLP)) {
      console.log(`  ${tipo}...`);
      const r = await askConConfig(modelo, "web", prompt);
      const nombreArchivo = tipo === 'html' ? 'index.html' : tipo === 'css' ? 'style.css' : 'script.js';
      const rutaArchivo = path.join(carpetaModelo, nombreArchivo);
      let archivoCreado = false;
      let calidad = null;
      if (r.success && r.respuesta) {
        const lenguajeMap = { html: 'html', css: 'css', js: 'javascript' };
        const contenidoLimpio = extraerCodigoBloque(r.respuesta, lenguajeMap[tipo]);
        fs.writeFileSync(rutaArchivo, contenidoLimpio, "utf8");
        archivoCreado = fs.existsSync(rutaArchivo);
        if (tipo === 'html') {
          const checks = {
            tieneDoctype: /<!DOCTYPE\s+html>/i.test(contenidoLimpio),
            tieneHtml: /<html[^>]*>/i.test(contenidoLimpio),
            tieneBody: /<body[^>]*>/i.test(contenidoLimpio),
            tieneCSSLink: /style\.css/.test(contenidoLimpio),
            tieneJSScript: /script\.js/.test(contenidoLimpio),
            tieneHeader: /<header/i.test(contenidoLimpio),
            tieneForm: /<form/i.test(contenidoLimpio),
          };
          const cont = detectarContaminacionCSSEnHTML(contenidoLimpio);
          const base = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
          calidad = { checks, puntuacion: Math.round((base + cont.puntuacion) / 2), contaminacionCSS: cont };
        } else if (tipo === 'css') {
          const checks = {
            tieneBody: /body\s*\{/.test(contenidoLimpio),
            tieneHover: /:hover/.test(contenidoLimpio),
            tieneMediaQuery: /@media/.test(contenidoLimpio),
            tieneColorHex: /#[0-9a-fA-F]{3,6}/.test(contenidoLimpio),
            tieneTransition: /transition/.test(contenidoLimpio),
            tieneVariables: /--[\w-]+:/ .test(contenidoLimpio),
          };
          calidad = { checks, puntuacion: Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100) };
        } else if (tipo === 'js') {
          const checks = {
            tieneEventListener: /addEventListener/.test(contenidoLimpio),
            tieneSeleccionDOM: /getElementById|querySelector/.test(contenidoLimpio),
            tieneForm: /form/.test(contenidoLimpio.toLowerCase()),
            noJQuery: !/\$\s*\(|jQuery/.test(contenidoLimpio),
            tieneFuncion: /function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>/.test(contenidoLimpio),
          };
          const cont = detectarContaminacionHTML(contenidoLimpio);
          const base = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
          calidad = { checks, puntuacion: Math.round((base + cont.puntuacion) / 2), contaminacionHTML: cont };
        }
      }
      res06[tipo] = {
        exito: r.success,
        duracionMs: r.duracionMs,
        error: r.error,
        archivoCreado,
        calidad,
      };
      const cal = calidad ? calidad.puntuacion : 0;
      console.log(`    ${tipo}: ${r.success ? "✓" : "✗"} ${r.duracionMs.toFixed(0)}ms | calidad: ${cal}%${r.error ? " (error: " + r.error + ")" : ""}`);
    }
    resultadosModelo["06_landing_page_html"] = {
      exito: Object.values(res06).every(r => r.exito),
      resultados: res06,
    };

    const archivoResultados = path.join(carpetaModelo, "resultados.json");
    fs.writeFileSync(archivoResultados, JSON.stringify(resultadosModelo, null, 2), "utf8");
    resultadosGenerales[modelo.model] = resultadosModelo;
    console.log(`\n  Resultados guardados en: ${archivoResultados}`);
  }

  // Resumen
  console.log("\n" + "=".repeat(70));
  console.log("RESUMEN - P05 y P06");
  console.log("=".repeat(70));
  console.log("| Modelo | P05 JS | P05 Python | P06 HTML | P06 CSS | P06 JS | Calidad HTML | Calidad CSS | Calidad JS |");
  console.log("|--------|--------|------------|----------|---------|--------|--------------|-------------|------------|");
  for (const [modelo, resultados] of Object.entries(resultadosGenerales)) {
    const r05 = resultados["05_code_generation"]?.resultados || [];
    const p05js = r05.find(r => r.tarea === "javascript_funcion_utilitaria")?.exito ? "✓" : "✗";
    const p05py = r05.find(r => r.tarea === "python_lectura_archivo")?.exito ? "✓" : "✗";
    const p06 = resultados["06_landing_page_html"]?.resultados || {};
    const p06html = p06.html?.exito ? "✓" : "✗";
    const p06css = p06.css?.exito ? "✓" : "✗";
    const p06js = p06.js?.exito ? "✓" : "✗";
    const h = p06.html?.calidad?.puntuacion ?? 0;
    const c = p06.css?.calidad?.puntuacion ?? 0;
    const j = p06.js?.calidad?.puntuacion ?? 0;
    console.log(`| ${modelo.padEnd(30)} | ${p05js}   | ${p05py}    | ${p06html}   | ${p06css}   | ${p06js}   | ${String(h).padEnd(12)} | ${String(c).padEnd(11)} | ${String(j).padEnd(10)} |`);
  }

  const archivoResumen = path.join(RESULTADOS_DIR, "resumen_p05_p06.json");
  fs.writeFileSync(archivoResumen, JSON.stringify(resultadosGenerales, null, 2), "utf8");
  console.log(`\nResumen guardado en: ${archivoResumen}`);
}

main().catch(console.error);