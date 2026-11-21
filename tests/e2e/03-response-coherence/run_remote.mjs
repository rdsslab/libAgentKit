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
	console.log("=== PRUEBA 03: Coherencia en Conversación Multi-Turno ===\n");

	const texts = [
		"Mi nombre es María y tengo una clínica veterinaria llamada Patitas Felices.",
		"Ofrecemos consultas, cirugías, vacunación y hospitalización para perros y gatos.",
		"¿Recuerdas mi nombre y el nombre de mi clínica?",
		"¿Qué servicios ofrecemos?",
	];

	const conv = [];
	const results = [];

	for (let i = 0; i < texts.length; i++) {
		console.log(`Turno ${i+1}: ${texts[i]}`);
		const r = await ask([...conv, { role: "user", content: texts[i] }], 180000);
		conv.push({ role: "user", content: texts[i] });
		if (r.response) conv.push({ role: "assistant", content: r.response });
		results.push({ turn: i+1, user: texts[i], response: r.response, success: r.success, durationMs: r.durationMs });
		console.log(`  ${r.success ? "✓" : "✗"} ${r.durationMs.toFixed(0)}ms`);
		if (r.response) console.log(`   "${r.response.substring(0,100)}"`);
	}

	const t3 = results[2]?.response || "";
	const t4 = conv[conv.length-1]?.content || "";
	console.log("\n--- VERIFICACIÓN ---");
	console.log(`¿Recuerda nombre (María)? ${/maría/i.test(t3) ? "✓ SÍ" : "✗ NO"}`);
	console.log(`¿Recuerda clínica (Patitas Felices)? ${/patitas felices/i.test(t3) ? "✓ SÍ" : "✗ NO"}`);
	console.log(`¿Recuerda servicios? ${/consulta|cirugía|vacunación/i.test(t4) ? "✓ SÍ" : "✗ NO"}`);

	// Guardar resultados
	const resultado = {
		prueba: "03_response_coherence",
		modelo: MODEL.model,
		servidor: BASE_URL,
		fecha: new Date().toISOString(),
		resultados: results,
		verificacion: {
			recuerda_nombre: /maría/i.test(t3),
			recuerda_clinica: /patitas felices/i.test(t3),
			recuerda_servicios: /consulta|cirugía|vacunación/i.test(t4),
		}
	};

	if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
	fs.writeFileSync(path.join(REPORT_DIR, "prueba_03_coherence.json"), JSON.stringify(resultado, null, 2), "utf8");

	console.log("\nResultado guardado en tests/e2e/REPORTES/prueba_03_coherence.json");
}

main().catch(console.error);
