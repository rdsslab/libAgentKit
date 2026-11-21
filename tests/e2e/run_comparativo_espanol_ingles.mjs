/**
 * ⚠️ SUPERSEDED — No usar para reportes nuevos.
 * Esta comparación no enviaba correctamente el system prompt y podía contaminar
 * archivos con suites posteriores. Usar:
 *   node tests/e2e/run_canonical.mjs --suite=idioma --output=RESUMEN_IDIOMA_VALIDO.md
 *
 * Prueba comparativa: System prompts en ESPAÑOL vs INGLÉS
 *
 * Ejecuta las mismas tareas con system prompts en ambos idiomas y compara
 * la calidad de las respuestas generadas por el modelo.
 */

import { askAgent } from "../../src/agent.js";
import { getSystemPromptEN, getSystemPromptES } from "../../src/utils/system-prompts-en.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:11434";
const MODELO = "lfm3-omni:2b";

const RESULTADOS_DIR = path.join(process.cwd(), "resultados_idioma");

const TIMEOUTS = {
  chat: 120000,
  longContext: 120000,
  code: 300000,
  web: 300000,
};

const MAX_TOKENS_BY_TASK = {
  chat: 1024,
  longContext: 2048,
  code: 512,
  web: 512,
};

// Validadores
function extraerCodigoBloque(texto, lenguaje) {
  const inicio = "```" + lenguaje;
  const fin = "```";
  const regex = new RegExp(inicio + "[\\s\\S]*?" + fin, 'g');
  const match = regex.exec(texto);
  if (match) return match[0].replace(new RegExp("^" + inicio), '').replace(new RegExp(fin + "$"), '').trim();
  return texto.trim();
}

function detectarRefusal(texto) {
  const t = texto.trim().toLowerCase();
  const patrones = [/lo siento/, /no puedo/, /disculpe/, /i'm sorry/, /i cannot/, /i can't/, /as an ai/];
  return patrones.some(p => p.test(t.slice(0, 200)));
}

function validarHTML(c) {
  const checks = {
    doctype: /<!DOCTYPE\s+html>/i.test(c),
    html: /<html[^>]*>/i.test(c),
    body: /<body[^>]*>/i.test(c),
    cssLink: /style\.css/.test(c),
    jsScript: /script\.js/.test(c),
    header: /<header/i.test(c),
    form: /<form/i.test(c),
  };
  const base = Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100;
  const contCSS = /<style[^>]*>/i.test(c) ? 0 : 100;
  return Math.round((base + contCSS) / 2);
}

function validarCSS(c) {
  const checks = {
    body: /body\s*\{/.test(c),
    hover: /:hover/.test(c),
    mediaQuery: /@media/.test(c),
    colorHex: /#[0-9a-fA-F]{3,6}/.test(c),
    transition: /transition/.test(c),
    variables: /--[\w-]+:/ .test(c),
  };
  return Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100);
}

function validarJS(c) {
  const checks = {
    eventListener: /addEventListener/.test(c),
    domSelect: /getElementById|querySelector/.test(c),
    form: /form/.test(c.toLowerCase()),
    noJQuery: !/\$\s*\(|jQuery/.test(c),
    funcion: /function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>/.test(c),
  };
  const contHTML = /<!DOCTYPE\s+html>/i.test(c) || /<html[^>]*>/i.test(c) ? 0 : 100;
  const base = Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100;
  return Math.round((base + contHTML) / 2);
}

function validarCodigoGenerico(c, indicadores = []) {
  const baseChecks = {
    comentarios: /\/\/|\/\*[\s\S]*?\*\//.test(c),
    noPlaceholders: !/TODO|FIXME|placeholder/i.test(c),
    noTextoExplicativo: !/lo siento|no puedo|disculpe/i.test(c.trim().split('\n')[0]),
  };
  const extraChecks = {};
  for (const [name, regex] of indicadores) extraChecks[name] = regex.test(c);
  const allChecks = { ...baseChecks, ...extraChecks };
  return Math.round(Object.values(allChecks).filter(Boolean).length / Object.keys(allChecks).length * 100);
}

async function askConIdioma(baseUrl, taskType, prompt, idioma) {
  const systemPrompt = idioma === 'en' ? getSystemPromptEN(taskType) : getSystemPromptES(taskType);
  const config = {
    provider: "ollama",
    model: MODELO,
    baseUrl,
    maxTokens: MAX_TOKENS_BY_TASK[taskType] || 2048,
    system: systemPrompt,
    temperature: taskType === 'code' ? 0.2 : 0.7,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    num_ctx: taskType === 'longContext' ? 32768 : 8192,
  };
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
  } catch (err) { error = err.message; }
  const end = Date.now();
  return {
    success: !error, error, duracionMs: end - start,
    respuesta: result?.text || "",
    tokens: result?.usage?.total_tokens || null,
    diagnosticos: result?.diagnostics || {},
  };
}

async function main() {
  console.log("=".repeat(70));
  console.log("PRUEBA COMPARATIVA: System prompts ESPAÑOL vs INGLÉS");
  console.log("=".repeat(70));
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log(`Servidor: ${BASE_URL}`);
  console.log(`Modelo: ${MODELO}\n`);

  const idiomas = [
    { nombre: "ESPAÑOL", clave: "es" },
    { nombre: "INGLÉS", clave: "en" },
  ];

  const resultados = {};

  for (const idioma of idiomas) {
    console.log("\n" + "=".repeat(70));
    console.log(`IDIOMA: ${idioma.nombre} (system prompt en ${idioma.nombre})`);
    console.log("=".repeat(70));

    const carpeta = path.join(RESULTADOS_DIR, idioma.clave);
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

    const resIdioma = {};

    // P01: Chat
    console.log("\n[P01] Chat simple...");
    const r01 = await askConIdioma(BASE_URL, "chat", "Explica en máximo 3 oraciones qué es React y para qué sirve.", idioma.clave);
    resIdioma.p01 = {
      exito: r01.success, duracionMs: r01.duracionMs,
      respuesta: r01.respuesta?.substring(0, 150),
      tokens: r01.tokens,
      error: r01.error,
    };
    console.log(`  ${r01.success ? "✓" : "✗"} ${r01.duracionMs.toFixed(0)}ms | ${r01.error ? "ERR: " + r01.error : ""}`);

    // P03: Coherencia multi-turno
    console.log("\n[P03] Coherencia multi-turno...");
    const textos = [
      "Mi nombre es María y tengo una clínica veterinaria llamada Patitas Felices.",
      "Atendemos perros, gatos, aves y conejos. Ofrecemos consultas, cirugías y hospitalización.",
      "¿Puedes recordar cuál es mi nombre y el nombre de mi clínica?",
      "¿Qué servicios ofrecemos en la clínica?",
    ];
    const conv = [];
    const res03 = [];
    let p03Ok = true;
    for (let i = 0; i < textos.length; i++) {
      const r = await askConIdioma(BASE_URL, "chat", textos[i], idioma.clave);
      if (!r.success) p03Ok = false;
      conv.push({ role: "user", content: textos[i] });
      if (r.respuesta) conv.push({ role: "assistant", content: r.respuesta });
      res03.push({ turno: i + 1, exito: r.success, respuesta: r.respuesta, duracionMs: r.duracionMs });
    }
    const t3 = res03[2]?.respuesta || "";
    const t4 = res03[3]?.respuesta || "";
    resIdioma.p03 = {
      exito: p03Ok,
      recuerdaNombre: /maría/i.test(t3),
      recuerdaClinica: /patitas felices/i.test(t3),
      recuerdaServicios: /consulta|cirugía|vacunación/i.test(t4),
    };
    console.log(`  ${p03Ok ? "✓" : "✗"} | nombre: ${resIdioma.p03.recuerdaNombre ? "✓" : "✗"} | clínica: ${resIdioma.p03.recuerdaClinica ? "✓" : "✗"} | servicios: ${resIdioma.p03.recuerdaServicios ? "✓" : "✗"}`);

    // P04: Contexto largo
    console.log("\n[P04] Contexto largo...");
    const longMsgs = [
      "Mensaje 1: Los perros necesitan paseos diarios, alimentación balanceada y visitas regulares al veterinario.",
      "Mensaje 2: Los gatos necesitan arenero limpio, comida de calidad y revisiones veterinarias anuales.",
      "Mensaje 3: Las aves requieren jaulas espaciosas, dieta variada de semillas y frutas, y socialización diaria.",
      "Mensaje 4: Los conejos necesitan heno ilimitado, verduras frescas y espacio para saltar.",
      "Mensaje 5: Las mascotas exóticas necesitan terrarios con control de temperatura y humedad específico.",
    ];
    const conv2 = [];
    const res04 = [];
    let p04Ok = true;
    for (let i = 0; i < longMsgs.length; i++) {
      const r = await askConIdioma(BASE_URL, "longContext", longMsgs[i], idioma.clave);
      if (!r.success) p04Ok = false;
      conv2.push({ role: "user", content: longMsgs[i] });
      if (r.respuesta) conv2.push({ role: "assistant", content: r.respuesta });
      res04.push({ turno: i + 1, exito: r.success, duracionMs: r.duracionMs });
    }
    resIdioma.p04 = { exito: p04Ok, turnos: res04.length };
    console.log(`  ${p04Ok ? "✓" : "✗"} ${res04.length} turnos`);

    // P05: Código
    console.log("\n[P05] Generación de código...");
    const tareas = [
      { nombre: "js_email", prompt: "Escribe una función en JavaScript que valide si un correo electrónico es válido usando expresión regular. Incluye comentarios explicativos. SOLO CÓDIGO JS.", lenguaje: "javascript" },
      { nombre: "py_leer", prompt: "Escribe un script en Python que lea un archivo de texto e imprima solo las líneas que contengan 'error'. Incluye manejo de excepciones. SOLO CÓDIGO PYTHON.", lenguaje: "python" },
    ];
    const res05 = [];
    for (const tarea of tareas) {
      const r = await askConIdioma(BASE_URL, "code", tarea.prompt, idioma.clave);
      const ext = tarea.lenguaje === "javascript" ? "js" : "py";
      const nombreArchivo = `codigo_${tarea.nombre}_${idioma.clave}.${ext}`;
      const rutaArchivo = path.join(carpeta, nombreArchivo);
      let archivoGuardado = false, calidad = null, refusal = false;
      if (r.success && r.respuesta) {
        const codigo = extraerCodigoBloque(r.respuesta, tarea.lenguaje);
        fs.writeFileSync(rutaArchivo, codigo, "utf8");
        archivoGuardado = fs.existsSync(rutaArchivo);
        refusal = detectarRefusal(codigo);
        const indicadores = tarea.lenguaje === "javascript"
          ? [["funcion", /function\s+\w+/], ["regex", /RegExp|\\/], ["retorno", /return/]]
          : [["funcion", /def\s+\w+/], ["tryExcept", /try\s*:|except/], ["openFile", /open\(/]];
        const checks = { comentarios: /\/\/|\/\*/.test(codigo), noPlaceholders: !/TODO|FIXME/.test(codigo) };
        for (const [nom, reg] of indicadores) checks[nom] = reg.test(codigo);
        calidad = Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100);
      }
      res05.push({ tarea: tarea.nombre, exito: r.success, duracionMs: r.duracionMs, calidad, refusal, error: r.error });
      console.log(`  ${tarea.nombre}: ${r.success ? "✓" : "✗"} ${r.duracionMs.toFixed(0)}ms | calidad: ${calidad || 0}%${refusal ? " | REFUSAL" : ""}${r.error ? " | ERR: " + r.error : ""}`);
    }
    resIdioma.p05 = { exito: res05.every(r => r.exito), tareas: res05 };

    // P06: Landing page
    console.log("\n[P06] Landing page HTML/CSS/JS...");
    const promptsLP = {
      html: `Crea SOLO el HTML de una landing page para una clínica veterinaria llamada "Patitas Felices". HTML5 semántico. Enlaces a style.css y script.js. Secciones: header, hero, servicios, tabla de precios, formulario, footer. REGLA ESTRICTA: NO CSS, NO JavaScript, NO <style>, NO <script>. SOLO HTML puro.`,
      css: `Crea SOLO el CSS para landing page de clínica veterinaria "Patitas Felices". Diseño responsive, paleta verde (#2e7d32) y naranja (#ff9800), animaciones hover, tarjetas con sombra, tabla zebra, formulario stylizado, header fijo. REGLA ESTRICTA: SOLO CSS puro. NO HTML.`,
      js: `Crea SOLO el JavaScript para landing page de clínica veterinaria "Patitas Felices". Menú móvil toggle, formulario con validación, mensaje de confirmación, smooth scroll, botón CTA con alert. Vanilla JS sin frameworks. REGLA ESTRICTA: SOLO JS puro. NO HTML.`,
    };
    const res06 = {};
    for (const [tipo, prompt] of Object.entries(promptsLP)) {
      const r = await askConIdioma(BASE_URL, "web", prompt, idioma.clave);
      const nombreArchivo = `${tipo}_${idioma.clave}.${tipo === 'html' ? 'html' : tipo === 'css' ? 'css' : 'js'}`;
      const rutaArchivo = path.join(carpeta, nombreArchivo);
      let archivoCreado = false, calidad = 0, refusal = false, contaminacion = false;
      if (r.success && r.respuesta) {
        const limpio = extraerCodigoBloque(r.respuesta, tipo === 'html' ? 'html' : tipo === 'css' ? 'css' : 'javascript');
        fs.writeFileSync(rutaArchivo, limpio, "utf8");
        archivoCreado = fs.existsSync(rutaArchivo);
        refusal = detectarRefusal(limpio);
        if (tipo === 'html') calidad = validarHTML(limpio);
        if (tipo === 'css') calidad = validarCSS(limpio);
        if (tipo === 'js') {
          calidad = validarJS(limpio);
          contaminacion = /<!DOCTYPE\s+html>/i.test(limpio) || /<html[^>]*>/i.test(limpio);
        }
      }
      res06[tipo] = { exito: r.success, duracionMs: r.duracionMs, calidad, refusal, contaminacion, error: r.error };
      console.log(`  ${tipo}: ${r.success ? "✓" : "✗"} ${r.duracionMs.toFixed(0)}ms | calidad: ${calidad}%${refusal ? " | REFUSAL" : ""}${contaminacion ? " | CONTAMINACIÓN" : ""}${r.error ? " | ERR: " + r.error : ""}`);
    }
    resIdioma.p06 = { exito: Object.values(res06).every(r => r.exito), resultados: res06 };

    fs.writeFileSync(path.join(carpeta, "resultados.json"), JSON.stringify(resIdioma, null, 2), "utf8");
    resultados[idioma.clave] = resIdioma;
    console.log(`\n  Resultados guardados en: ${carpeta}/resultados.json`);
  }

  // Comparativa final
  console.log("\n" + "=".repeat(70));
  console.log("COMPARATIVA FINAL: ESPAÑOL vs INGLÉS");
  console.log("=".repeat(70));
  console.log("| Métrica | ESPAÑOL | INGLÉS | Diferencia |");
  console.log("|---------|---------|--------|------------|");

  const es = resultados.es;
  const en = resultados.en;

  console.log(`| P01 Chat (ms) | ${es.p01.duracionMs.toFixed(0)} | ${en.p01.duracionMs.toFixed(0)} | ${((en.p01.duracionMs - es.p01.duracionMs) / es.p01.duracionMs * 100).toFixed(0)}% |`);
  console.log(`| P03 Recuerda nombre | ${es.p03.recuerdaNombre ? "✓" : "✗"} | ${en.p03.recuerdaNombre ? "✓" : "✗"} | |`);
  console.log(`| P03 Recuerda clínica | ${es.p03.recuerdaClinica ? "✓" : "✗"} | ${en.p03.recuerdaClinica ? "✓" : "✗"} | |`);
  console.log(`| P03 Recuerda servicios | ${es.p03.recuerdaServicios ? "✓" : "✗"} | ${en.p03.recuerdaServicios ? "✓" : "✗"} | |`);
  console.log(`| P04 Contexto largo | ${es.p04.exito ? "✓" : "✗"} | ${en.p04.exito ? "✓" : "✗"} | |`);

  const calJS_es = es.p05.tareas.find(t => t.tarea === "js_email")?.calidad || 0;
  const calJS_en = en.p05.tareas.find(t => t.tarea === "js_email")?.calidad || 0;
  const calPy_es = es.p05.tareas.find(t => t.tarea === "py_leer")?.calidad || 0;
  const calPy_en = en.p05.tareas.find(t => t.tarea === "py_leer")?.calidad || 0;
  console.log(`| P05 Código JS (calidad %) | ${calJS_es} | ${calJS_en} | ${calJS_en - calJS_es} pts |`);
  console.log(`| P05 Código Python (calidad %) | ${calPy_es} | ${calPy_en} | ${calPy_en - calPy_es} pts |`);

  const calHTML_es = es.p06.resultados.html?.calidad || 0;
  const calHTML_en = en.p06.resultados.html?.calidad || 0;
  const calCSS_es = es.p06.resultados.css?.calidad || 0;
  const calCSS_en = en.p06.resultados.css?.calidad || 0;
  const calJS6_es = es.p06.resultados.js?.calidad || 0;
  const calJS6_en = en.p06.resultados.js?.calidad || 0;
  console.log(`| P06 HTML (calidad %) | ${calHTML_es} | ${calHTML_en} | ${calHTML_en - calHTML_es} pts |`);
  console.log(`| P06 CSS (calidad %) | ${calCSS_es} | ${calCSS_en} | ${calCSS_en - calCSS_es} pts |`);
  console.log(`| P06 JS (calidad %) | ${calJS6_es} | ${calJS6_en} | ${calJS6_en - calJS6_es} pts |`);

  const archivoResumen = path.join(RESULTADOS_DIR, "comparativa_idioma.json");
  fs.writeFileSync(archivoResumen, JSON.stringify(resultados, null, 2), "utf8");
  console.log(`\nResumen completo guardado en: ${archivoResumen}`);
  console.log("\n" + "=".repeat(70));
  console.log("PRUEBA COMPLETADA");
  console.log("=".repeat(70));
}

main().catch(console.error);