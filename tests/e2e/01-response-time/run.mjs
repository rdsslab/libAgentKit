import { askAgent } from "../../../src/agent.js";

const BASE_URL = "http://192.168.100.126:11434";

// Modelos pequeños y rápidos del servidor remoto
const MODELS = [
	{ model: "functiongemma:latest", baseUrl: BASE_URL },
	{ model: "qwen2.5:1.5b-instruct", baseUrl: BASE_URL },
];

const MESSAGE = "Explica en máximo 3 oraciones qué es React y para qué sirve.";

async function runTest(modelConfig) {
	const start = Date.now();
	let result = null;
	let error = null;

	try {
		result = await askAgent({
			provider: modelConfig,
			messages: [{ role: "user", content: MESSAGE }],
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

	return {
		model: modelConfig.model,
		baseUrl: modelConfig.baseUrl,
		success: !error,
		error,
		durationMs,
		response: result?.text || "",
		responseLength: result?.text?.length || 0,
		usage: result?.usage || null,
		tokensPerSecond: result?.usage?.tokens_per_second || null,
		context: result?.usage?.context || null,
		rounds: result?.usage?.rounds || null,
	};
}

async function main() {
	console.log("================================================");
	console.log("E2E-01: Tiempos de Respuesta - Core AgentKit (Servidor Remoto)");
	console.log("================================================");
	console.log(`Servidor: ${BASE_URL}`);
	console.log(`Mensaje: "${MESSAGE}"`);
	console.log("");

	const results = [];

	for (const modelConfig of MODELS) {
		process.stdout.write(`Probando ${modelConfig.model}... `);
		const result = await runTest(modelConfig);
		results.push(result);

		if (result.success) {
			console.log(`✓ Éxito en ${result.durationMs.toFixed(0)}ms`);
			console.log(`   Respuesta: "${result.response.substring(0, 80)}..."`);
			console.log(`   Longitud: ${result.responseLength} chars`);
			if (result.usage) {
				console.log(`   Tokens: ${result.usage.total_tokens || "N/A"} (prompt: ${result.usage.prompt_tokens || "N/A"}, completion: ${result.usage.completion_tokens || "N/A"})`);
				console.log(`   Tokens/seg: ${result.tokensPerSecond?.toFixed(2) || "N/A"}`);
			}
			if (result.context) {
				console.log(`   Contexto: ${result.context.used_tokens}/${result.context.limit_tokens} (${result.context.used_percent?.toFixed(1)}%)`);
			}
		} else {
			console.log(`✗ Error: ${result.error}`);
		}
		console.log("");
	}

	console.log("================================================");
	console.log("RESUMEN COMPARATIVO");
	console.log("================================================");
	console.log("");
	console.log("| Modelo | Tiempo (ms) | Éxito | Tokens | Tokens/s | Ctx % |");
	console.log("|--------|-------------|-------|--------|----------|-------|");

	for (const r of results) {
		const success = r.success ? "Sí" : "No";
		const duration = r.durationMs.toFixed(0);
		const tokens = r.usage?.total_tokens || "N/A";
		const tps = r.tokensPerSecond !== null ? r.tokensPerSecond.toFixed(2) : "N/A";
		const ctx = r.context ? r.context.used_percent?.toFixed(1) : "N/A";
		console.log(`| ${r.model.padEnd(30)} | ${duration.padEnd(11)} | ${success.padEnd(5)} | ${String(tokens).padEnd(6)} | ${String(tps).padEnd(8)} | ${ctx} |`);
	}

	console.log("");
	console.log("Comparación de respuestas:");
	for (const r of results) {
		if (r.success) {
			console.log(`  ${r.model}: "${r.response}"`);
		} else {
			console.log(`  ${r.model}: ERROR - ${r.error}`);
		}
	}

	console.log("");
	console.log("================================================");
	console.log("FIN DE PRUEBAS E2E-01");
	console.log("================================================");
}

main().catch(console.error);
