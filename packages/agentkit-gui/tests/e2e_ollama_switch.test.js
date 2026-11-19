import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";

const LOCALHOST_MODEL = "qwen3:0.6b-16k";      // 0.5 GB, rápido en localhost
const REMOTE_MODEL = "qwen2.5:1.5b-instruct";  // 1.0 GB, confirmado disponible en 192.168.100.126

async function configureProvider(page, baseUrl, model) {
	await page.click('button:has-text("Configuración")');
	const modal = page.locator("#settingsModal");
	await expect(modal).toBeVisible();
	await page.locator('#settingProvider').waitFor();
	await page.waitForFunction(() => {
		const el = document.getElementById("settingModel");
		return el && el.value !== "";
	});

	await page.selectOption("#settingProvider", "ollama");
	await page.fill("#settingModel", model);
	await page.fill("#settingBaseUrl", baseUrl);
	await page.click('button:has-text("Guardar")');

	await expect(page.locator("#statusText")).toContainText("Configuración guardada", { timeout: 10000 });
	await expect(modal).not.toBeVisible();
}

async function sendAndVerifyRealResponse(page, text) {
	const input = page.locator("#messageInput");
	const sendButton = page.locator("#sendButton");
	const chatContainer = page.locator("#chatContainer");

	await input.fill(text);
	await expect(sendButton).toBeEnabled();
	await sendButton.click();

	await expect(chatContainer).toContainText(text);
	await expect(input).toHaveValue("");

	await page.waitForSelector(".message.assistant", { timeout: 90000 });

	const assistant = page.locator(".message.assistant").last();
	await expect(assistant).toBeVisible();
	const assistantText = await assistant.textContent();
	expect(assistantText.trim().length).toBeGreaterThan(0);

	// Verificar que NO es la respuesta de fallback simulada
	expect(assistantText).not.toContain("Esta es una respuesta de fallback");
	expect(assistantText).not.toContain("Para usar una IA real");

	// El botón debe re-habilitarse tras la respuesta (puede tardar un poco tras cambiar de proveedor)
	await expect(sendButton).toBeEnabled({ timeout: 20000 });
	await expect(sendButton).toContainText("Enviar");

	return assistantText;
}

test.describe("E2E: cambio de proveedor Ollama (localhost ↔ remoto) con respuesta real", () => {
	test("TC-O1: localhost Ollama responde de forma real (no simulado) con modelo pequeño", async ({ page }) => {
		test.setTimeout(180000);
		await page.goto(BASE);

		await configureProvider(page, "http://127.0.0.1:11434", LOCALHOST_MODEL);

		const response = await sendAndVerifyRealResponse(page, "Di hola en una palabra");

		// Verificar métricas de tokens en el chat
		const metaLine = page.locator(".meta-line").first();
		if ((await metaLine.count()) > 0) {
			const metaText = await metaLine.textContent();
			expect(metaText).toMatch(/📥|📤|\d/);
		}

		// Verificar métrica de contexto en el panel
		await expect(page.locator("#metricCtx")).not.toHaveText("--", { timeout: 5000 });
	});

	test("TC-O2: remoto Ollama (192.168.100.126) responde de forma real con modelo pequeño", async ({ page }) => {
		test.setTimeout(180000);
		await page.goto(BASE);

		await configureProvider(page, "http://192.168.100.126:11434", REMOTE_MODEL);

		const response = await sendAndVerifyRealResponse(page, "Di hola en una palabra");

		expect(response).not.toContain("Esta es una respuesta de fallback");
		expect(response).not.toContain("Para usar una IA real");
	});

	test("TC-O3: cambiar de localhost a remoto y seguir recibiendo respuesta real", async ({ page }) => {
		test.setTimeout(240000);
		await page.goto(BASE);

		// Primero localhost
		await configureProvider(page, "http://127.0.0.1:11434", LOCALHOST_MODEL);
		const r1 = await sendAndVerifyRealResponse(page, "Pregunta 1");
		expect(r1).not.toContain("fallback");

		// Cambiar a remoto
		await configureProvider(page, "http://192.168.100.126:11434", REMOTE_MODEL);
		const r2 = await sendAndVerifyRealResponse(page, "Pregunta 2");
		expect(r2).not.toContain("fallback");

		// Volver a localhost
		await configureProvider(page, "http://127.0.0.1:11434", LOCALHOST_MODEL);
		const r3 = await sendAndVerifyRealResponse(page, "Pregunta 3");
		expect(r3).not.toContain("fallback");
	});
});
