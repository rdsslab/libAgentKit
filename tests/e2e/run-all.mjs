import { askAgent } from "../../src/agent.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://192.168.100.126:11434";

// Modelos pequeños del servidor remoto (más rápidos)
const SMALL_MODEL = { model: "functiongemma:latest", baseUrl: BASE_URL };
const MEDIUM_MODEL = { model: "qwen2.5:1.5b-instruct", baseUrl: BASE_URL };
const LARGE_MODEL = { model: "nemotron-3-nano:4b", baseUrl: BASE_URL };

const OUTPUT_DIR = path.join(process.cwd(), "output");

async function askWithTimeout(provider, messages, options = {}, timeoutMs = 120000) {
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
	const durationMs = end - start;

	return {
		success: !error,
		error,
		durationMs,
		response: result?.text || "",
		usage: result?.usage || null,
		tokensPerSecond: result?.usage?.tokens_per_second || null,
		context: result?.usage?.context || null,
		rounds: result?.usage?.rounds || null,
	};
}

function cleanCodeBlock(text, language) {
	const regex = new RegExp(`\\\`\\\`\\\`${language}[\\s\\S]*?\\\`\\\`\\\``, 'g');
	const match = regex.exec(text);
	if (match) {
		return match[0].replace(new RegExp(`^\\\`\\\`\\\`${language}`), '').replace(/\\\`\\\`\\\`$/, '').trim();
	}
	return text.trim();
}

async function main() {
	console.log("================================================");
	console.log("E2E MASTER - Todas las Pruebas (Servidor Remoto)");
	console.log("================================================");
	console.log(`Servidor: ${BASE_URL}`);
	console.log(`Fecha: ${new Date().toISOString()}`);
	console.log("");

	// Crear directorio de salida
	if (!fs.existsSync(OUTPUT_DIR)) {
		fs.mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	const allResults = {};

	// ============================================
	// PRUEBA 01: Tiempos de Respuesta
	// ============================================
	console.log("\n" + "=".repeat(60));
	console.log("PRUEBA 01: Tiempos de Respuesta");
	console.log("=".repeat(60));

	const msg01 = "Explica en máximo 3 oraciones qué es React y para qué sirve.";
	const r1a = await askWithTimeout(SMALL_MODEL, [{ role: "user", content: msg01 }], {}, 120000);
	const r1b = await askWithTimeout(MEDIUM_MODEL, [{ role: "user", content: msg01 }], {}, 120000);

	console.log(`functiongemma:latest: ${r1a.durationMs.toFixed(0)}ms - ${r1a.success ? "OK" : "FALLO"}`);
	console.log(`qwen2.5:1.5b-instruct: ${r1b.durationMs.toFixed(0)}ms - ${r1b.success ? "OK" : "FALLO"}`);
	if (r1a.success) console.log(`   Respuesta: "${r1a.response.substring(0, 80)}..."`);
	if (r1b.success) console.log(`   Respuesta: "${r1b.response.substring(0, 80)}..."`);

	allResults["01-response-time"] = { r1a, r1b };

	// ============================================
	// PRUEBA 03: Coherencia en Conversación
	// ============================================
	console.log("\n" + "=".repeat(60));
	console.log("PRUEBA 03: Coherencia en Conversación Multi-Turno");
	console.log("=".repeat(60));

	const convMsgs = [];
	const convResults = [];
	const convTexts = [
		"Mi nombre es María y tengo una clínica veterinaria llamada Patitas Felices.",
		"Atendemos perros, gatos, aves y conejos. Ofrecemos consultas, cirugías y hospitalización.",
		"¿Puedes recordar cuál es mi nombre y el nombre de mi clínica?",
		"¿Qué servicios ofrecemos en la clínica?",
	];

	for (let i = 0; i < convTexts.length; i++) {
		const r = await askWithTimeout(SMALL_MODEL, [...convMsgs, { role: "user", content: convTexts[i] }], {}, 120000);
		convResults.push({ turn: i + 1, user: convTexts[i], response: r.response, success: r.success, durationMs: r.durationMs });
		convMsgs.push({ role: "user", content: convTexts[i] });
		if (r.response) convMsgs.push({ role: "assistant", content: r.response });
	}

	console.log(`Turno 1 - María presenta clínica: ${convResults[0].success ? "✓" : "✗"} ${convResults[0].durationMs.toFixed(0)}ms`);
	console.log(`Turno 2 - Servicios de la clínica: ${convResults[1].success ? "✓" : "✗"} ${convResults[1].durationMs.toFixed(0)}ms`);
	console.log(`Turno 3 - ¿Recuerda nombre y clínica?: ${convResults[2].success ? "✓" : "✗"} ${convResults[2].durationMs.toFixed(0)}ms`);
	console.log(`Turno 4 - ¿Recuerda servicios?: ${convResults[3].success ? "✓" : "✗"} ${convResults[3].durationMs.toFixed(0)}ms`);

	const t3 = convResults[2].response || "";
	const t4 = convResults[3].response || "";
	console.log(`¿Recuerda nombre (María)? ${/maría/i.test(t3) ? "✓ SÍ" : "✗ NO"}`);
	console.log(`¿Recuerda clínica (Patitas Felices)? ${/patitas felices/i.test(t3) ? "✓ SÍ" : "✗ NO"}`);
	console.log(`¿Recuerda servicios? ${/consulta|cirugía|hospitalización/i.test(t4) ? "✓ SÍ" : "✗ NO"}`);

	allResults["03-coherence"] = convResults;

	// ============================================
	// PRUEBA 04: Contexto Largo con Compactación (Umbral 25%)
	// ============================================
	console.log("\n" + "=".repeat(60));
	console.log("PRUEBA 04: Contexto Largo con Compactación (Umbral 25%)");
	console.log("=".repeat(60));

	const longMsgs = [
		"Mensaje 1: Información extensa sobre cuidado de mascotas. Los perros necesitan paseos diarios, alimentación balanceada y visitas regulares al veterinario.",
		"Mensaje 2: Los gatos necesitan arenero limpio, comida de calidad, y revisiones veterinarias anuales para detectar problemas temprano.",
		"Mensaje 3: Las aves requieren jaulas espaciosas, dieta variada de semillas y frutas, y socialización diaria con sus dueños.",
		"Mensaje 4: Los conejos necesitan heno ilimitado, verduras frescas, y espacio para saltar y hacer ejercicio.",
		"Mensaje 5: Las mascotas exóticas como iguanas y serpientes necesitan terrarios con control de temperatura y humedad específico.",
		"Mensaje 6: La vacunación canina incluye moquillo, parvovirus, hepatitis, leptospirosis y rabia según el calendario veterinario.",
		"Mensaje 7: La vacunación felina incluye panleucopenia, calicivirus, rinotraqueitis y rabia según la edad y estilo de vida del gato.",
		"Mensaje 8: La desparasitación interna se recomienda cada 3 meses para perros y gatos adultos que salen al exterior.",
		"Mensaje 9: La esterilización canina y felina previene camadas no deseadas y reduce el riesgo de ciertos cánceres reproductivos.",
		"Mensaje 10: La nutrición adecuada varía según la edad, raza, tamaño y nivel de actividad de cada mascota.",
	];

	const convMsgs2 = [];
	const ctxResults = [];

	for (let i = 0; i < longMsgs.length; i++) {
		const r = await askWithTimeout(SMALL_MODEL, [...convMsgs2, { role: "user", content: longMsgs[i] }], {}, 120000);
		ctxResults.push({ turn: i + 1, response: r.response, success: r.success, durationMs: r.durationMs, context: r.context });
		convMsgs2.push({ role: "user", content: longMsgs[i] });
		if (r.response) convMsgs2.push({ role: "assistant", content: r.response });

		const ctx = r.context;
		const pct = ctx?.used_percent != null ? ctx.used_percent.toFixed(1) : "N/A";
		console.log(`Turno ${i + 1}: ${r.success ? "✓" : "✗"} ${r.durationMs.toFixed(0)}ms - Contexto: ${ctx?.used_tokens ?? 0}/${ctx?.limit_tokens ?? 0} (${pct}%)`);
	}

	// Verificar memoria después de contexto largo
	const lastResp = ctxResults[ctxResults.length - 1].response || "";
	console.log("");
	console.log(`¿Recuerda nombre (María)? ${/maría/i.test(lastResp) ? "✓ SÍ" : "✗ NO"}`);
	console.log(`¿Recuerda clínica (Patitas Felices)? ${/patitas felices/i.test(lastResp) ? "✓ SÍ" : "✗ NO"}`);

	allResults["04-long-context"] = ctxResults;

	// ============================================
	// PRUEBA 06: Landing Page (3 archivos)
	// ============================================
	console.log("\n" + "=".repeat(60));
	console.log("PRUEBA 06: Landing Page HTML (3 Archivos Separados)");
	console.log("=".repeat(60));

	if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	const htmlPrompt = `Crea el HTML de una landing page para una clínica veterinaria llamada "Patitas Felices". HTML5 semántico completo. Enlaces a style.css y script.js. Secciones: header, hero con h1 y CTA, servicios (3 tarjetas), tabla de precios (3 planes), formulario contacto, footer. SOLO HTML, sin bloques markdown.`;
	const cssPrompt = `Crea el CSS para landing page de clínica veterinaria "Patitas Felices". Diseño moderno, responsive, paleta verde (#2e7d32) y naranja (#ff9800), animaciones de botones hover, tarjetas con sombra, tabla de precios con estilo, formulario estilizado. SOLO CSS, sin bloques markdown.`;
	const jsPrompt = `Crea el JavaScript para landing page de clínica veterinaria "Patitas Felices". Menú móvil toggle, validación de formulario, smooth scroll, botón CTA con confirmación. Vanilla JS, sin frameworks. SOLO JS, sin bloques markdown.`;

	const rHtml = await askWithTimeout(LARGE_MODEL, [{ role: "user", content: htmlPrompt }], {}, 180000);
	const rCss = await askWithTimeout(LARGE_MODEL, [{ role: "user", content: cssPrompt }], {}, 180000);
	const rJs = await askWithTimeout(LARGE_MODEL, [{ role: "user", content: jsPrompt }], {}, 180000);

	if (rHtml.success) fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), rHtml.response.trim(), "utf8");
	if (rCss.success) fs.writeFileSync(path.join(OUTPUT_DIR, "style.css"), rCss.response.trim(), "utf8");
	if (rJs.success) fs.writeFileSync(path.join(OUTPUT_DIR, "script.js"), rJs.response.trim(), "utf8");

	console.log(`HTML: ${rHtml.success ? "✓" : "✗"} ${rHtml.durationMs.toFixed(0)}ms - ${rHtml.response.length} chars`);
	console.log(`CSS: ${rCss.success ? "✓" : "✗"} ${rCss.durationMs.toFixed(0)}ms - ${rCss.response.length} chars`);
	console.log(`JS: ${rJs.success ? "✓" : "✗"} ${rJs.durationMs.toFixed(0)}ms - ${rJs.response.length} chars`);

	const htmlValid = /<!DOCTYPE\s+html/i.test(rHtml.response) && /<html[^>]*>/i.test(rHtml.response) && /<body[^>]*>/i.test(rHtml.response);
	const cssValid = /body\s*\{/i.test(rCss.response) && /button:hover/i.test(rCss.response);
	const jsValid = /addEventListener/i.test(rJs.response) && /form/i.test(rJs.response);
	console.log(`HTML válido: ${htmlValid ? "✓" : "✗"} | CSS válido: ${cssValid ? "✓" : "✗"} | JS válido: ${jsValid ? "✓" : "✗"}`);

	allResults["06-landing-page"] = { rHtml, rCss, rJs, htmlValid, cssValid, jsValid };

	// ============================================
	// RESUMEN FINAL
	// ============================================
	console.log("\n" + "=".repeat(60));
	console.log("RESUMEN FINAL DE TODAS LAS PRUEBAS");
	console.log("=".repeat(60));
	console.log("");
	console.log("| Prueba | Estado | Tiempo Total (ms) | Observaciones |");
	console.log("|--------|--------|-------------------|---------------|");
	console.log(`| 01-response-time | ${allResults["01-response-time"].r1a.success && allResults["01-response-time"].r1b.success ? "✓" : "✗"} | ${(allResults["01-response-time"].r1a.durationMs + allResults["01-response-time"].r1b.durationMs).toFixed(0)} | Dos modelos probados |`);
	console.log(`| 03-coherence | ${convResults.every((r) => r.success) ? "✓" : "✗"} | ${convResults.reduce((s, r) => s + r.durationMs, 0).toFixed(0)} | 4 turnos, coherencia verificada |`);
	console.log(`| 04-long-context | ${ctxResults.every((r) => r.success) ? "✓" : "✗"} | ${ctxResults.reduce((s, r) => s + r.durationMs, 0).toFixed(0)} | 10 turnos, contexto largo |`);
	console.log(`| 06-landing-page | ${rHtml.success && rCss.success && rJs.success ? "✓" : "✗"} | ${(rHtml.durationMs + rCss.durationMs + rJs.durationMs).toFixed(0)} | 3 archivos generados |`);

	console.log("");
	console.log("================================================");
	console.log("TODAS LAS PRUEBAS COMPLETADAS");
	console.log("================================================");
}

main().catch(console.error);
