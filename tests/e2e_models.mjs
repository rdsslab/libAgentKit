import { askAgent } from "../src/agent.js";

const MODELS = [
	{ name: "qwen3:0.6b", baseUrl: "http://127.0.0.1:11434" },
	{ name: "lfm3-omni:2b", baseUrl: "http://127.0.0.1:11434" },
];

const TEST_MESSAGE = "Responde en una sola frase: ¿cuál es la capital de Ecuador?";

async function runTest(modelConfig) {
	const start = Date.now();
	let result;
	let error = null;

	try {
		result = await askAgent({
			provider: {
				provider: "ollama",
				model: modelConfig.name,
				baseUrl: modelConfig.baseUrl,
			},
			messages: [{ role: "user", content: TEST_MESSAGE }],
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
		model: modelConfig.name,
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
	console.log("E2E TESTS - Core AgentKit con modelos locales");
	console.log("================================================");
	console.log(`Mensaje de prueba: "${TEST_MESSAGE}"`);
	console.log("");

	const results = [];

	for (const modelConfig of MODELS) {
		console.log(`Probando ${modelConfig.name}...`);
		const result = await runTest(modelConfig);
		results.push(result);

		if (result.success) {
			console.log(`  ✓ Éxito en ${result.durationMs}ms`);
			console.log(`  Respuesta: "${result.response}"`);
			console.log(`  Longitud: ${result.responseLength} chars`);
			if (result.usage) {
				console.log(`  Tokens: ${result.usage.total_tokens || "N/A"} (prompt: ${result.usage.prompt_tokens || "N/A"}, completion: ${result.usage.completion_tokens || "N/A"})`);
				console.log(`  Tokens/seg: ${result.tokensPerSecond || "N/A"}`);
			}
			if (result.context) {
				console.log(`  Contexto: ${result.context.used_tokens}/${result.context.limit_tokens} (${result.context.used_percent}%)`);
			}
		} else {
			console.log(`  ✗ Error: ${result.error}`);
		}
		console.log("");
	}

	// Resumen comparativo
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
		const ctx = r.context ? r.context.used_percent.toFixed(1) : "N/A";
		console.log(`| ${r.model} | ${duration} | ${success} | ${tokens} | ${tps} | ${ctx} |`);
	}

	console.log("");
	console.log("Comparación de respuestas:");
	for (const r of results) {
		console.log(`  ${r.model}: "${r.response}"`);
	}

	console.log("");
	console.log("================================================");
	console.log("FIN DE PRUEBAS E2E");
	console.log("================================================");
}

main().catch(console.error);
