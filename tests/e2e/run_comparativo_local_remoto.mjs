/**
 * ⚠️ SUPERSEDED — No usar para reportes nuevos.
 * No enforceaba responseTimeout y sus artefactos se sobrescribían entre suites.
 * Usar:
 *   node tests/e2e/run_canonical.mjs --suite=local
 *   node tests/e2e/run_canonical.mjs --suite=remote --output=RESUMEN_REMOTO.md
 *
 * Prueba comparativa lfm3-omni: LOCAL vs REMOTO
 * Ejecuta las mismas pruebas en ambos servidores y compara resultados.
 */

import { askAgent } from "../../src/agent.js";
import { getModelConfig } from "../../src/config/presets.js";
import fs from "node:fs";
import path from "node:path";

const LOCAL_URL = "http://localhost:11434";
const REMOTO_URL = "http://192.168.100.126:11434";

const MODELO_LOCAL = "lfm3-omni:2b";
const MODELO_REMOTO = "lfm3-omni:latest";

const RESULTADOS_DIR = path.join(process.cwd(), "resultados_comparativo");

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

// Validadores rápidos
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

async function askConConfig(baseUrl, taskType, prompt) {
  const modelo = baseUrl === LOCAL_URL ? MODELO_LOCAL : MODELO_REMOTO;
  const config = getModelConfig(modelo, taskType, {
    baseUrl,
    maxTokens: MAX_TOKENS_BY_TASK[taskType] || 2048,
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
  } catch (err) { error = err.message; }
  const end = Date.now();
  return {
    success: !error, error, duracionMs: end - start,
    respuesta: result?.text || "",
    tokens: result?.usage?.total_tokens || null,
    tokPerSec: result?.usage?.tokens_per_second || null,
    diagnosticos: result?.diagnostics || {},
  };
}

async function main() {
  console.log("=".repeat(70));
  console.log("COMPARATIVA lfm3-omni: LOCAL vs REMOTO");
  console.log("=".repeat(70));
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log(`Local: ${LOCAL_URL}`);
  console.log(`Remoto: ${REMOTO_URL}\n`);

  const servidores = [
    { nombre: "LOCAL", url: LOCAL_URL },
    { nombre: "REMOTO", url: REMOTO_URL },
  ];

  const comparativa = {};

  for (const sv of servidores) {
    console.log("\n" + "=".repeat(70));
    console.log(`SERVIDOR: ${sv.nombre} (${sv.url})`);
    console.log("=".repeat(70));

    const carpeta = path.join(RESULTADOS_DIR, sv.nombre.toLowerCase());
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

    const resultados = {};

    // P01: Chat
    console.log("\n[P01] Chat simple...");
    const r01 = await askConConfig(sv.url, "chat", "Explica en máximo 3 oraciones qué es React y para qué sirve.");
    resultados.p01 = {
      exito: r01.success, duracionMs: r01.duracionMs,
      respuesta: r01.respuesta?.substring(0, 150),
      tokens: r01.tokens, tokPerSec: r01.tokPerSec,
      error: r01.error,
    };
    console.log(`  ${r01.success ? "✓" : "✗"} ${r01.duracionMs.toFixed(0)}ms | ${r01.tokPerSec?.toFixed(2) || 0} tok/s | ${r01.error ? "ERR: " + r01.error : ""}`);

    // P03: Coherencia
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
      const r = await askConConfig(sv.url, "chat", textos[i]);
      if (!r.success) p03Ok = false;
      conv.push({ role: "user", content: textos[i] });
      if (r.respuesta) conv.push({ role: "assistant", content: r.respuesta });
      res03.push({ turno: i + 1, exito: r.success, respuesta: r.respuesta, duracionMs: r.duracionMs });
    }
    const t3 = res03[2]?.respuesta || "";
    const t4 = res03[3]?.respuesta || "";
    resultados.p03 = {
      exito: p03Ok,
      recuerdaNombre: /maría/i.test(t3),
      recuerdaClinica: /patitas felices/i.test(t3),
      recuerdaServicios: /consulta|cirugía|vacunación/i.test(t4),
      duracionPromedioMs: res03.reduce((a, b) => a + b.duracionMs, 0) / res03.length,
    };
    console.log(`  ${p03Ok ? "✓" : "✗"} | nombre: ${resultados.p03.recuerdaNombre ? "✓" : "✗"} | clínica: ${resultados.p03.recuerdaClinica ? "✓" : "✗"} | servicios: ${resultados.p03.recuerdaServicios ? "✓" : "✗"}`);

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
      const r = await askConConfig(sv.url, "longContext", longMsgs[i]);
      if (!r.success) p04Ok = false;
      conv2.push({ role: "user", content: longMsgs[i] });
      if (r.respuesta) conv2.push({ role: "assistant", content: r.respuesta });
      res04.push({ turno: i + 1, exito: r.success, duracionMs: r.duracionMs });
    }
    resultados.p04 = { exito: p04Ok, turnos: res04.length };
    console.log(`  ${p04Ok ? "✓" : "✗"} ${res04.length} turnos`);

    // P05: Código
    console.log("\n[P05] Generación de código...");
    const tareas = [
      { nombre: "js_email", prompt: "Escribe una función en JavaScript que valide email con regex. SOLO CÓDIGO JS, sin explicaciones.", lenguaje: "javascript" },
      { nombre: "py_leer", prompt: "Escribe un script en Python que lea un archivo e imprima líneas con 'error'. SOLO CÓDIGO PYTHON, sin explicaciones.", lenguaje: "python" },
    ];
    const res05 = [];
    for (const tarea of tareas) {
      const r = await askConConfig(sv.url, "code", tarea.prompt);
      const ext = tarea.lenguaje === "javascript" ? "js" : "py";
      const nombreArchivo = `codigo_${tarea.nombre}.${ext}`;
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
        const checks = {};
        for (const [nom, reg] of indicadores) checks[nom] = reg.test(codigo);
        checks.comentarios = /\/\/|\/\*/.test(codigo);
        checks.noPlaceholders = !/TODO|FIXME/.test(codigo);
        calidad = Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100);
      }
      res05.push({ tarea: tarea.nombre, exito: r.success, duracionMs: r.duracionMs, calidad, refusal, error: r.error });
      console.log(`  ${tarea.nombre}: ${r.success ? "✓" : "✗"} ${r.duracionMs.toFixed(0)}ms | calidad: ${calidad || 0}%${refusal ? " | REFUSAL" : ""}${r.error ? " | ERR: " + r.error : ""}`);
    }
    resultados.p05 = { exito: res05.every(r => r.exito), tareas: res05 };

    // P06: Landing page
    console.log("\n[P06] Landing page HTML/CSS/JS...");
    const promptsLP = {
      html: `Crea SOLO el HTML de una landing page para una clínica veterinaria llamada "Patitas Felices". HTML5 semántico. Enlaces a style.css y script.js. Secciones: header, hero, servicios, tabla de precios, formulario, footer. REGLA ESTRICTA: NO CSS, NO JavaScript, NO <style>, NO <script>. SOLO HTML puro.`,
      css: `Crea SOLO el CSS para landing page de clínica veterinaria "Patitas Felices". Diseño responsive, paleta verde (#2e7d32) y naranja (#ff9800), animaciones hover, tarjetas con sombra, tabla zebra, formulario stylizado, header fijo. REGLA ESTRICTA: SOLO CSS puro. NO HTML.`,
      js: `Crea SOLO el JavaScript para landing page de clínica veterinaria "Patitas Felices". Menú móvil toggle, formulario con validación, mensaje de confirmación, smooth scroll, botón CTA con alert. Vanilla JS sin frameworks. REGLA ESTRICTA: SOLO JS puro. NO HTML.`,
    };
    const res06 = {};
    for (const [tipo, prompt] of Object.entries(promptsLP)) {
      const r = await askConConfig(sv.url, "web", prompt);
      const nombreArchivo = tipo === 'html' ? 'index.html' : tipo === 'css' ? 'style.css' : 'script.js';
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
    resultados.p06 = { exito: Object.values(res06).every(r => r.exito), resultados: res06 };

    fs.writeFileSync(path.join(carpeta, "resultados.json"), JSON.stringify(resultados, null, 2), "utf8");
    comparativa[sv.nombre] = resultados;
    console.log(`\n  Resultados guardados en: ${carpeta}/resultados.json`);
  }

  // Comparativa final
  console.log("\n" + "=".repeat(70));
  console.log("COMPARATIVA FINAL: LOCAL vs REMOTO");
  console.log("=".repeat(70));
  console.log("| Métrica | LOCAL | REMOTO | Diferencia |");
  console.log("|---------|-------|--------|------------|");

  const l = comparativa.LOCAL;
  const r = comparativa.REMOTO;

  const p01L = l.p01.duracionMs, p01R = r.p01.duracionMs;
  console.log(`| P01 Chat (ms) | ${p01L.toFixed(0)} | ${p01R.toFixed(0)} | ${((p01R - p01L) / p01L * 100).toFixed(0)}% |`);

  const p03L = l.p03.duracionPromedioMs, p03R = r.p03.duracionPromedioMs;
  console.log(`| P03 Coherencia (ms/turno) | ${p03L.toFixed(0)} | ${p03R.toFixed(0)} | ${((p03R - p03L) / p03L * 100).toFixed(0)}% |`);
  console.log(`|   Recuerda nombre | ${l.p03.recuerdaNombre ? "✓" : "✗"} | ${r.p03.recuerdaNombre ? "✓" : "✗"} | |`);
  console.log(`|   Recuerda clínica | ${l.p03.recuerdaClinica ? "✓" : "✗"} | ${r.p03.recuerdaClinica ? "✓" : "✗"} | |`);
  console.log(`|   Recuerda servicios | ${l.p03.recuerdaServicios ? "✓" : "✗"} | ${r.p03.recuerdaServicios ? "✓" : "✗"} | |`);

  console.log(`| P04 Contexto largo | ${l.p04.exito ? "✓" : "✗"} | ${r.p04.exito ? "✓" : "✗"} | |`);

  const p05L = l.p05.tareas.map(t => t.calidad || 0);
  const p05R = r.p05.tareas.map(t => t.calidad || 0);
  const promL = p05L.reduce((a, b) => a + b, 0) / p05L.length;
  const promR = p05R.reduce((a, b) => a + b, 0) / p05R.length;
  console.log(`| P05 Código (calidad %) | ${promL.toFixed(0)} | ${promR.toFixed(0)} | ${(promR - promL).toFixed(0)} pts |`);

  const p06L = [l.p06.resultados.html?.calidad || 0, l.p06.resultados.css?.calidad || 0, l.p06.resultados.js?.calidad || 0];
  const p06R = [r.p06.resultados.html?.calidad || 0, r.p06.resultados.css?.calidad || 0, r.p06.resultados.js?.calidad || 0];
  const prom6L = p06L.reduce((a, b) => a + b, 0) / 3;
  const prom6R = p06R.reduce((a, b) => a + b, 0) / 3;
  console.log(`| P06 HTML | ${p06L[0]} | ${p06R[0]} | |`);
  console.log(`| P06 CSS  | ${p06L[1]} | ${p06R[1]} | |`);
  console.log(`| P06 JS   | ${p06L[2]} | ${p06R[2]} | |`);

  const archivoResumen = path.join(RESULTADOS_DIR, "comparativa_final.json");
  fs.writeFileSync(archivoResumen, JSON.stringify(comparativa, null, 2), "utf8");
  console.log(`\nResumen completo guardado en: ${archivoResumen}`);
  console.log("\n" + "=".repeat(70));
  console.log("COMPARATIVA COMPLETADA");
  console.log("=".repeat(70));
}

main().catch(console.error);