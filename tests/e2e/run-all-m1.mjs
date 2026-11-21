import { askAgent } from "../../src/agent.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://192.168.100.126:11434";

// Usar solo modelos pequeños y rápidos del servidor remoto
const MODEL_SMALL = { model: "functiongemma:latest", baseUrl: BASE_URL };
const MODEL_MEDIUM = { model: "qwen2.5:1.5b-instruct", baseUrl: BASE_URL };
const OUTPUT_DIR = path.join(process.cwd(), "output");

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
	console.log("E2E MASTER - Pruebas en Servidor Remoto (192.168.100.126)");
	console.log("=" .repeat(60));
	console.log(`Fecha: ${new Date().toISOString()}\n`);

	if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	// ============ PRUEBA 01: Tiempos de Respuesta ============
	console.log("\n--- PRUEBA 01: Tiempos de Respuesta ---");
	const m1 = await ask(MODEL_SMALL, [{ role: "user", content: "¿Qué es React?" }], {}, 180000);
	const m2 = await ask(MODEL_MEDIUM, [{ role: "user", content: "¿Qué es React?" }], {}, 180000);
	console.log(`functiongemma: ${m1.durationMs.toFixed(0)}ms - ${m1.success ? "OK" : "FALLO"}`);
	console.log(`qwen2.5:1.5b: ${m2.durationMs.toFixed(0)}ms - ${m2.success ? "OK" : "FALLO"}`);
	if (m1.success) console.log(`   "${m1.response.substring(0,100)}"`);
	if (m2.success) console.log(`   "${m2.response.substring(0,100)}"`);

	// ============ PRUEBA 03: Coherencia ============
	console.log("\n--- PRUEBA 03: Coherencia Multi-Turno ---");
	const conv = [];
	const texts = [
		"Mi nombre es María y tengo una clínica veterinaria Patitas Felices.",
		"Ofrecemos consultas, cirugías, vacunación y hospitalización para perros y gatos.",
		"¿Recuerdas mi nombre y el nombre de mi clínica?",
		"¿Qué servicios ofrecemos?",
	];
	for (let i = 0; i < texts.length; i++) {
		const r = await ask(MODEL_SMALL, [...conv, { role: "user", content: texts[i] }], {}, 180000);
		conv.push({ role: "user", content: texts[i] });
		if (r.response) conv.push({ role: "assistant", content: r.response });
		console.log(`Turno ${i+1}: ${r.success ? "✓" : "✗"} ${r.durationMs.toFixed(0)}ms`);
	}
	const t3 = conv[5]?.content || "";
	const t4 = conv[7]?.content || "";
	console.log(`¿Recuerda María? ${/maría/i.test(t3) ? "✓" : "✗"} | ¿Patitas Felices? ${/patitas felices/i.test(t3) ? "✓" : "✗"}`);
	console.log(`¿Recuerda servicios? ${/consulta|cirugía|vacunación/i.test(t4) ? "✓" : "✗"}`);

	// ============ PRUEBA 04: Contexto Largo (Umbral 25%) ============
	console.log("\n--- PRUEBA 04: Contexto Largo (Umbral 25%) ---");
	const longMsgs = [
		"Mensaje 1: Información sobre cuidado de perros. Necesitan paseos diarios, comida balanceada y visitas al veterinario.",
		"Mensaje 2: Los gatos necesitan arenero, comida de calidad y revisiones anuales.",
		"Mensaje 3: Las aves requieren jaulas espaciosas, dieta variada y socialización.",
		"Mensaje 4: Los conejos necesitan heno ilimitado, verduras y espacio para saltar.",
		"Mensaje 5: Las mascotas exóticas necesitan terrarios con temperatura y humedad controlada.",
	];
	const conv2 = [];
	for (let i = 0; i < longMsgs.length; i++) {
		const r = await ask(MODEL_SMALL, [...conv2, { role: "user", content: longMsgs[i] }], {}, 180000);
		conv2.push({ role: "user", content: longMsgs[i] });
		if (r.response) conv2.push({ role: "assistant", content: r.response });
		const ctx = r.context;
		const pct = ctx?.used_percent != null ? ctx.used_percent.toFixed(1) : "N/A";
		console.log(`Turno ${i+1}: ${r.success ? "✓" : "✗"} ${r.durationMs.toFixed(0)}ms - Contexto: ${ctx?.used_percent?.toFixed(1) || "N/A"}%`);
	}
	const lastResp = conv2[conv2.length - 1]?.content || "";
	console.log(`¿Recuerda María? ${/maría/i.test(lastResp) ? "✓" : "✗"}`);

	// ============ PRUEBA 06: Landing Page (3 archivos) ============
	console.log("\n--- PRUEBA 06: Landing Page (3 Archivos) ---");
	const htmlPrompt = `HTML5 para clínica veterinaria "Patitas Felices". Enlaces a style.css y script.js. Header, hero con h1 y CTA, servicios (3 tarjetas), tabla precios (3 planes), formulario contacto, footer. SOLO HTML.`;
	const cssPrompt = `CSS para landing page veterinaria "Patitas Felices". Diseño moderno, responsive, verde #2e7d32 y naranja #ff9800, animaciones botones hover, tarjetas con sombra, tabla precios, formulario estilizado. SOLO CSS.`;
	const jsPrompt = `JS para landing page veterinaria "Patitas Felices". Menú móvil toggle, validación formulario, smooth scroll, botón CTA confirmación. Vanilla JS. SOLO JS.`;

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

	console.log("\n" + "=".repeat(60));
	console.log("TODAS LAS PRUEBAS COMPLETADAS");
	console.log("=".repeat(60));
}

main().catch(console.error);
