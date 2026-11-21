/**
 * ⚠️ SUPERSEDED — No usar para reportes nuevos.
 * El runner canónico cubre presets, timeouts, historial, compactación y calidad:
 *   node tests/e2e/run_canonical.mjs --suite=local
 *   node tests/e2e/run_canonical.mjs --suite=remote --output=RESUMEN_REMOTO.md
 *
 * E2E con presets de configuración por tipo de tarea.
 *
 * Usa src/config/presets.js para obtener configuración optimizada por tarea
 * (chat, code, web, longContext, reasoning) y valida la calidad del código
 * generado. Los validadores viven aquí (capa de pruebas), no en el core.
 */

import { askAgent } from "../../src/agent.js";
import { getModelConfig, MODEL_PRESETS } from "../../src/config/presets.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://192.168.100.126:11434";

const MODELOS = [
  // { model: "qwen2.5:1.5b-instruct", categoria: "pequeno", tamanoGB: 1.0 },
  { model: "lfm3-omni:latest", categoria: "lfm3", tamanoGB: 1.7 },
  // { model: "qwen3:1.7b", categoria: "mediano", tamanoGB: 1.4 },
  // { model: "qwen2.5-coder:3b", categoria: "mediano", tamanoGB: 1.9 },
];

const RESULTADOS_DIR = path.join(process.cwd(), "resultados_por_modelo");

// Timeouts por tipo de tarea (ms)
const TIMEOUTS = {
  chat: 120000,
  longContext: 120000,
  code: 300000,
  web: 300000,
};

// maxTokens por tipo de tarea (reducidos para servidor remoto lento)
const MAX_TOKENS_BY_TASK = {
  chat: 1024,
  longContext: 2048,
  code: 512,
  web: 512,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Validadores de calidad (capa de pruebas, NO van en el core)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

function validarHTML(contenido) {
  const checks = {
    tieneDoctype: /<!DOCTYPE\s+html>/i.test(contenido),
    tieneHtml: /<html[^>]*>/i.test(contenido),
    tieneBody: /<body[^>]*>/i.test(contenido),
    tieneCSS: /style\.css/.test(contenido),
    tieneJS: /script\.js/.test(contenido),
    tieneHeader: /<header/i.test(contenido),
    tieneForm: /<form/i.test(contenido),
  };
  const puntuacion = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
  return { checks, puntuacion };
}

function validarCSS(contenido) {
  const checks = {
    tieneBody: /body\s*\{/.test(contenido),
    tieneHover: /:hover/.test(contenido),
    tieneMediaQuery: /@media/.test(contenido),
    tieneColorHex: /#[0-9a-fA-F]{3,6}/.test(contenido),
    tieneTransition: /transition/.test(contenido),
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
  const puntuacion = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
  return { checks, puntuacion };
}

function validarCodigoGenerico(contenido, indicadores = []) {
  const baseChecks = {
    tieneComentarios: /\/\/|\/\*[\s\S]*?\*\//.test(contenido),
    noPlaceholders: !/TODO|FIXME|placeholder|lorem ipsum/i.test(contenido),
    noTextoExplicativoFuera: !/lo siento|no puedo|disculpe/i.test(contenido.trim().split('\n')[0]),
  };
  const extraChecks = {};
  for (const [name, regex] of indicadores) {
    extraChecks[name] = regex.test(contenido);
  }
  const allChecks = { ...baseChecks, ...extraChecks };
  const puntuacion = Math.round((Object.values(allChecks).filter(Boolean).length / Object.keys(allChecks).length) * 100);
  return { checks: allChecks, puntuacion };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Función de llamada con configuración por tarea
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function askConConfig(modelo, taskType, prompt, systemOverride = null) {
  const timeoutMs = TIMEOUTS[taskType] || 300000;
  const config = getModelConfig(modelo.model, taskType, {
    baseUrl: BASE_URL,
    maxTokens: MAX_TOKENS_BY_TASK[taskType] || 2048,
    ...(systemOverride ? { system: systemOverride } : {}),
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
    usage: result?.usage || null,
    tokensPerSecond: result?.usage?.tokens_per_second || null,
    contexto: result?.usage?.context || null,
    configUsada: {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      num_ctx: config.num_ctx,
      taskType,
      timeoutMs,
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log("=".repeat(70));
  console.log("E2E CON PRESETS - Pruebas con configuración por tipo de tarea");
  console.log("=".repeat(70));
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log(`Servidor: ${BASE_URL}\n`);

  const resultadosGenerales = {};

  for (const modelo of MODELOS) {
    console.log("\n" + "=".repeat(70));
    console.log(`MODELO: ${modelo.model} (${modelo.categoria}, ~${modelo.tamanoGB}GB)`);
    console.log("=".repeat(70));

    const carpetaModelo = path.join(RESULTADOS_DIR, modelo.model.replace(/\//g, "_"));
    if (!fs.existsSync(carpetaModelo)) fs.mkdirSync(carpetaModelo, { recursive: true });

    const resultadosModelo = {};

    // ── P01: Tiempos de respuesta (chat) ──
    console.log("\n[P01] Tiempos de respuesta (chat)...");
    try {
      const r01 = await askConConfig(modelo, "chat", "Explica en máximo 3 oraciones qué es React y para qué sirve.");
      resultadosModelo["01_response_time"] = {
        exito: r01.success,
        duracionMs: r01.duracionMs,
        respuesta: r01.respuesta?.substring(0, 200),
        error: r01.error,
        tokens: r01.usage?.total_tokens || null,
        tokensPorSegundo: r01.tokensPerSecond || null,
        contexto: r01.contexto || null,
        config: r01.configUsada,
      };
      console.log(`  ${r01.success ? "✓" : "✗"} ${r01.duracionMs.toFixed(0)}ms${r01.error ? " (error: " + r01.error + ")" : ""}`);
    } catch (e) {
      resultadosModelo["01_response_time"] = { exito: false, error: e.message };
      console.log(`  ✗ Excepción: ${e.message}`);
    }

    // ── P03: Coherencia multi-turno (chat) ──
    console.log("\n[P03] Coherencia multi-turno (chat)...");
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
      const r = await askConConfig(modelo, "chat", textos[i]);
      if (!r.success) p03Ok = false;
      conv.push({ role: "user", content: textos[i] });
      if (r.respuesta) conv.push({ role: "assistant", content: r.respuesta });
      res03.push({ turno: i + 1, usuario: textos[i], respuesta: r.respuesta, exito: r.success, duracionMs: r.duracionMs, error: r.error });
    }
    const t3 = res03[2]?.respuesta || "";
    const t4 = res03[3]?.respuesta || "";
    resultadosModelo["03_response_coherence"] = {
      exito: p03Ok,
      recuerdaNombre: /maría/i.test(t3),
      recuerdaClinica: /patitas felices/i.test(t3),
      recuerdaServicios: /consulta|cirugía|vacunación/i.test(t4),
      resultados: res03,
    };
    console.log(`  ${p03Ok ? "✓" : "✗"} ${res03.length} turnos`);

    // ── P04: Contexto largo con compactación (longContext) ──
    console.log("\n[P04] Contexto largo con compactación (longContext)...");
    const longMsgs = [
      "Mensaje 1: Información extensa sobre cuidado de mascotas. Los perros necesitan paseos diarios, alimentación balanceada y visitas regulares al veterinario.",
      "Mensaje 2: Los gatos necesitan arenero limpio, comida de calidad, y revisiones veterinarias anuales para detectar problemas temprano.",
      "Mensaje 3: Las aves requieren jaulas espaciosas, dieta variada de semillas y frutas, y socialización diaria con sus dueños.",
      "Mensaje 4: Los conejos necesitan heno ilimitado, verduras frescas, y espacio para saltar y hacer ejercicio.",
      "Mensaje 5: Las mascotas exóticas como iguanas y serpientes necesitan terrarios con control de temperatura y humedad específico.",
    ];
    const conv2 = [];
    const res04 = [];
    let p04Ok = true;
    for (let i = 0; i < longMsgs.length; i++) {
      const r = await askConConfig(modelo, "longContext", longMsgs[i]);
      if (!r.success) p04Ok = false;
      conv2.push({ role: "user", content: longMsgs[i] });
      if (r.respuesta) conv2.push({ role: "assistant", content: r.respuesta });
      res04.push({ turno: i + 1, respuesta: r.respuesta, exito: r.success, duracionMs: r.duracionMs, contexto: r.contexto, error: r.error });
    }
    resultadosModelo["04_long_context_compaction"] = {
      exito: p04Ok,
      umbralCompactacion: 25,
      resultados: res04,
    };
    console.log(`  ${p04Ok ? "✓" : "✗"} ${res04.length} turnos`);

    // ── P05: Generación de código (code) ──
    console.log("\n[P05] Generación de código (code)...");
    const tareas = [
      {
        nombre: "javascript_funcion_utilitaria",
        prompt: "Escribe una función en JavaScript que valide si un correo electrónico es válido usando expresión regular. Incluye comentarios explicativos y un ejemplo de uso.",
        lenguaje: "javascript",
        indicadores: [
          ["tieneFuncion", /function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>/],
          ["tieneRegex", new RegExp("RegExp|\\\\")],
          ["tieneRetorno", /return/],
        ],
      },
      {
        nombre: "python_lectura_archivo",
        prompt: "Escribe un script en Python que lea un archivo de texto línea por línea e imprima solo las líneas que contengan la palabra 'error'. Incluye manejo de excepciones.",
        lenguaje: "python",
        indicadores: [
          ["tieneFuncion", /def\s+\w+/],
          ["tieneManejoErrores", /try\s*:|except/],
          ["tieneAperturaArchivo", /open\(/],
        ],
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
        calidad = validarCodigoGenerico(codigoLimpio, tarea.indicadores);
      }
      res05.push({
        tarea: tarea.nombre,
        lenguaje: tarea.lenguaje,
        exito: r.success,
        duracionMs: r.duracionMs,
        error: r.error,
        archivoGuardado,
        calidad,
        config: r.configUsada,
      });
    }
    resultadosModelo["05_code_generation"] = {
      exito: res05.every(r => r.exito),
      resultados: res05,
    };
    console.log(`  ${res05.every(r => r.exito) ? "✓" : "✗"} ${res05.length} tareas`);

    // ── P06: Landing page HTML/CSS/JS (web) ──
    console.log("\n[P06] Landing page HTML/CSS/JS (web)...");
    const promptsLP = {
      html: `Crea el HTML de una landing page para una clínica veterinaria llamada "Patitas Felices". HTML5 semántico completo. Enlaces a style.css y script.js. Secciones: header con navegación, hero con h1 y CTA, servicios (3 tarjetas con iconos y descripciones), tabla de precios (3 planes: Básico, Premium, VIP), formulario de contacto (nombre, email, teléfono, mensaje, botón enviar), footer con derechos reservados y redes sociales. SOLO HTML, sin bloques de código markdown, sin CSS, sin JavaScript.`,
      css: `Crea el CSS para landing page de clínica veterinaria "Patitas Felices". Diseño moderno, responsive (mobile-first), paleta verde veterinario (#2e7d32) y naranja (#ff9800), animaciones de botones hover con transform y transición suave, tarjetas de servicios con sombra y hover, tabla de precios con filas zebra y hover, formulario con inputs stylizados y focus states, header fijo. SOLO CSS, sin bloques de código markdown.`,
      js: `Crea el JavaScript para landing page de clínica veterinaria "Patitas Felices". Menú móvil toggle (hamburguesa), formulario de contacto con validación básica (campos requeridos, formato email), mensaje de confirmación al enviar, smooth scroll para anclas de navegación, botón CTA con alert de confirmación. Vanilla JavaScript sin frameworks. SOLO JS, sin bloques de código markdown.`,
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
        if (tipo === 'html') calidad = validarHTML(contenidoLimpio);
        if (tipo === 'css') calidad = validarCSS(contenidoLimpio);
        if (tipo === 'js') calidad = validarJS(contenidoLimpio);
      }
      res06[tipo] = {
        exito: r.success,
        duracionMs: r.duracionMs,
        error: r.error,
        chars: r.respuesta?.length || 0,
        archivoCreado,
        calidad,
        config: r.configUsada,
      };
      console.log(`    ${tipo}: ${r.success ? "✓" : "✗"} ${r.duracionMs.toFixed(0)}ms${r.error ? " (error: " + r.error + ")" : ""}`);
    }
    resultadosModelo["06_landing_page_html"] = {
      exito: Object.values(res06).every(r => r.exito),
      resultados: res06,
    };
    console.log(`  ${Object.values(res06).every(r => r.exito) ? "✓" : "✗"} 3 archivos`);

    // Guardar resultados
    const archivoResultados = path.join(carpetaModelo, "resultados.json");
    fs.writeFileSync(archivoResultados, JSON.stringify(resultadosModelo, null, 2), "utf8");
    resultadosGenerales[modelo.model] = resultadosModelo;
    console.log(`\n  Resultados guardados en: ${archivoResultados}`);
  }

  // Resumen general con puntuaciones de calidad
  console.log("\n" + "=".repeat(70));
  console.log("RESUMEN GENERAL POR MODELO");
  console.log("=".repeat(70));
  console.log("| Modelo | P01 | P03 | P04 | P05 | P06 | Calidad HTML | Calidad CSS | Calidad JS |");
  console.log("|--------|-----|-----|-----|-----|-----|--------------|-------------|------------|");
  for (const [modelo, resultados] of Object.entries(resultadosGenerales)) {
    const p01 = resultados["01_response_time"]?.exito ? "✓" : "✗";
    const p03 = resultados["03_response_coherence"]?.exito ? "✓" : "✗";
    const p04 = resultados["04_long_context_compaction"]?.exito ? "✓" : "✗";
    const p05 = resultados["05_code_generation"]?.exito ? "✓" : "✗";
    const p06 = Object.values(resultados["06_landing_page_html"]?.resultados || {}).every(r => r.exito) ? "✓" : "✗";
    const h = resultados["06_landing_page_html"]?.resultados?.html?.calidad?.puntuacion ?? 0;
    const c = resultados["06_landing_page_html"]?.resultados?.css?.calidad?.puntuacion ?? 0;
    const j = resultados["06_landing_page_html"]?.resultados?.js?.calidad?.puntuacion ?? 0;
    console.log(`| ${modelo.padEnd(30)} | ${p01}   | ${p03}   | ${p04}   | ${p05}   | ${p06}   | ${String(h).padEnd(12)} | ${String(c).padEnd(11)} | ${String(j).padEnd(10)} |`);
  }

  const archivoResumen = path.join(RESULTADOS_DIR, "resumen_presets.json");
  fs.writeFileSync(archivoResumen, JSON.stringify(resultadosGenerales, null, 2), "utf8");
  console.log(`\nResumen guardado en: ${archivoResumen}`);
  console.log("\n" + "=".repeat(70));
  console.log("PRUEBAS COMPLETADAS");
  console.log("=".repeat(70));
}

main().catch(console.error);