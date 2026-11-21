import { askAgent } from "../../src/agent.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://192.168.100.126:11434";
const MODELO = { model: "qwen2.5:1.5b-instruct", baseUrl: BASE_URL };
const CARPETA = path.join(process.cwd(), "resultados_por_modelo", "qwen2.5:1.5b-instruct");

async function ask(prompt, timeoutMs = 300000) {
  const start = Date.now();
  let result = null;
  let error = null;
  try {
    result = await askAgent({
      provider: MODELO,
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
    context: result?.usage?.context || null,
  };
}

async function main() {
  console.log("=".repeat(70));
  console.log("E2E MASTER - Pruebas en Servidor Remoto 192.168.100.126");
  console.log("=".repeat(70));
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log(`Servidor: ${BASE_URL}`);
  console.log(`Modelo: ${MODELO.model} (1.0 GB)\n`);

  const OUTPUT_DIR = path.join(process.cwd(), "resultados_por_modelo", "qwen2.5:1.5b-instruct");
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const resultados = {};

  // PRUEBA 01: Tiempos de respuesta
  console.log("  [01] Tiempos de respuesta...");
  const r01 = await ask("Explica en máximo 3 oraciones qué es React y para qué sirve.", 120000);
  resultados["01_response_time"] = {
    exito: r01.success,
    duracionMs: r01.duracionMs,
    respuesta: r01.respuesta,
    longitud: r01.respuesta?.length || 0,
    tokens: r01.usage?.total_tokens || null,
    tokensPorSegundo: r01.tokensPerSecond || null,
    contexto: r01.context || null,
  };
  console.log(`    ${r01.success ? "✓" : "✗"} ${r01.duracionMs.toFixed(0)}ms`);

  // PRUEBA 03: Coherencia multi-turno
  console.log("  [03] Coherencia multi-turno...");
  const textos = [
    "Mi nombre es María y tengo una clínica veterinaria llamada Patitas Felices.",
    "Atendemos perros, gatos, aves y conejos. Ofrecemos consultas, cirugías y hospitalización.",
    "¿Puedes recordar cuál es mi nombre y el nombre de mi clínica?",
    "¿Qué servicios ofrecemos en la clínica?",
  ];
  const conv = [];
  const res03 = [];
  for (let i = 0; i < textos.length; i++) {
    const r = await ask(MODELO, [...conv, { role: "user", content: textos[i] }], {}, 300000);
    conv.push({ role: "user", content: textos[i] });
    if (r.response) conv.push({ role: "assistant", content: r.response });
    res03.push({ turno: i + 1, usuario: textos[i], respuesta: r.response, exito: r.success, duracionMs: r.durationMs });
  }
  const t3 = res03[2]?.respuesta || "";
  const t4 = res03[3]?.respuesta || "";
  resultados["03_response_coherence"] = {
    exito: res03.every(r => r.exito),
    resultados: res03,
    recuerdaNombre: /maría/i.test(t3),
    recuerdaClinica: /patitas felices/i.test(t3),
    recuerdaServicios: /consulta|cirugía|vacunación/i.test(t4),
  };
  console.log(`    ${res03.every(r => r.exito) ? "✓" : "✗"} ${res03.length} turnos`);

  // PRUEBA 04: Contexto largo con compactación (25% umbral)
  console.log("  [04] Contexto largo (25% umbral)...");
  const longMsgs = [
    "Mensaje 1: Información extensa sobre cuidado de mascotas. Los perros necesitan paseos diarios, alimentación balanceada y visitas regulares al veterinario.",
    "Mensaje 2: Los gatos necesitan arenero limpio, comida de calidad, y revisiones veterinarias anuales para detectar problemas temprano.",
    "Mensaje 3: Las aves requieren jaulas espaciosas, dieta variada de semillas y frutas, y socialización diaria con sus dueños.",
    "Mensaje 4: Los conejos necesitan heno ilimitado, verduras frescas, y espacio para saltar y hacer ejercicio.",
    "Mensaje 5: Las mascotas exóticas como iguanas y serpientes necesitan terrarios con control de temperatura y humedad específico.",
  ];
  const conv2 = [];
  const res04 = [];
  for (let i = 0; i < longMsgs.length; i++) {
    const r = await ask(MODELO, [...conv2, { role: "user", content: longMsgs[i] }], {}, 300000);
    conv2.push({ role: "user", content: longMsgs[i] });
    if (r.response) conv2.push({ role: "assistant", content: r.response });
    res04.push({ turno: i + 1, mensaje: longMsgs[i], respuesta: r.response, exito: r.success, duracionMs: r.durationMs, contexto: r.context });
  }
  const ultimoResp = conv2[conv2.length - 1]?.content || "";
  resultados["04_long_context_compaction"] = {
    exito: res04.every(r => r.exito),
    umbralCompactacion: 25,
    resultados: res04,
    recuerdaNombre: /maría/i.test(ultimoResp),
    recuerdaClinica: /patitas felices/i.test(ultimoResp),
  };
  console.log(`    ${res04.every(r => r.exito) ? "✓" : "✗"} ${res04.length} turnos`);

  // PRUEBA 05: Generación de código
  console.log("  [05] Generación de código...");
  const tareas = [
    { nombre: "javascript_funcion_utilitaria", prompt: "Escribe una función en JavaScript que valide si un correo electrónico es válido usando expresión regular. Incluye comentarios explicativos y un ejemplo de uso.", lenguaje: "javascript" },
    { nombre: "python_lectura_archivo", prompt: "Escribe un script en Python que lea un archivo de texto línea por línea e imprima solo las líneas que contengan la palabra 'error'. Incluye manejo de excepciones.", lenguaje: "python" },
  ];
  const res05 = [];
  for (const tarea of tareas) {
    console.log(`    ${tarea.nombre}...`);
    const r = await ask(MODELO, [{ role: "user", content: tarea.prompt }], {}, 600000);
    const nombreArchivo = `codigo_${tarea.nombre}.${tarea.lenguaje === 'javascript' ? 'js' : 'py'}`;
    const rutaArchivo = path.join(CARPETA, nombreArchivo);
    let archivoGuardado = false;
    if (r.success && r.response) {
      fs.writeFileSync(rutaArchivo, r.response.trim(), "utf8");
      archivoGuardado = fs.existsSync(rutaArchivo);
    }
    res05.push({
      tarea: tarea.nombre,
      lenguaje: tarea.lenguaje,
      exito: r.success,
      duracionMs: r.durationMs,
      respuesta: r.response,
      archivoGuardado,
      archivoRuta: rutaArchivo,
      tokens: r.usage?.total_tokens || null,
      tokensPorSegundo: r.tokensPerSecond || null,
    });
  }
  resultados["05_code_generation"] = {
    exito: res05.every(r => r.exito),
    resultados: res05,
  };
  console.log(`    ${res05.every(r => r.exito) ? "✓" : "✗"} ${res05.length} tareas`);

  // PRUEBA 06: Landing page HTML (3 archivos separados)
  console.log("  [06] Landing page HTML (3 archivos separados)...");
  const promptsLP = {
    html: `Crea el HTML de una landing page para una clínica veterinaria llamada "Patitas Felices". HTML5 semántico completo. Enlaces a style.css y script.js. Secciones: header con navegación, hero con h1 y CTA, servicios (3 tarjetas con iconos y descripciones), tabla de precios (3 planes: Básico, Premium, VIP), formulario de contacto (nombre, email, teléfono, mensaje, botón enviar), footer con derechos reservados y redes sociales. SOLO HTML, sin bloques de código markdown, sin CSS, sin JavaScript.`,
    css: `Crea el CSS para landing page de clínica veterinaria "Patitas Felices". Diseño moderno, responsive (mobile-first), paleta verde veterinario (#2e7d32) y naranja (#ff9800), animaciones de botones hover con transform y transición suave, tarjetas de servicios con sombra y hover, tabla de precios con filas zebra y hover, formulario con inputs stylizados y focus states, header fijo. SOLO CSS, sin bloques de código markdown.`,
    js: `Crea el JavaScript para landing page de clínica veterinaria "Patitas Felices". Menú móvil toggle (hamburguesa), formulario de contacto con validación básica (campos requeridos, formato email), mensaje de confirmación al enviar, smooth scroll para anclas de navegación, botón CTA con alert de confirmación. Vanilla JavaScript sin frameworks. SOLO JS, sin bloques de código markdown.`,
  };
  const res06 = {};
  for (const [tipo, prompt] of Object.entries(promptsLP)) {
    console.log(`    ${tipo}...`);
    const r = await ask(MODELO, [{ role: "user", content: prompt }], {}, 600000);
    const nombreArchivo = tipo === 'html' ? 'index.html' : tipo === 'css' ? 'style.css' : 'script.js';
    const rutaArchivo = path.join(CARPETA, nombreArchivo);
    let archivoCreado = false;
    if (r.success && r.response) {
      fs.writeFileSync(rutaArchivo, r.response.trim(), "utf8");
      archivoCreado = fs.existsSync(rutaArchivo);
    }
    res06[tipo] = {
      exito: r.success,
      error: r.error,
      duracionMs: r.durationMs,
      respuesta: r.response,
      chars: r.response?.length || 0,
      archivoCreado,
      archivoRuta: rutaArchivo,
    };
  }
  resultados["06_landing_page_html"] = {
    exito: Object.values(res06).every(r => r.exito),
    resultados: res06,
  };
  console.log(`    ${Object.values(res06).every(r => r.exito) ? "✓" : "✗"} 3 archivos`);

  // Guardar resultados de este modelo
  const archivoResultados = path.join(CARPETA, "resultados.json");
  fs.writeFileSync(archivoResultados, JSON.stringify(resultados, null, 2), "utf8");
  console.log(`\n  Resultados guardados en: ${archivoResultados}`);

  // Resumen general
  console.log("\n" + "=".repeat(70));
  console.log("RESUMEN GENERAL POR MODELO");
  console.log("=".repeat(70));
  console.log("| Modelo | P01 | P03 | P04 | P05 | P06 |");
  console.log("|--------|-----|-----|-----|-----|-----|");
  const p01 = resultados["01_response_time"]?.exito ? "✓" : "✗";
  const p03 = resultados["03_response_coherence"]?.exito ? "✓" : "✗";
  const p04 = resultados["04_long_context_compaction"]?.exito ? "✓" : "✗";
  const p05 = resultados["05_code_generation"]?.exito ? "✓" : "✗";
  const p06 = Object.values(resultados["06_landing_page_html"]?.resultados || {}).every(r => r.exito) ? "✓" : "✗";
  console.log(`| ${MODELO.model.padEnd(30)} | ${p01}   | ${p03}   | ${p04}   | ${p05}   | ${p06}   |`);
  console.log("\n" + "=".repeat(70));
  console.log("PRUEBAS COMPLETADAS");
  console.log("=".repeat(70));
}

main().catch(console.error);
