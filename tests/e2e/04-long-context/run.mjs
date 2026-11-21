import { askAgent } from "../../../src/agent.js";

const MODEL = { model: "qwen3:0.6b-16k", baseUrl: "http://127.0.0.1:11434" };

const TURNS = 10;

async function runLongContext() {
	const messages = [];
	const results = [];

	console.log("================================================");
	console.log("E2E-04: Manejo de Contextos Largos");
	console.log("================================================");
	console.log(`Modelo: ${MODEL.name} @ ${MODEL.baseUrl}`);
	console.log(`Turnos: ${TURNS}`);
	console.log("");

	for (let i = 0; i < TURNS; i++) {
		const userMessage = `Este es el mensaje número ${i + 1}. Recuerda que mi color favorito es el azul y mi número favorito es el 42.`;
		const start = Date.now();
		let result = null;
		let error = null;

		try {
			result = await askAgent({
				provider: MODEL,
				messages: [...messages, { role: "user", content: userMessage }],
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
				compactionThresholdPercent: 90,
				compactionKeepLastMessages: 4,
				includeDiagnostics: true,
			});
		} catch (err) {
			error = err.message;
		}

		const end = Date.now();
		const durationMs = end - start;

		const turnResult = {
			turn: i + 1,
			success: !error,
			error,
			response: result?.text || "",
			durationMs,
			usage: result?.usage || null,
			context: result?.usage?.context || null,
		};
		results.push(turnResult);

		// Agregar al historial
		messages.push({ role: "user", content: userMessage });
		if (result?.text) {
			messages.push({ role: "assistant", content: result.text });
		}

		const ctx = result?.usage?.context;
		const usedPct = ctx?.used_percent != null ? ctx.used_percent.toFixed(1) : "N/A";
		console.log(`Turno ${i + 1}: ${error ? "✗ " + error : "✓ " + durationMs.toFixed(0) + "ms"}`);
		if (ctx) {
			console.log(`   Contexto: ${ctx.used_tokens ?? 0}/${ctx.limit_tokens ?? 0} (${usedPct}%)`);
		}
		if (result?.usage?.rounds) {
			console.log(`   Rondas de tools: ${result.usage.rounds}`);
		}
		console.log("");
	}

	// Verificar que el contexto no crezca descontroladamente (gracias a compactación)
	console.log("================================================");
	console.log("ANÁLISIS DE CONTEXTO");
	console.log("================================================");
	console.log("");

	const contexts = results.filter((r) => r.context && r.context.used_percent != null).map((r) => r.context);
	if (contexts.length > 0) {
		const firstCtx = contexts[0];
		const lastCtx = contexts[contexts.length - 1];
		const maxCtx = contexts.reduce((max, c) => (c.used_percent > max.used_percent ? c : max), contexts[0]);

		console.log(`Contexto inicial: ${firstCtx.used_percent.toFixed(1)}%`);
		console.log(`Contexto final: ${lastCtx.used_percent.toFixed(1)}%`);
		console.log(`Contexto máximo: ${maxCtx.used_percent.toFixed(1)}%`);
		console.log(`¿Se mantuvo estable? ${maxCtx.used_percent < 90 ? "✓ SÍ" : "⚠ Se acercó al umbral"}`);
	} else {
		console.log("No se pudo obtener información de contexto (us_percent null)");
	}

	// Verificar que el modelo recuerde el color favorito al final
	const lastResponse = results[results.length - 1].response;
	const remembersColor = /azul/i.test(lastResponse);
	const remembersNumber = /42/i.test(lastResponse);
	console.log("");
	console.log(`¿Recuerda color favorito (azul)? ${remembersColor ? "✓ SÍ" : "✗ NO"}`);
	console.log(`¿Recuerda número favorito (42)? ${remembersNumber ? "✓ SÍ" : "✗ NO"}`);

	console.log("");
	console.log("================================================");
	console.log("FIN DE PRUEBAS E2E-04");
	console.log("================================================");
}

runLongContext().catch(console.error);
