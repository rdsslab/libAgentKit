/**
 * ⚠️ SUPERSEDED — No usar para reportes nuevos.
 * Comparación incompleta (solo P01/P05) y con el system prompt mal conectado.
 * Usar:
 *   node tests/e2e/run_canonical.mjs --suite=idioma --output=RESUMEN_IDIOMA_VALIDO.md
 *
 * Prueba rápida: System prompts ESPAÑOL vs INGLÉS (P01 y P05)
 * Solo prueba chat y código para ser más rápido.
 */

import { askAgent } from "../../src/agent.js";
import { getSystemPrompt } from "../../src/utils/system-prompts-en.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:11434";
const MODELO = "lfm3-omni:2b";
const RESULTADOS_DIR = path.join(process.cwd(), "resultados_idioma_rapido");

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

async function askConIdioma(taskType, prompt, idioma) {
  const systemPrompt = getSystemPrompt(taskType, idioma);
  const config = {
    provider: "ollama", model: MODELO, baseUrl: BASE_URL,
    maxTokens: taskType === 'code' ? 512 : 1024,
    system: systemPrompt,
    temperature: taskType === 'code' ? 0.2 : 0.7,
    top_p: 0.9, top_k: 40, repeat_penalty: 1.1,
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
  console.log("PRUEBA RÁPIDA: System prompts ESPAÑOL vs INGLÉS");
  console.log("=".repeat(70));
  console.log(`Servidor: ${BASE_URL} | Modelo: ${MODELO}\n`);

  const idiomas = [
    { nombre: "ESPAÑOL", clave: "es" },
    { nombre: "INGLÉS", clave: "en" },
  ];

  const resultados = {};

  for (const idioma of idiomas) {
    console.log("\n" + "=".repeat(70));
    console.log(`IDIOMA: ${idioma.nombre}`);
    console.log("=".repeat(70));

    const carpeta = path.join(RESULTADOS_DIR, idioma.clave);
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

    const resIdioma = {};

    // P01: Chat
    console.log("\n[P01] Chat simple...");
    const r01 = await askConIdioma("chat", "Explica en máximo 3 oraciones qué es React y para qué sirve.", idioma.clave);
    resIdioma.p01 = { exito: r01.success, duracionMs: r01.duracionMs, respuesta: r01.respuesta?.substring(0, 200), error: r01.error };
    console.log(`  ${r01.success ? "✓" : "✗"} ${r01.duracionMs.toFixed(0)}ms${r01.error ? " | ERR: " + r01.error : ""}`);

    // P05: Código JS
    console.log("\n[P05] Código JS...");
    const r05 = await askConIdioma("code", "Escribe una función en JavaScript que valide si un correo electrónico es válido usando expresión regular. SOLO CÓDIGO JS, sin explicaciones.", idioma.clave);
    const codigo = extraerCodigoBloque(r05.respuesta, 'javascript');
    const calidadJS = {
      funcion: /function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>/.test(codigo),
      regex: /RegExp|\\/.test(codigo),
      retorno: /return/.test(codigo),
      comentarios: /\/\/|\/\*/.test(codigo),
      noPlaceholders: !/TODO|FIXME/.test(codigo),
    };
    const puntuacionJS = Math.round(Object.values(calidadJS).filter(Boolean).length / Object.keys(calidadJS).length * 100);
    resIdioma.p05 = { exito: r05.success, duracionMs: r05.duracionMs, calidad: puntuacionJS, refusal: detectarRefusal(codigo), error: r05.error };
    console.log(`  ${r05.success ? "✓" : "✗"} ${r05.duracionMs.toFixed(0)}ms | calidad: ${puntuacionJS}%${detectarRefusal(codigo) ? " | REFUSAL" : ""}${r05.error ? " | ERR: " + r05.error : ""}`);
    fs.writeFileSync(path.join(carpeta, "codigo_js.js"), codigo, "utf8");

    // P05: Código Python
    console.log("\n[P05] Código Python...");
    const r05py = await askConIdioma("code", "Escribe un script en Python que lea un archivo e imprima líneas con 'error'. Incluye manejo de excepciones. SOLO CÓDIGO PYTHON.", idioma.clave);
    const codigoPy = extraerCodigoBloque(r05py.respuesta, 'python');
    const calidadPy = {
      funcion: /def\s+\w+/.test(codigoPy),
      manejoErrores: /try\s*:|except/.test(codigoPy),
      abrirArchivo: /open\(/.test(codigoPy),
      comentarios: /#/.test(codigoPy),
      noPlaceholders: !/TODO|FIXME/.test(codigoPy),
    };
    const puntuacionPy = Math.round(Object.values(calidadPy).filter(Boolean).length / Object.keys(calidadPy).length * 100);
    resIdioma.p05py = { exito: r05py.success, duracionMs: r05py.duracionMs, calidad: puntuacionPy, refusal: detectarRefusal(codigoPy), error: r05py.error };
    console.log(`  ${r05py.success ? "✓" : "✗"} ${r05py.duracionMs.toFixed(0)}ms | calidad: ${puntuacionPy}%${detectarRefusal(codigoPy) ? " | REFUSAL" : ""}${r05py.error ? " | ERR: " + r05py.error : ""}`);
    fs.writeFileSync(path.join(carpeta, "codigo_py.py"), codigoPy, "utf8");

    fs.writeFileSync(path.join(carpeta, "resultados.json"), JSON.stringify(resIdioma, null, 2), "utf8");
    resultados[idioma.clave] = resIdioma;
  }

  // Comparativa
  console.log("\n" + "=".repeat(70));
  console.log("COMPARATIVA: ESPAÑOL vs INGLÉS");
  console.log("=".repeat(70));
  console.log("| Métrica | ESPAÑOL | INGLÉS | Diferencia |");
  console.log("|---------|---------|--------|------------|");

  const es = resultados.es;
  const en = resultados.en;

  console.log(`| P01 Chat (ms) | ${es.p01.duracionMs.toFixed(0)} | ${en.p01.duracionMs.toFixed(0)} | ${((en.p01.duracionMs - es.p01.duracionMs) / es.p01.duracionMs * 100).toFixed(0)}% |`);
  console.log(`| P05 JS calidad | ${es.p05.calidad}% | ${en.p05.calidad}% | ${en.p05.calidad - es.p05.calidad} pts |`);
  console.log(`| P05 Python calidad | ${es.p05py.calidad}% | ${en.p05py.calidad}% | ${en.p05py.calidad - es.p05py.calidad} pts |`);
  console.log(`| P05 JS refusal | ${es.p05.refusal ? "SÍ" : "NO"} | ${en.p05.refusal ? "SÍ" : "NO"} | |`);
  console.log(`| P05 Python refusal | ${es.p05py.refusal ? "SÍ" : "NO"} | ${en.p05py.refusal ? "SÍ" : "NO"} | |`);

  const archivoResumen = path.join(RESULTADOS_DIR, "comparativa_rapida.json");
  fs.writeFileSync(archivoResumen, JSON.stringify(resultados, null, 2), "utf8");
  console.log(`\nResumen guardado en: ${archivoResumen}`);
  console.log("\n" + "=".repeat(70));
  console.log("PRUEBA COMPLETADA");
  console.log("=".repeat(70));
}

main().catch(console.error);