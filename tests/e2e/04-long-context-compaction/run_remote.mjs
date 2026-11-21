import { askAgent } from "../../../src/agent.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://192.168.100.126:11434";
const MODEL = { model: "functiongemma:latest", baseUrl: BASE_URL };
const REPORT_DIR = path.join(process.cwd(), "..", "REPORTES");

async function ask(messages, timeoutMs = 180000) {
	const start = Date.now();
	let result = null;
	let error = null;
	try {
		result = await askAgent({
			provider: MODEL,
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
		});
	} catch (err) { error = err.message; }
	const end = Date.now();
	return { success: !error, error, durationMs: end - start,
		response: result?.text || "", usage: result?.usage || null,
		context: result?.usage?.context || null };
}

async function main() {
	console.log("=== PRUEBA 04: Contexto Largo con Compactación (Umbral 25%) ===\n");

	const longMsgs = [
		"Mensaje 1: Información extensa sobre cuidado de mascotas. Los perros necesitan paseos diarios, alimentación balanceada y visitas regulares al veterinario.",
		"Mensaje 2: Los gatos necesitan arenero limpio, comida de calidad, y revisiones veterinarias anuales para detectar problemas temprano.",
		"Mensaje 3: Las aves requieren jaulas espaciosas, dieta variada de semillas y frutas, y socialización diaria con sus dueños.",
		"Mensaje 4: Los conejos necesitan heno ilimitado, verduras frescas, y espacio para saltar y hacer ejercicio.",
		"Mensaje 5: Las mascotas exóticas como iguanas y serpientes necesitan terrarios con control de temperatura y humedad específico.",
	];

	const conv = [];
	const results = [];

	for (let i = 0; i < longMsgs.length; i++) {
		console.log(`Turno ${i+1}: ${longMsgs[i].substring(0,50)}...`);
		const r = await ask([...conv, { role: "user", content: longMsgs[i] }], 180000);
		conv.push({ role: "user", content: longMsgs[i] });
		if (r.response) conv.push({ role: "assistant", content: r.response });
		results.push({ turn: i+1, user: longMsgs[i], response: r.response, success: r.success, durationMs: r.durationMs, context: r.context });
		const ctx = r.context;
		const pct = ctx?.used_percent != null ? ctx.used_percent.toFixed(1) : "N/A";
		console.log(`  ${r.success ? "✓" : "✗"} ${r.durationMs.toFixed(0)}ms - Contexto: ${ctx?.used_tokens ?? 0}/${ctx?.limit_tokens ?? 0} (${pct}%)`);
	}

	// Verificar memoria después de contexto largo
	const lastResp = conv[conv.length-1]?.content || "";
	console.log("\n--- VERIFICACIÓN DE MEMORIA DESPUÉS DE CONTEXTO LARGO ---");
	console.log(`¿Recuerda nombre (María)? ${/maría/i.test(lastResp) ? "✓ SÍ" : "✗ NO"}`);
	console.log(`¿Recuerda clínica (Patitas Felices)? ${/patitas felices/i.test(lastResp) ? "✓ SÍ" : "✗ NO"}`);

	// Guardar resultados
	const resultado = {
		prueba: "04_long_context_compaction",
		modelo: MODEL.model,
		servidor: BASE_URL,
		fecha: new Date().toISOString(),
		configuracion: { umbral_compactacion: 25, keepLastMessages: 3 },
		resultados: results,
	};

	if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
	fs.writeFileSync(path.join(REPORT_DIR, "prueba_04_long_context.json"), JSON.stringify(resultado, null, 2), "utf8");

	console.log("\nResultado guardado en tests/e2e/REPORTES/prueba_04_long_context.json");
}

main().catch(console.error);
