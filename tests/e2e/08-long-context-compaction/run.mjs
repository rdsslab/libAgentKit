import { askAgent } from "../../../src/agent.js";

const BASE_URL = "http://192.168.100.126:11434";
const MODEL = { name: "qwen3:1.7b", baseUrl: BASE_URL };
const COMPACTION_THRESHOLD = 25; // 25% de umbral para activar compactación

const LONG_MESSAGES = [
	"Hola, me llamo Carlos y tengo una clínica veterinaria llamada Patitas Felices. Atendemos perros, gatos, aves y pequeños mamíferos. Ofrecemos servicios de consulta general, vacunación, desparasitación, cirugía menor, esterilización, hospitalización, peluquería canina y felina, y venta de productos para mascotas.",
	"Nuestra clínica está ubicada en el centro de la ciudad, en la avenida principal número 123. Abrimos de lunes a sábado de 8:00 AM a 8:00 PM, y los domingos de 9:00 AM a 2:00 PM para consultas de emergencia. Tenemos estacionamiento propio y acceso para personas con discapacidad.",
	"Nuestro equipo está compuesto por 5 veterinarios especializados: la doctora Ana López en medicina interna, el doctor Roberto Méndez en cirugía, la doctora Carmen Ruiz en dermatología, el doctor Miguel Torres en odontología veterinaria, y la doctora Elena Vargas en exóticos. Todos tenemos más de 10 años de experiencia.",
	"Ofrecemos planes de bienestar mensuales que incluyen: 2 consultas generales, vacunación completa, desparasitación interna y externa, control de peso, asesoría nutricional, y descuento del 20% en todos nuestros servicios adicionales. El plan básico cuesta $25 mensuales, el plan premium $45, y el plan VIP $75.",
	"Tenemos una sala de espera cómoda con área de juegos para mascotas, televisión, conexión WiFi gratuita, y agua y café para los dueños. También contamos con una sala de espera separada para gatos para reducir el estrés felino.",
	"Nuestro laboratorio propio permite realizar análisis de sangre, orina, heces, citologías, biopsias, y pruebas de alergia en el mismo día. Contamos con equipos de rayos X digital, ecografía, y endoscopia para diagnóstico avanzado.",
	"La farmacia veterinaria de nuestra clínica dispone de medicamentos recetados, antiparasitarios, suplementos vitamínicos, alimentos terapéuticos, y productos de higiene y cuidado para todo tipo de mascotas.",
	"Ofrecemos servicio de peluquería canina y felina que incluye baño, corte de pelo, corte de uñas, limpieza de oídos, expresión de glándulas anales, y cepillado dental. Los precios van desde $15 para baño básico hasta $45 para corte completo de raza.",
	"Contamos con servicio de hospitalización con jaulas individuales, camas ortopédicas, monitoreo constante de signos vitales, administración de medicamentos intravenosos, y alimentación especializada según las necesidades de cada paciente.",
	"Nuestro servicio de emergencia está disponible los domingos y días festivos para atender accidentes, envenenamientos, partos dificultosos, y cualquier situación que ponga en riesgo la vida de la mascota. Teléfono de emergencia: 099-123-4567.",
];

async function runTest() {
	const messages = [];
	const results = [];
	let compactionTriggered = false;
	let contextExceeded25Percent = false;

	console.log("================================================");
	console.log("E2E-08: Contexto Largo con Compactación (Umbral 25%)");
	console.log("================================================");
	console.log(`Servidor: ${BASE_URL}`);
	console.log(`Modelo: ${MODEL.name}`);
	console.log(`Límite de contexto del modelo: 40,960 tokens`);
	console.log(`Umbral de compactación: ${COMPACTION_THRESHOLD}%`);
	console.log("");

	for (let i = 0; i < LONG_MESSAGES.length; i++) {
		const userMessage = LONG_MESSAGES[i];
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
				compactionThresholdPercent: COMPACTION_THRESHOLD,
				compactionKeepLastMessages: 3,
				includeDiagnostics: true,
			});
		} catch (err) {
			error = err.message;
		}

		const end = Date.now();
		const durationMs = end - start;

		const ctx = result?.usage?.context;
		const usedPct = ctx?.used_percent != null ? ctx.used_percent.toFixed(1) : "N/A";

		if (ctx && ctx.used_percent > COMPACTION_THRESHOLD && !contextExceeded25Percent) {
			contextExceeded25Percent = true;
			console.log(`\n>>> UMBRAL DEL ${COMPACTION_THRESHOLD}% SUPERADO EN EL TURNO ${i + 1} (${ctx.used_percent}%)`);
		}

		const turnResult = {
			turn: i + 1,
			success: !error,
			error,
			response: result?.text || "",
			durationMs,
			usage: result?.usage || null,
			context: ctx,
		};
		results.push(turnResult);

		// Agregar al historial
		messages.push({ role: "user", content: userMessage });
		if (result?.text) {
			messages.push({ role: "assistant", content: result.text });
		}

		console.log(`Turno ${i + 1}: ${error ? "✗ " + error : "✓ " + durationMs.toFixed(0) + "ms"}`);
		if (ctx) {
			console.log(`   Contexto: ${ctx.used_tokens ?? 0}/${ctx.limit_tokens ?? 0} (${usedPct}%)`);
		}
		if (result?.usage?.rounds) {
			console.log(`   Rondas tools: ${result.usage.rounds}`);
		}
		if (result?.usage?.context) {
			console.log(`   Compactación: ${result.usage.context.used_percent > COMPACTION_THRESHOLD ? "ACTIVADA" : "No requerida"}`);
		}
		console.log("");
	}

	// Verificar si el modelo recuerda información después de mucha conversación
	console.log("================================================");
	console.log("VERIFICACIÓN DE MEMORIA DESPUÉS DE CONTEXTO LARGO");
	console.log("================================================");
	console.log("");

	const lastResponse = results[results.length - 1].response;
	const remembersName = /carlos/i.test(lastResponse);
	const remembersClinic = /patitas felices/i.test(lastResponse);
	const remembersServices = /consulta|vacunación|cirugía|esterilización/i.test(lastResponse);

	console.log(`¿Recuerda nombre (Carlos)? ${remembersName ? "✓ SÍ" : "✗ NO"}`);
	console.log(`¿Recuerda clínica (Patitas Felices)? ${remembersClinic ? "✓ SÍ" : "✗ NO"}`);
	console.log(`¿Recuerda servicios (consulta/vacunación/cirugía)? ${remembersServices ? "✓ SÍ" : "✗ NO"}`);
	console.log("");

	// Estadísticas de contexto
	const contexts = results.filter((r) => r.context && r.context.used_percent != null).map((r) => r.context);
	if (contexts.length > 0) {
		const firstCtx = contexts[0];
		const lastCtx = contexts[contexts.length - 1];
		const maxCtx = contexts.reduce((max, c) => (c.used_percent > max.used_percent ? c : max), contexts[0]);

		console.log("================================================");
		console.log("ANÁLISIS DE CONTEXTO");
		console.log("================================================");
		console.log("");
		console.log(`Contexto inicial: ${firstCtx.used_percent.toFixed(1)}%`);
		console.log(`Contexto final: ${lastCtx.used_percent.toFixed(1)}%`);
		console.log(`Contexto máximo alcanzado: ${maxCtx.used_percent.toFixed(1)}%`);
		console.log(`Umbral de compactación: ${COMPACTION_THRESHOLD}%`);
		console.log(`¿Superó el umbral? ${maxCtx.used_percent > COMPACTION_THRESHOLD ? "✓ SÍ" : "✗ NO"}`);
		console.log(`¿Compactación activada? ${contextExceeded25Percent ? "✓ SÍ" : "✗ NO"`);
	}

	// Estadísticas generales
	console.log("");
	console.log("================================================");
	console.log("ESTADÍSTICAS GENERALES");
	console.log("================================================");
	console.log("");
	console.log(`Turnos totales: ${results.length}`);
	const successfulTurns = results.filter((r) => r.success);
	console.log(`Turnos exitosos: ${successfulTurns.length}/${results.length}`);
	const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);
	console.log(`Tiempo total: ${totalTime.toFixed(0)}ms`);
	console.log(`Tiempo promedio por turno: ${(totalTime / results.length).toFixed(0)}ms`);

	console.log("");
	console.log("================================================");
	console.log("FIN DE PRUEBAS E2E-08");
	console.log("================================================");
}

runTest().catch(console.error);
