import { askAgent } from "../../../src/agent.js";

const MODEL = { model: "qwen3:0.6b-16k", baseUrl: "http://127.0.0.1:11434" };

// Herramienta local: calculadora simple
const toolHandlers = {
	calculator: {
		description: "Efectúa operaciones matemáticas básicas (suma, resta, multiplicación, división).",
		inputSchema: {
			type: "object",
			properties: {
				operation: { type: "string", description: "sum, sub, mul, div" },
				a: { type: "number", description: "Primer número" },
				b: { type: "number", description: "Segundo número" },
			},
			required: ["operation", "a", "b"],
			additionalProperties: false,
		},
		handler: async (args) => {
			const { operation, a, b } = args;
			let result;
			switch (operation) {
				case "sum": result = a + b; break;
				case "sub": result = a - b; break;
				case "mul": result = a * b; break;
				case "div": result = b !== 0 ? a / b : "Error: división por cero"; break;
				default: result = "Error: operación desconocida";
			}
			return { ok: true, operation, a, b, result };
		},
	},
};

// Herramienta local: búsqueda web simulada (retorna datos fijos para prueba)
const webSearchTool = {
	description: "Busca información en la web y devuelve un resumen.",
	inputSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "Término de búsqueda" },
		},
		required: ["query"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const query = args.query || "";
		const fakeResults = {
			"capital de ecuador": { answer: "Quito", source: "simulado" },
			"presidente de ecuador": { answer: "Daniel Noboa", source: "simulado" },
			"moneda de ecuador": { answer: "Dólar estadounidense", source: "simulado" },
		};
		const key = query.toLowerCase().trim();
		const found = fakeResults[key] || { answer: "No se encontró información", source: "simulado" };
		return { ok: true, query, ...found };
	},
};

async function runTest(name, tools, toolHandlers, message) {
	const start = Date.now();
	let result = null;
	let error = null;

	try {
		result = await askAgent({
			provider: MODEL,
			messages: [{ role: "user", content: message }],
			mode: "build",
			tools,
			toolHandlers,
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
		name,
		success: !error,
		error,
		durationMs,
		response: result?.text || "",
		toolExecutions: result?.toolExecutions || [],
		hasTools: result?.hasTools || false,
		usage: result?.usage || null,
	};
}

async function main() {
	console.log("================================================");
	console.log("E2E-02: Uso de Tools - Core AgentKit");
	console.log("================================================");
	console.log(`Modelo: ${MODEL.name} @ ${MODEL.baseUrl}`);
	console.log("");

	const results = [];

	// Prueba 1: Calculadora
	console.log("Probando herramienta: calculator...");
	const r1 = await runTest(
		"Calculadora",
		{ calculator: true },
		toolHandlers,
		"¿Cuánto es 25 multiplicado por 4?"
	);
	results.push(r1);
	console.log(`   ${r1.success ? "✓" : "✗"} ${r1.durationMs.toFixed(0)}ms`);
	console.log(`   Respuesta: "${r1.response.substring(0, 100)}..."`);
	console.log(`   Tool executions: ${r1.toolExecutions.length}`);
	r1.toolExecutions.forEach((t) => console.log(`     - ${t.tool}: ${t.ok ? "OK" : "FALLO"}`));
	console.log("");

	// Prueba 2: Búsqueda web simulada
	console.log("Probando herramienta: web_search...");
	const r2 = await runTest(
		"Búsqueda Web",
		{ web_search: true },
		webSearchTool,
		"¿Cuál es la capital de Ecuador?"
	);
	results.push(r2);
	console.log(`   ${r2.success ? "✓" : "✗"} ${r2.durationMs.toFixed(0)}ms`);
	console.log(`   Respuesta: "${r2.response.substring(0, 100)}..."`);
	console.log(`   Tool executions: ${r2.toolExecutions.length}`);
	r2.toolExecutions.forEach((t) => console.log(`     - ${t.tool}: ${t.ok ? "OK" : "FALLO"}`));
	console.log("");

	// Prueba 3: Sin herramientas (respuesta directa)
	console.log("Probando sin herramientas (respuesta directa)...");
	const r3 = await runTest(
		"Respuesta Directa",
		{},
		{},
		"Explica en una frase qué es JavaScript."
	);
	results.push(r3);
	console.log(`   ${r3.success ? "✓" : "✗"} ${r3.durationMs.toFixed(0)}ms`);
	console.log(`   Respuesta: "${r3.response.substring(0, 100)}..."`);
	console.log(`   Tool executions: ${r3.toolExecutions.length}`);
	console.log("");

	// Tabla resumen
	console.log("================================================");
	console.log("RESUMEN COMPARATIVO");
	console.log("================================================");
	console.log("");
	console.log("| Prueba | Tiempo (ms) | Éxito | Tools usadas | Tool OK |");
	console.log("|--------|-------------|-------|--------------|---------|");

	for (const r of results) {
		const success = r.success ? "Sí" : "No";
		const duration = r.durationMs.toFixed(0);
		const toolsUsed = r.toolExecutions.length;
		const toolsOk = r.toolExecutions.filter((t) => t.ok).length;
		console.log(`| ${r.name.padEnd(16)} | ${duration.padEnd(11)} | ${success.padEnd(5)} | ${String(toolsUsed).padEnd(12)} | ${toolsOk} |`);
	}

	console.log("");
	console.log("Detalle de respuestas:");
	for (const r of results) {
		console.log(`  ${r.name}: "${r.response}"`);
	}

	console.log("");
	console.log("================================================");
	console.log("FIN DE PRUEBAS E2E-02");
	console.log("================================================");
}

main().catch(console.error);
