import { askAgent } from "../../../src/agent.js";

const MODEL = { model: "qwen3:0.6b-16k", baseUrl: "http://127.0.0.1:11434" };

const SEARCH_QUERIES = [
	"capital de Ecuador",
	"precio del dólar hoy Ecuador",
	"presidente de Ecuador 2024",
];

async function runWebSearch(query) {
	const start = Date.now();
	let result = null;
	let error = null;

	try {
		result = await askAgent({
			provider: MODEL,
			messages: [{ role: "user", content: `Busca información sobre: ${query}. Resume los resultados más importantes.` }],
			mode: "build",
			tools: { web_search: true },
			capabilities: {
				terminal: false,
				web: true,
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
		query,
		success: !error,
		error,
		durationMs,
		response: result?.text || "",
		usedWeb: result?.usedWeb || false,
		webQuery: result?.webQuery || "",
		webResults: result?.webResults || [],
		webErrors: result?.webErrors || [],
		toolExecutions: result?.toolExecutions || [],
		usage: result?.usage || null,
	};
}

async function main() {
	console.log("================================================");
	console.log("E2E-07: Búsqueda Web - Core AgentKit");
	console.log("================================================");
	console.log(`Modelo: ${MODEL.name} @ ${MODEL.baseUrl}`);
	console.log("");

	const results = [];

	for (const query of SEARCH_QUERIES) {
		console.log(`Buscando: "${query}"...`);
		const result = await runWebSearch(query);
		results.push(result);

		console.log(`   ${result.success ? "✓" : "✗"} ${result.durationMs.toFixed(0)}ms`);
		console.log(`   Búsqueda web usada: ${result.usedWeb ? "✓ SÍ" : "✗ NO"}`);
		console.log(`   Query ejecutada: "${result.webQuery}"`);
		console.log(`   Resultados obtenidos: ${result.webResults.length}`);
		result.webResults.forEach((r, i) => {
			console.log(`     ${i + 1}. ${r.title || "Sin título"} - ${r.url || "Sin URL"}`);
		});
		if (result.webErrors.length > 0) {
			console.log(`   Errores: ${result.webErrors.join(", ")}`);
		}
		if (result.error) {
			console.log(`   Error general: ${result.error}`);
		} else {
			const preview = result.response.substring(0, 150).replace(/\n/g, " ");
			console.log(`   Respuesta: "${preview}..."`);
		}
		console.log("");
	}

	// Tabla resumen
	console.log("================================================");
	console.log("RESUMEN COMPARATIVO");
	console.log("================================================");
	console.log("");
	console.log("| Consulta | Tiempo (ms) | Éxito | Web usada | Resultados |");
	console.log("|----------|-------------|-------|-----------|------------|");

	for (const r of results) {
		const success = r.success ? "Sí" : "No";
		const duration = r.durationMs.toFixed(0);
		const web = r.usedWeb ? "✓" : "✗";
		console.log(`| ${r.query.padEnd(10)} | ${duration.padEnd(11)} | ${success.padEnd(5)} | ${web.padEnd(9)} | ${r.webResults.length} |`);
	}

	console.log("");
	console.log("================================================");
	console.log("FIN DE PRUEBAS E2E-07");
	console.log("================================================");
}

main().catch(console.error);
