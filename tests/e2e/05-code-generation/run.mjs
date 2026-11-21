import { askAgent } from "../../../src/agent.js";

const MODEL = { model: "qwen3:0.6b-16k", baseUrl: "http://127.0.0.1:11434" };

const CODE_TASKS = [
	{
		name: "JavaScript - Función utilitaria",
		prompt: "Escribe una función en JavaScript que valide si un correo electrónico es válido usando expresión regular. Incluye comentarios explicativos y un ejemplo de uso.",
		language: "javascript",
		check: (code) => /function|const|let|var/i.test(code) && /@/i.test(code),
	},
	{
		name: "Python - Lectura de archivo",
		prompt: "Escribe un script en Python que lea un archivo de texto línea por línea e imprima solo las líneas que contienen la palabra 'error'. Incluye manejo de excepciones.",
		language: "python",
		check: (code) => /def |open\(|with |for |in /i.test(code) && /error/i.test(code),
	},
	{
		name: "HTML - Botón con estilo",
		prompt: "Crea un componente HTML con CSS integrado que muestre un botón azul que al hacer clic cambie de color a verde. Incluye JavaScript para el evento click.",
		language: "html",
		check: (code) => /<button|<style|<script|onclick|addEventListener/i.test(code),
	},
];

async function runTest(task) {
	const start = Date.now();
	let result = null;
	let error = null;

	try {
		result = await askAgent({
			provider: MODEL,
			messages: [{ role: "user", content: task.prompt }],
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

	const response = result?.text || "";
	const codeBlocks = response.match(/```[\s\S]*?```/g) || [];
	const hasCodeBlock = codeBlocks.length > 0;
	const passesCheck = task.check(response);

	return {
		name: task.name,
		language: task.language,
		success: !error,
		error,
		durationMs,
		response,
		hasCodeBlock,
		codeBlockCount: codeBlocks.length,
		passesCheck,
		usage: result?.usage || null,
	};
}

async function main() {
	console.log("================================================");
	console.log("E2E-05: Creación de Código de Programación");
	console.log("================================================");
	console.log(`Modelo: ${MODEL.name} @ ${MODEL.baseUrl}`);
	console.log("");

	const results = [];

	for (const task of CODE_TASKS) {
		console.log(`Probando: ${task.name} (${task.language})...`);
		const result = await runTest(task);
		results.push(result);

		console.log(`   ${result.success ? "✓" : "✗"} ${result.durationMs.toFixed(0)}ms`);
		console.log(`   Tiene bloques de código: ${result.hasCodeBlock ? "✓" : "✗"} (${result.codeBlockCount})`);
		console.log(`   Pasa validación: ${result.passesCheck ? "✓ SÍ" : "✗ NO"}`);
		if (result.error) {
			console.log(`   Error: ${result.error}`);
		} else {
			const preview = result.response.substring(0, 150).replace(/\n/g, " ");
			console.log(`   Vista previa: "${preview}..."`);
		}
		console.log("");
	}

	// Tabla resumen
	console.log("================================================");
	console.log("RESUMEN COMPARATIVO");
	console.log("================================================");
	console.log("");
	console.log("| Lenguaje | Tiempo (ms) | Éxito | Código | Válido |");
	console.log("|----------|-------------|-------|--------|--------|");

	for (const r of results) {
		const success = r.success ? "Sí" : "No";
		const duration = r.durationMs.toFixed(0);
		const code = r.hasCodeBlock ? "✓" : "✗";
		const valid = r.passesCheck ? "✓" : "✗";
		console.log(`| ${r.language.padEnd(8)} | ${duration.padEnd(11)} | ${success.padEnd(5)} | ${code.padEnd(6)} | ${valid} |`);
	}

	console.log("");
	console.log("================================================");
	console.log("FIN DE PRUEBAS E2E-05");
	console.log("================================================");
}

main().catch(console.error);
