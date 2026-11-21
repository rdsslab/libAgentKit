import { askAgent } from "../../../src/agent.js";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://192.168.100.126:11434";
const MODEL = { model: "sorc/qwen3.5-instruct-uncensored:2b", baseUrl: BASE_URL };
const OUTPUT_DIR = path.join(process.cwd(), "output");
const REPORT_DIR = path.join(process.cwd(), "..", "REPORTES");

async function ask(prompt, timeoutMs = 300000) {
	const start = Date.now();
	let result = null;
	let error = null;
	try {
		result = await askAgent({
			provider: MODEL,
			messages: [{ role: "user", content: prompt }],
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
		tokensPerSecond: result?.usage?.tokens_per_second || null,
		context: result?.usage?.context || null };
}

function cleanCodeBlock(text, language) {
	const regex = new RegExp(`\\\`\\\`\\\`${language}[\\s\\S]*?\\\`\\\`\\\``, 'g');
	const match = regex.exec(text);
	if (match) {
		return match[0].replace(new RegExp(`^\\\`\\\`\\\`${language}`), '').replace(/\\\`\\\`\\\`$/, '').trim();
	}
	return text.trim();
}

async function main() {
	console.log("=== PRUEBA 06: Landing Page HTML (3 Archivos Separados) ===\n");
	console.log(`Modelo: ${MODEL.model} (2B)`);
	console.log(`Servidor: ${BASE_URL}\n`);

	if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	const prompts = {
		html: `Crea el HTML de una landing page para una clínica veterinaria llamada "Patitas Felices". HTML5 semántico completo. Enlaces a style.css y script.js. Secciones: header con navegación, hero con h1 y CTA, servicios (3 tarjetas con iconos y descripciones), tabla de precios (3 planes: Básico, Premium, VIP), formulario de contacto (nombre, email, teléfono, mensaje, botón enviar), footer con derechos reservados y redes sociales. SOLO HTML, sin bloques de código markdown, sin CSS, sin JavaScript.`,
		css: `Crea el CSS para landing page de clínica veterinaria "Patitas Felices". Diseño moderno, responsive (mobile-first), paleta verde veterinario (#2e7d32) y naranja (#ff9800), animaciones de botones hover con transform y transición suave, tarjetas de servicios con sombra y hover, tabla de precios con filas zebra y hover, formulario con inputs stylizados y focus states, header fijo. SOLO CSS, sin bloques de código markdown.`,
		js: `Crea el JavaScript para landing page de clínica veterinaria "Patitas Felices". Menú móvil toggle (hamburguesa), formulario de contacto con validación básica (campos requeridos, formato email), mensaje de confirmación al enviar formulario, smooth scroll para anclas de navegación, botón CTA con alert de confirmación. Vanilla JavaScript sin frameworks. SOLO JS, sin bloques de código markdown.`,
	};

	const results = {};

	for (const [fileType, prompt] of Object.entries(prompts)) {
		console.log(`Generando ${fileType}...`);
		const r = await ask(prompt, 300000);
		results[fileType] = r;

		if (r.success && r.response) {
			const clean = cleanCodeBlock(r.response, fileType);
			fs.writeFileSync(path.join(OUTPUT_DIR, fileType === 'html' ? 'index.html' : fileType === 'css' ? 'style.css' : 'script.js'), clean, "utf8");
			console.log(`   ✓ ${r.durationMs.toFixed(0)}ms - ${clean.length} chars`);
		} else {
			console.log(`   ✗ Error: ${r.error}`);
		}
	}

	console.log("\n--- VALIDACIONES ---");
	const html = results.html.response || "";
	const css = results.css.response || "";
	const js = results.js.response || "";

	const htmlValid = /<!DOCTYPE\s+html/i.test(html) && /<html[^>]*>/i.test(html) && /<body[^>]*>/i.test(html) && /<link[^>]*style\.css/i.test(html) && /<script[^>]*script\.js/i.test(html);
	const cssValid = /body\s*\{/i.test(css) && /button:hover/i.test(css) && /@media/i.test(css);
	const jsValid = /addEventListener/i.test(js) && /form/i.test(js) && /getElementById|querySelector/i.test(js);

	console.log(`HTML - DOCTYPE: ${/<!DOCTYPE\s+html/i.test(html) ? "✓" : "✗"} | <html>: ${/<html[^>]*>/i.test(html) ? "✓" : "✗"} | <body>: ${/<body[^>]*>/i.test(html) ? "✓" : "✗"} | Enlace CSS: ${/<link[^>]*style\.css/i.test(html) ? "✓" : "✗"} | Enlace JS: ${/<script[^>]*script\.js/i.test(html) ? "✓" : "✗"}`);
	console.log(`CSS - Body: ${/body\s*\{/i.test(css) ? "✓" : "✗"} | Animaciones: ${/@keyframes|transition/i.test(css) ? "✓" : "✗"} | Botón hover: ${/button:hover/i.test(css) ? "✓" : "✗"} | Media queries: ${/@media/i.test(css) ? "✓" : "✗"}`);
	console.log(`JS - Event listeners: ${/addEventListener/i.test(js) ? "✓" : "✗"} | Formulario: ${/form/i.test(js) ? "✓" : "✗"} | DOM manipulation: ${/getElementById|querySelector/i.test(js) ? "✓" : "✗"}`);

	const resultado = {
		prueba: "06_landing_page_html",
		modelo: MODEL.model,
		servidor: BASE_URL,
		fecha: new Date().toISOString(),
		resultados: {
			html: { success: results.html.success, durationMs: results.html.durationMs, chars: results.html.response?.length || 0, error: results.html.error },
			css: { success: results.css.success, durationMs: results.css.durationMs, chars: results.css.response?.length || 0, error: results.css.error },
			js: { success: results.js.success, durationMs: results.js.durationMs, chars: results.js.response?.length || 0, error: results.js.error },
		},
		validaciones: { htmlValid, cssValid, jsValid },
	};

	if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
	fs.writeFileSync(path.join(REPORT_DIR, "prueba_06_landing_page.json"), JSON.stringify(resultado, null, 2), "utf8");

	console.log(`\nResultado guardado en tests/e2e/REPORTES/prueba_06_landing_page.json`);
	console.log(`Archivos generados en: ${OUTPUT_DIR}/`);
}

main().catch(console.error);
