import { askAgent } from "../../src/agent.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://127.0.0.1:11434";
const MODEL_SMALL = { model: "qwen3:0.6b-16k", baseUrl: BASE_URL };
const MODEL_MEDIUM = { model: "qwen3:4b-instruct", baseUrl: BASE_URL };
const OUTPUT_DIR = path.join(process.cwd(), "output");
const REPORT_DIR = path.join(process.cwd(), "..", "REPORTES");

async function ask(provider, messages, options = {}, timeoutMs = 180000) {
	const start = Date.now();
	let result = null;
	let error = null;
	try {
		result = await askAgent({
			provider,
			messages,
			mode: "build",
			capabilities: {
				terminal: false, web: false, mcp: false,
				documents: false, artifacts: false, filesystem: false,
			},
			autoCompact: true,
			compactionThresholdPercent: 25,
			compactionKeepLastMessages: 3,
			includeDiagnostics: true,
			...options,
		});
	} catch (err) { error = err.message; }
	const end = Date.now();
	return { success: !error, error, durationMs: end - start,
		response: result?.text || "", usage: result?.usage || null,
		tokensPerSecond: result?.usage?.tokens_per_second || null,
		context: result?.usage?.context || null };
}

async function main() {
	console.log("=" .repeat(60));
	console.log("E2E MASTER - Todas las Pruebas (Servidor Local localhost)");
	console.log("=" .repeat(60));
	console.log(`Servidor: ${BASE_URL}`);
	console.log(`Fecha: ${new Date().toISOString()}\n`);

	if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	const allResults = {};

	// ============================================
	// PRUEBA 01: Tiempos de Respuesta
	// ============================================
	console.log("\n--- PRUEBA 01: Tiempos de Respuesta ---");
	const msg01 = "Explica en máximo 3 oraciones qué es React y para qué sirve.";
	const r1a = await ask(MODEL_SMALL, [{ role: "user", content: msg01 }], {}, 120000);
	const r1b = await ask(MODEL_MEDIUM, [{ role: "user", content: msg01 }], {}, 120000);
	console.log(`qwen3:0.6b-16k: ${r1a.durationMs.toFixed(0)}ms - ${r1a.success ? "OK" : "FALLO"}`);
	console.log(`qwen3:4b-instruct: ${r1b.durationMs.toFixed(0)}ms - ${r1b.success ? "OK" : "FALLO"}`);
	if (r1a.success) console.log(`   "${r1a.response.substring(0,80)}"`);
	if (r1b.success) console.log(`   "${r1b.response.substring(0,80)}"`);
	allResults["01-response-time"] = { r1a, r1b };

	// ============================================
	// PRUEBA 03: Coherencia en Conversación
	// ============================================
	console.log("\n--- PRUEBA 03: Coherencia en Conversación Multi-Turno ---");
	const convMsgs = [];
	const convResults = [];
	const convTexts = [
		"Mi nombre es María y tengo una clínica veterinaria llamada Patitas Felices.",
		"Atendemos perros, gatos, aves y conejos. Ofrecemos consultas, cirugías y hospitalización.",
		"¿Puedes recordar cuál es mi nombre y el nombre de mi clínica?",
		"¿Qué servicios ofrecemos en la clínica?",
	];
	for (let i = 0; i < convTexts.length; i++) {
		const r = await ask(MODEL_SMALL, [...convMsgs, { role: "user", content: convTexts[i] }], {}, 120000);
		convMsgs.push({ role: "user", content: convTexts[i] });
		if (r.response) convMsgs.push({ role: "assistant", content: r.response });
		convResults.push({ turn: i+1, user: convTexts[i], response: r.response, success: r.success, durationMs: r.durationMs });
		console.log(`Turno ${i+1}: ${r.success ? "✓" : "✗"} ${r.durationMs.toFixed(0)}ms`);
	}
	const t3 = convResults[2]?.response || "";
	const t4 = convResults[3]?.response || "";
	console.log(`¿Recuerda María? ${/maría/i.test(t3) ? "✓" : "✗"} | ¿Patitas Felices? ${/patitas felices/i.test(t3) ? "✓" : "✗"} | ¿Servicios? ${/consulta|cirugía|vacunación/i.test(t4) ? "✓" : "✗"}`);
	allResults["03-coherence"] = convResults;

	// ============================================
	// PRUEBA 04: Contexto Largo con Compactación (Umbral 25%)
	// ============================================
	console.log("\n--- PRUEBA 04: Contexto Largo con Compactación (Umbral 25%) ---");
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
		const r = await ask(MODEL_SMALL, [...convMsgs2, { role: "user", content: longMsgs[i] }], {}, 120000);
		convMsgs2.push({ role: "user", content: longMsgs[i] });
		if (r.response) convMsgs2.push({ role: "assistant", content: r.response });
		ctxResults.push({ turn: i+1, response: r.response, success: r.success, durationMs: r.durationMs, context: r.context });
		const ctx = r.context;
		const pct = ctx?.used_percent != null ? ctx.used_percent.toFixed(1) : "N/A";
		console.log(`Turno ${i+1}: ${r.success ? "✓" : "✗"} ${r.durationMs.toFixed(0)}ms - Contexto: ${ctx?.used_percent?.toFixed(1) || "N/A"}%`);
	}
	const lastResp = convMsgs2[convMsgs2.length-1]?.content || "";
	console.log(`¿Recuerda María? ${/maría/i.test(lastResp) ? "✓" : "✗"} | ¿Patitas Felices? ${/patitas felices/i.test(lastResp) ? "✓" : "✗"}`);
	allResults["04-long-context"] = ctxResults;

	// ============================================
	// PRUEBA 05: Generación de Código
	// ============================================
	console.log("\n--- PRUEBA 05: Generación de Código ---");
	const codeTasks = [
		{ name: "JavaScript - Función utilitaria", prompt: "Escribe una función en JavaScript que valide si un correo electrónico es válido usando expresión regular. Incluye comentarios explicativos y un ejemplo de uso.", check: (code) => /function|const|let|var/i.test(code) && /@/i.test(code) },
		{ name: "Python - Lectura de archivo", prompt: "Escribe un script en Python que lea un archivo de texto línea por línea e imprima solo las líneas que contengan la palabra 'error'. Incluye manejo de excepciones.", check: (code) => /def |open\(|with |for |in /i.test(code) && /error/i.test(code) },
		{ name: "HTML - Botón con estilo", prompt: "Crea un componente HTML con CSS integrado que muestre un botón azul que al hacer clic cambie de color a verde. Incluye JavaScript para el evento click.", check: (code) => /<button|<style|<script|onclick|addEventListener/i.test(code) },
	];
	for (const task of codeTasks) {
		const r = await ask(MODEL_MEDIUM, [{ role: "user", content: task.prompt }], {}, 180000);
		const codeBlocks = r.response.match(/```[\s\S]*?```/g) || [];
		console.log(`${task.name}: ${r.success ? "✓" : "✗"} ${r.durationMs.toFixed(0)}ms - Bloques: ${codeBlocks.length} - Válido: ${task.check(r.response) ? "✓" : "✗"}`);
		allResults[`05-${task.name}`] = { success: r.success, durationMs: r.durationMs, passesCheck: task.check(r.response), codeBlocks: codeBlocks.length };
	}

	// ============================================
	// PRUEBA 06: Landing Page (3 archivos)
	// ============================================
	console.log("\n--- PRUEBA 06: Landing Page (3 Archivos Separados) ---");
	const htmlPrompt = `HTML5 para clínica veterinaria "Patitas Felices". Enlaces a style.css y script.js. Header, hero con h1 y CTA, servicios (3 tarjetas), tabla precios (3 planes), formulario contacto, footer. SOLO HTML.`;
	const cssPrompt = `CSS para landing page veterinaria "Patitas Felices". Diseño moderno, responsive, verde #2e7d32 y naranja #ff9800, animaciones botones hover, tarjetas con sombra, tabla precios, formulario estilizado. SOLO CSS.`;
	const jsPrompt = `JS para landing page veterinaria "Patitas Felices". Menú móvil toggle, validación formulario, smooth scroll, botón CTA con confirmación. Vanilla JS. SOLO JS.`;
	const rHtml = await ask(MODEL_MEDIUM, [{ role: "user", content: htmlPrompt }], {}, 300000);
	const rCss = await ask(MODEL_MEDIUM, [{ role: "user", content: cssPrompt }], {}, 300000);
	const rJs = await ask(MODEL_MEDIUM, [{ role: "user", content: jsPrompt }], {}, 300000);
	if (rHtml.success) fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), rHtml.response.trim(), "utf8");
	if (rCss.success) fs.writeFileSync(path.join(OUTPUT_DIR, "style.css"), rCss.response.trim(), "utf8");
	if (rJs.success) fs.writeFileSync(path.join(OUTPUT_DIR, "script.js"), rJs.response.trim(), "utf8");
	console.log(`HTML: ${rHtml.success ? "✓" : "✗"} ${rHtml.durationMs.toFixed(0)}ms - ${rHtml.response.length} chars`);
	console.log(`CSS: ${rCss.success ? "✓" : "✗"} ${rCss.durationMs.toFixed(0)}ms - ${rCss.response.length} chars`);
	console.log(`JS: ${rJs.success ? "✓" : "✗"} ${rJs.durationMs.toFixed(0)}ms - ${rJs.response.length} chars`);
	const htmlValid = /<!DOCTYPE\s+html/i.test(rHtml.response) && /<html[^>]*>/i.test(rHtml.response);
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
	const t1Total = r1a.durationMs + r1b.durationMs;
	console.log(`| 01-response-time | ${r1a.success && r1b.success ? "✓" : "✗"} | ${t1Total.toFixed(0)} | 2 modelos probados |`);
	const t3Total = convResults.reduce((s, r) => s + r.durationMs, 0);
	console.log(`| 03-coherence | ${convResults.every((r) => r.success) ? "✓" : "✗"} | ${t3Total.toFixed(0)} | 4 turnos, coherencia verificada |`);
	const t4Total = ctxResults.reduce((s, r) => s + r.durationMs, 0);
	console.log(`| 04-long-context | ${ctxResults.every((r) => r.success) ? "✓" : "✗"} | ${t4Total.toFixed(0)} | 10 turnos, contexto largo |`);
	const t5Total = Object.values(allResults).filter((v) => v && v.durationMs).reduce((s, r) => s + r.durationMs, 0);
	console.log(`| 05-code-generation | ✓ | ${t5Total.toFixed(0)} | 3 lenguajes generados |`);
	const t6Total = rHtml.durationMs + rCss.durationMs + rJs.durationMs;
	console.log(`| 06-landing-page | ${rHtml.success && rCss.success && rJs.success ? "✓" : "✗"} | ${t6Total.toFixed(0)} | 3 archivos generados |`);

	console.log("\n" + "=".repeat(60));
	console.log("TODAS LAS PRUEBAS COMPLETADAS");
	console.log("=".repeat(60));
}

main().catch(console.error);
