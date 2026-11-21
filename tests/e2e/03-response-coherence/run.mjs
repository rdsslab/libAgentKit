import { askAgent } from "../../../src/agent.js";

const MODEL = { model: "qwen3:0.6b-16k", baseUrl: "http://127.0.0.1:11434" };

const CONVERSATION = [
	{ role: "user", content: "Mi nombre es Carlos y me gusta programar en JavaScript." },
	{ role: "user", content: "Tengo 28 años y vivo en Quito, Ecuador." },
	{ role: "user", content: "¿Puedes recordar cuál es mi nombre y dónde vivo?" },
	{ role: "user", content: "¿Qué lenguaje de programación mencioné que me gusta?" },
];

async function runConversation() {
	const messages = [];
	const results = [];
	let totalTime = 0;

	console.log("================================================");
	console.log("E2E-03: Coherencia en las Respuestas");
	console.log("================================================");
	console.log(`Modelo: ${MODEL.name} @ ${MODEL.baseUrl}`);
	console.log("");

	for (let i = 0; i < CONVERSATION.length; i++) {
		const msg = CONVERSATION[i];
		const start = Date.now();
		let result = null;
		let error = null;

		try {
			result = await askAgent({
				provider: MODEL,
				messages: [...messages, msg],
				mode: "build",
				capabilities: {
					terminal: false,
					web: false,
					mcp: false,
					documents: false,
					artifacts: false,
					filesystem: false,
				},
				includeDiagnostics: true,
			});
		} catch (err) {
			error = err.message;
		}

		const end = Date.now();
		const durationMs = end - start;
		totalTime += durationMs;

		const turnResult = {
			turn: i + 1,
			userMessage: msg.content,
			success: !error,
			error,
			response: result?.text || "",
			durationMs,
			usage: result?.usage || null,
		};
		results.push(turnResult);

		// Agregar al historial para el siguiente turno
		messages.push(msg);
		if (result?.text) {
			messages.push({ role: "assistant", content: result.text });
		}

		console.log(`Turno ${i + 1}: ${msg.content}`);
		console.log(`   ${error ? "✗ Error: " + error : "✓ " + durationMs.toFixed(0) + "ms"}`);
		if (result?.text) {
			console.log(`   Respuesta: "${result.text.substring(0, 120)}..."`);
		}
		console.log("");
	}

	// Verificar coherencia
	console.log("================================================");
	console.log("VERIFICACIÓN DE COHERENCIA");
	console.log("================================================");
	console.log("");

	const turn3 = results[2]; // "¿Puedes recordar cuál es mi nombre y dónde vivo?"
	const turn4 = results[3]; // "¿Qué lenguaje de programación mencioné que me gusta?"

	const remembersName = turn3.success && /carlos/i.test(turn3.response);
	const remembersCity = turn3.success && /quito/i.test(turn3.response);
	const remembersLanguage = turn4.success && /javascript/i.test(turn4.response);

	console.log(`Turno 3 - ¿Recuerda nombre (Carlos)? ${remembersName ? "✓ SÍ" : "✗ NO"}`);
	console.log(`Turno 3 - ¿Recuerda ciudad (Quito)? ${remembersCity ? "✓ SÍ" : "✗ NO"}`);
	console.log(`Turno 4 - ¿Recuerda lenguaje (JavaScript)? ${remembersLanguage ? "✓ SÍ" : "✗ NO"}`);
	console.log("");

	const allCoherent = remembersName && remembersCity && remembersLanguage;
	console.log(`Resultado general: ${allCoherent ? "✓ CONVERSACIÓN COHERENTE" : "✗ FALTAN DETALLES"}`);
	console.log("");

	// Estadísticas
	console.log("================================================");
	console.log("ESTADÍSTICAS");
	console.log("================================================");
	console.log("");
	console.log(`Turnos totales: ${results.length}`);
	console.log(`Tiempo total: ${totalTime.toFixed(0)}ms`);
	console.log(`Tiempo promedio por turno: ${(totalTime / results.length).toFixed(0)}ms`);
	console.log(`Éxito: ${results.filter((r) => r.success).length}/${results.length}`);

	console.log("");
	console.log("================================================");
	console.log("FIN DE PRUEBAS E2E-03");
	console.log("================================================");
}

runConversation().catch(console.error);
