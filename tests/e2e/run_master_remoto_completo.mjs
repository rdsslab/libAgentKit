import { askAgent } from "../../src/agent.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://192.168.100.126:11434";

// ============================================================================
// MODELOS A PROBAR
// ============================================================================
const MODELOS = [
  { model: "qwen2.5:1.5b-instruct", baseUrl: BASE_URL, nombre: "qwen2.5:1.5b-instruct", categoria: "pequeno" },
  { model: "qwen2.5-coder:3b", baseUrl: BASE_URL, nombre: "qwen2.5-coder:3b", categoria: "mediano" },
  // { model: "nemotron-3-nano:4b", baseUrl: BASE_URL, nombre: "nemotron-3-nano:4b", categoria: "grande" },
];

const RESULTADOS_DIR = path.join(process.cwd(), "resultados_por_modelo");

// ============================================================================
// FUNCIÓN AUXILIAR PARA HACER PETICIONES AL AGENTKIT CORE
// ============================================================================
async function ask(provider, messages, options = {}, timeoutMs = 300000) {
  const start = Date.now();
  let result = null;
  let error = null;
  try {
    result = await askAgent({
      provider,
      messages,
      mode: "build",
      capabilities: {
        terminal: false,
        web: false,
        mcp: false,
        documents: false,
        artifacts: false,
        filesystem: false,
      },
      autoCompact: true,
      compactionThresholdPercent: 25,
      compactionKeepLastMessages: 3,
      includeDiagnostics: true,
      ...options,
    });
  } catch (err) {
    error = err.message;
  }
  const end = Date.now();
  return {
    success: !error,
    error,
    durationMs: end - start,
    response: result?.text || "",
    usage: result?.usage || null,
    tokensPerSecond: result?.usage?.tokens_per_second || null,
    context: result?.usage?.context || null,
    rounds: result?.usage?.rounds || null,
  };
}

function cleanCodeBlock(text, language) {
  const regex = new RegExp(`\`\`\`${language}[\\s\\S]*?\`\`\``, 'g');
  const match = regex.exec(text);
  if (match) {
    return match[0].replace(new RegExp(`^\`\`\`${language}`), '').replace(/\`\`\`$/, '').trim();
  }
  return text.trim();
}

function escribirArchivo(ruta, contenido) {
  const dir = path.dirname(ruta);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ruta, contenido, "utf8");
}

// ============================================================================
// PRUEBA 01: TIEMPOS DE RESPUESTA
// ============================================================================
async function prueba01_tiempos_respuesta(modelo, carpetaModelo) {
  console.log(`  [01] Tiempos de respuesta...`);
  const mensaje = "Explica en máximo 3 oraciones qué es React y para qué sirve.";
  const r = await ask(modelo, [{ role: "user", content: mensaje }], {}, 300000);
  const resultado = {
    prueba: "01_response_time",
    modelo: modelo.model,
    exito: r.success,
    error: r.error,
    duracionMs: r.durationMs,
    respuesta: r.response,
    longitud: r.response.length,
    tokens: r.usage?.total_tokens || null,
    tokensPorSegundo: r.tokensPerSecond || null,
    contexto: r.context || null,
  };
  escribirArchivo(path.join(carpetaModelo, "01_response_time.json"), JSON.stringify(resultado, null, 2));
  console.log(`    ${r01.success ? "✓" : "✗"} ${r01.durationMs.toFixed(0)}ms`);
  return r01;
}

// ============================================================================
// PRUEBA 03: COHERENCIA EN CONVERSACIÓN MULTI-TURNO
// ============================================================================
async function prueba03_coherencia(modelo, carpetaModelo) {
  console.log(`  [03] Coherencia multi-turno...`);
  const textos = [
    "Mi nombre es María y tengo una clínica veterinaria llamada Patitas Felices.",
    "Atendemos perros, gatos, aves y conejos. Ofrecemos consultas, cirugías y hospitalización.",
    "¿Puedes recordar cuál es mi nombre y el nombre de mi clínica?",
    "¿Qué servicios ofrecemos en la clínica?",
  ];
  const conv = [];
  const resultados = [];
  for (let i = 0; i < textos.length; i++) {
    const r = await ask(modelo, [...conv, { role: "user", content: textos[i] }], {}, 300000);
    conv.push({ role: "user", content: textos[i] });
    if (r.response) conv.push({ role: "assistant", content: r.response });
    resultados.push({
      turno: i + 1,
      usuario: textos[i],
      respuesta: r.response,
      exito: r.success,
      duracionMs: r.durationMs,
      error: r.error,
    });
  }
  const t3 = res03[2]?.respuesta || "";
  const t4 = res03[3]?.respuesta || "";
  const resultado = {
    prueba: "03_response_coherence",
    modelo: modelo.model,
    resultados: res03,
    verificacion: {
      recuerdaNombre: /maría/i.test(t3),
      recuerdaClinica: /patitas felices/i.test(t3),
      recuerdaServicios: /consulta|cirugía|vacunación/i.test(t4),
    },
  };
  escribirArchivo(path.join(carpetaModelo, "03_response_coherence.json"), JSON.stringify(resultado, null, 2));
  console.log(`    ${res03.every(r => r.exito) ? "✓" : "✗"} ${res03.length} turnos`);
  return res03;
}

// ============================================================================
// PRUEBA 04: CONTEXTO LARGO CON COMPACTACIÓN (UMBRAL 25%)
// ============================================================================
async function prueba04_contexto_largo(modelo, carpetaModelo) {
  console.log(`  [04] Contexto largo (25% umbral)...`);
  const mensajes = [
    "Mensaje 1: Información extensa sobre cuidado de mascotas. Los perros necesitan paseos diarios, alimentación balanceada y visitas regulares al veterinario.",
    "Mensaje 2: Los gatos necesitan arenero limpio, comida de calidad, y revisiones veterinarias anuales para detectar problemas temprano.",
    "Mensaje 3: Las aves requieren jaulas espaciosas, dieta variada de semillas y frutas, y socialización diaria con sus dueños.",
    "Mensaje 4: Los conejos necesitan heno ilimitado, verduras frescas, y espacio para saltar y hacer ejercicio.",
    "Mensaje 5: Las mascotas exóticas como iguanas y serpientes necesitan terrarios con control de temperatura y humedad específico.",
  ];
  const conv = [];
  const resultados = [];
  for (let i = 0; i < mensajes.length; i++) {
    const r = await ask(modelo, [...conv, { role: "user", content: mensajes[i] }], {}, 300000);
    conv.push({ role: "user", content: mensajes[i] });
    if (r.response) conv.push({ role: "assistant", content: r.response });
    resultados.push({
      turno: i + 1,
      mensaje: mensajes[i],
      respuesta: r.response,
      exito: r.success,
      duracionMs: r.durationMs,
      contexto: r.context,
      error: r.error,
    });
  }
  const ultimoResp = conv[conv.length - 1]?.content || "";
  const resultado = {
    prueba: "04_long_context_compaction",
    modelo: modelo.model,
    umbralCompactacion: 25,
    resultados: res04,
    verificacion: {
      recuerdaNombre: /maría/i.test(ultimoResp),
      recuerdaClinica: /patitas felices/i.test(ultimoResp),
    },
  };
  escribirArchivo(path.join(carpetaModelo, "04_long_context_compaction.json"), JSON.stringify(resultado, null, 2));
  console.log(`    ${res04.every(r => r.exito) ? "✓" : "✗"} ${res04.length} turnos`);
  return res04;
}

// ============================================================================
// PRUEBA 05: GENERACIÓN DE CÓDIGO
// ============================================================================
async function prueba05_codigo(modelo, carpetaModelo) {
  console.log(`  [05] Generación de código...`);
  const tareas = [
    {
      nombre: "javascript_funcion_utilitaria",
      prompt: "Escribe una función en JavaScript que valide si un correo electrónico es válido usando expresión regular. Incluye comentarios explicativos y un ejemplo de uso.",
      lenguaje: "javascript",
    },
    {
      nombre: "python_lectura_archivo",
      prompt: "Escribe un script en Python que lea un archivo de texto línea por línea e imprima solo las líneas que contengan la palabra 'error'. Incluye manejo de excepciones.",
      lenguaje: "python",
    },
    {
      nombre: "html_boton_estilo",
      prompt: "Crea un componente HTML con CSS integrado que muestre un botón azul que al hacer clic cambie de color a verde. Incluye JavaScript para el evento click.",
      lenguaje: "html",
    },
  ];
  const res05 = [];
  for (const tarea of tareas) {
    console.log(`    ${tarea.nombre}...`);
    const r = await ask(modelo, [{ role: "user", content: tarea.prompt }], {}, 600000);
    const bloques = r.response.match(/```[\s\S]*?```/g) || [];
    const bloquesCodigo = bloques.map(b => {
      const langMatch = b.match(/^```(\w+)/);
      return langMatch ? langMatch[1] : 'texto';
    });
    const ext = tarea.lenguaje === 'javascript' ? 'js' : tarea.lenguaje === 'html' ? 'html' : 'py';
    const nombreArchivo = `codigo_${tarea.nombre}.${ext}`;
    const rutaArchivo = path.join(carpetaModelo, nombreArchivo);
    let archivoGuardado = false;
    if (r.success && r.response) {
      fs.writeFileSync(rutaArchivo, r.response.trim(), "utf8");
      archivoGuardado = fs.existsSync(rutaArchivo);
    }
    res05.push({
      tarea: tarea.nombre,
      lenguaje: tarea.lenguaje,
      exito: r.success,
      error: r.error,
      duracionMs: r.durationMs,
      respuesta: r.response,
      bloquesCodigo,
      archivoGuardado,
      archivoRuta: rutaArchivo,
      tokens: r.usage?.total_tokens || null,
      tokensPorSegundo: r.tokensPerSecond || null,
    });
  }
  return { prueba: "05_code_generation", modelo: modelo.model, resultados: res05 };
}

// ============================================================================
// PRUEBA 06: LANDING PAGE HTML (3 ARCHIVOS SEPARADOS)
// ============================================================================
async function prueba06_landing_page(modelo, carpetaModelo) {
  console.log(`  [06] Landing page HTML (3 archivos separados)...`);
  const promptsLP = {
    html: `Crea el HTML de una landing page para una clínica veterinaria llamada "Patitas Felices". HTML5 semántico completo. Enlaces a style.css y script.js. Secciones: header con navegación, hero con h1 y CTA, servicios (3 tarjetas con iconos y descripciones), tabla de precios (3 planes: Básico, Premium, VIP), formulario de contacto (nombre, email, teléfono, mensaje, botón enviar), footer con derechos reservados y redes sociales. SOLO HTML, sin bloques de código markdown, sin CSS, sin JavaScript.`,
    css: `Crea el CSS para landing page de clínica veterinaria "Patitas Felices". Diseño moderno, responsive (mobile-first), paleta verde veterinario (#2e7d32) y naranja (#ff9800), animaciones de botones hover con transform y transición suave, tarjetas de servicios con sombra y hover, tabla de precios con filas zebra y hover, formulario con inputs stylizados y focus states, header fijo. SOLO CSS, sin bloques de código markdown.`,
    js: `Crea el JavaScript para landing page de clínica veterinaria "Patitas Felices". Menú móvil toggle (hamburguesa), formulario de contacto con validación básica (campos requeridos, formato email), mensaje de confirmación al enviar, smooth scroll para anclas de navegación, botón CTA con alert de confirmación. Vanilla JavaScript sin frameworks. SOLO JS, sin bloques de código markdown.`,
  };
  const res06 = {};
  for (const [tipo, prompt] of Object.entries(promptsLP)) {
    console.log(`    ${tipo}...`);
    const r = await ask(modelo, [{ role: "user", content: prompt }], {}, 600000);
    const nombreArchivo = tipo === 'html' ? 'index.html' : tipo === 'css' ? 'style.css' : 'script.js';
    const rutaArchivo = path.join(carpetaModelo, nombreArchivo);
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
  return { prueba: "06_landing_page_html", modelo: modelo.model, resultados: res06 };
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================
async function main() {
  console.log("=".repeat(70));
  console.log("E2E MASTER - Todas las Pruebas (Servidor Remoto 192.168.100.126)");
  console.log("=".repeat(70));
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log(`Servidor: ${BASE_URL}`);
  console.log(`Modelos: ${MODELOS.map(m => m.model).join(", ")}\n`);

  const resultadosGenerales = {};

  for (const modelo of MODELOS) {
    console.log("\n" + "=".repeat(70));
    console.log(`PROBANDO MODELO: ${modelo.model}`);
    console.log("=".repeat(70));

    const carpetaModelo = path.join(RESULTADOS_DIR, modelo.model.replace(/\//g, "_"));
    if (!fs.existsSync(carpetaModelo)) {
      fs.mkdirSync(carpetaModelo, { recursive: true });
    }

    const resultadosModelo = {};

    // Prueba 01: Tiempos de respuesta
    try {
      const r01 = await prueba01_tiempos_respuesta(modelo, carpetaModelo);
      resultadosModelo["01_response_time"] = r01;
    } catch (e) {
      resultadosModelo["01_response_time"] = { exito: false, error: e.message };
      console.log(`    ✗ Error: ${e.message}`);
    }

    // Prueba 03: Coherencia
    try {
      const r03 = await prueba03_coherencia(modelo, carpetaModelo);
      resultadosModelo["03_response_coherence"] = r03;
    } catch (e) {
      resultadosModelo["03_response_coherence"] = { exito: false, error: e.message };
      console.log(`    ✗ Error: ${e.message}`);
    }

    // Prueba 04: Contexto largo
    try {
      const r04 = await prueba04_contexto_largo(modelo, carpetaModelo);
      resultadosModelo["04_long_context_compaction"] = r04;
    } catch (e) {
      resultadosModelo["04_long_context_compaction"] = { exito: false, error: e.message };
      console.log(`    ✗ Error: ${e.message}`);
    }

    // Prueba 05: Generación de código
    try {
      const r05 = await prueba05_codigo(modelo, carpetaModelo);
      resultadosModelo["05_code_generation"] = r05;
    } catch (e) {
      resultadosModelo["05_code_generation"] = { exito: false, error: e.message };
      console.log(`    ✗ Error: ${e.message}`);
    }

    // Prueba 06: Landing page
    try {
      const r06 = await prueba06_landing_page(modelo, carpetaModelo);
      resultadosModelo["06_landing_page_html"] = r06;
    } catch (e) {
      resultadosModelo["06_landing_page_html"] = { exito: false, error: e.message };
      console.log(`    ✗ Error: ${e.message}`);
    }

    // Guardar resultados de este modelo
    const archivoResultados = path.join(carpetaModelo, "resultados.json");
    fs.writeFileSync(archivoResultados, JSON.stringify(resultadosModelo, null, 2), "utf8");
    resultadosGenerales[modelo.model] = resultadosModelo;
    console.log(`\n  Resultados guardados en: ${archivoResultados}`);
  }

  // Resumen general
  console.log("\n" + "=".repeat(70));
  console.log("RESUMEN GENERAL POR MODELO");
  console.log("=".repeat(70));
  console.log("| Modelo | P01 | P03 | P04 | P05 | P06 |");
  console.log("|--------|-----|-----|-----|-----|-----|");
  for (const [modelo, resultados] of Object.entries(resultadosGenerales)) {
    const p01 = resultados["01_response_time"]?.exito ? "✓" : "✗";
    const p03 = resultados["03_response_coherence"]?.resultados?.every(r => r.exito) ? "✓" : "✗";
    const p04 = resultados["04_long_context_compaction"]?.resultados?.every(r => r.exito) ? "✓" : "✗";
    const p05 = resultados["05_code_generation"]?.resultados?.every(r => r.exito) ? "✓" : "✗";
    const p06 = Object.values(resultados["06_landing_page_html"]?.resultados || {}).every(r => r.exito) ? "✓" : "✗";
    console.log(`| ${modelo.padEnd(30)} | ${p05.padEnd(3)} | ${p03.padEnd(3)} | ${p04.padEnd(3)} | ${p05.padEnd(3)} | ${p06.padEnd(3)} |`);
  }

  const archivoResumen = path.join(RESULTADOS_DIR, "resumen_general.json");
  fs.writeFileSync(archivoResumen, JSON.stringify(resultadosGenerales, null, 2), "utf8");
  console.log(`\nResumen general guardado en: ${archivoResumen}`);
}

main().catch(console.error);
