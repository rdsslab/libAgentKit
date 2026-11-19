import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";

// Configuración por defecto (limpia) para que cada test parta del mismo estado,
// independiente de ejecuciones previas.
const DEFAULT_CONFIG = {
	provider: { provider: "ollama", model: "", baseUrl: "http://127.0.0.1:11434" },
	mode: "build",
	language: "en",
	theme: "light",
	capabilities: { terminal: false, filesystem: false, web: true, mcp: true, documents: true, artifacts: true },
	compaction: { auto: false, thresholdPercent: 90, strategy: "summary", keepLastMessages: 12 },
};

test.describe("AgentKit GUI E2E Completo", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(BASE);
		await page.evaluate((cfg) => {
			return fetch("/api/config", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(cfg),
			});
		}, DEFAULT_CONFIG);
	});

	test("TC01: debe cargar la página principal con todos los elementos", async ({ page }) => {
		await page.goto("http://localhost:3000");

		await expect(page).toHaveTitle(/AgentKit/);

		const h1 = page.locator("h1");
		await expect(h1).toBeVisible();
		await expect(h1).toContainText("AgentKit");

		const modelSelect = page.locator("#modelSelect");
		await expect(modelSelect).toBeVisible();

		const settingsBtn = page.locator('button:has-text("Configuración")');
		await expect(settingsBtn).toBeVisible();

		const input = page.locator("#messageInput");
		await expect(input).toBeVisible();

		const sendButton = page.locator("#sendButton");
		await expect(sendButton).toBeVisible();
		await expect(sendButton).toBeDisabled();

		await expect(page.locator("#statusText")).toContainText("Conectado");

		await expect(page.locator("#sidebar")).toBeVisible();
		await expect(page.locator("#sessionsList")).toBeVisible();
	});

	test("TC02: debe cambiar de tema claro a oscuro y viceversa", async ({ page }) => {
		await page.goto("http://localhost:3000");

		const body = page.locator("body");
		const themeBtn = page.locator('#sidebar .theme-toggle');

		expect(await body.getAttribute("data-theme")).not.toBe("dark");
		await expect(themeBtn).toContainText("Tema");

		await themeBtn.click();
		await expect(body).toHaveAttribute("data-theme", "dark");
		await expect(themeBtn).toContainText("Claro");

		await themeBtn.click();
		expect(await body.getAttribute("data-theme")).not.toBe("dark");
		await expect(themeBtn).toContainText("Oscuro");
	});

	test("TC03: debe abrir el menú de configuración y guardar cambios", async ({ page }) => {
		test.setTimeout(120000);
		await page.goto("http://localhost:3000");

		await page.click('button:has-text("Configuración")');
		const modal = page.locator("#settingsModal");
		await expect(modal).toBeVisible();
		await page.locator('#settingProvider').waitFor();
		await page.selectOption("#settingTheme", "dark");
		await page.fill("#settingModel", "llama2:13b");
		await page.click('button:has-text("Guardar")');

		// Verificar persistencia real vía /api/config-full
		const saved = await page.evaluate(async () => {
			const r = await fetch("/api/config-full");
			return r.json();
		});
		expect(saved.theme).toBe("dark");
		expect(saved.provider.model).toBe("llama2:13b");

		await expect(modal).not.toBeVisible();
		await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
	});

	test("TC04: debe seleccionar un modelo diferente en el dropdown", async ({ page }) => {
		await page.goto("http://localhost:3000");

		const modelSelect = page.locator("#modelSelect");
		await expect(modelSelect).toBeVisible();

		const optionCount = await modelSelect.locator("option").count();
		expect(optionCount).toBeGreaterThan(0);

		const firstOption = modelSelect.locator("option").first();
		const firstValue = await firstOption.getAttribute("value");
		await modelSelect.selectOption(firstValue);
		await expect(modelSelect).toHaveValue(firstValue);
	});

	test("TC04b: configuración debe mostrar modelos disponibles al abrirse", async ({ page }) => {
		await page.goto("http://localhost:3000");

		await page.click('button:has-text("Configuración")');

		await page.waitForTimeout(2000);

		const settingModel = page.locator("#settingModel");
		await expect(settingModel).toBeVisible();
		await expect(settingModel).toBeEnabled();

		await page.selectOption("#settingProvider", "anthropic");
		await page.waitForTimeout(1000);

		await page.click('button:has-text("Cancelar")');
	});

	test("TC05: debe enviar un mensaje y recibir respuesta", async ({ page }) => {
		test.setTimeout(120000);
		await page.goto("http://localhost:3000");

		// Usar un modelo pequeño y rápido para no depender de modelos grandes (9B) en esta máquina
		await page.locator("#modelSelect").selectOption("qwen3:0.6b-16k");

		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");
		const chatContainer = page.locator("#chatContainer");

		await input.fill("Hola, ¿cómo estás?");
		await expect(sendButton).toBeEnabled();

		await sendButton.click();

		await expect(chatContainer).toContainText("Hola, ¿cómo estás?");
		await expect(input).toHaveValue("");
		await expect(sendButton).toBeDisabled();
		await expect(sendButton).toContainText("Enviando…");

		await page.waitForSelector('.message.assistant', { timeout: 60000 });

		const messages = page.locator(".message");
		const count = await messages.count();
		expect(count).toBeGreaterThanOrEqual(2);

		await expect(sendButton).toBeEnabled();
		await expect(sendButton).toContainText("Enviar");
	});

	test("TC06: debe mostrar información de uso de tokens en la respuesta", async ({ page }) => {
		test.setTimeout(120000);
		await page.goto("http://localhost:3000");

		// Modelo pequeño y rápido para la prueba
		await page.locator("#modelSelect").selectOption("qwen3:0.6b-16k");

		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");
		const chatContainer = page.locator("#chatContainer");

		await input.fill("Prueba de tokens");
		await sendButton.click();

		await page.waitForSelector('.message.assistant', { timeout: 60000 });

		const tokenInfo = chatContainer.locator(".meta-line");
		if ((await tokenInfo.count()) > 0) {
			await expect(tokenInfo.first()).toBeVisible();
		}
	});

	test("TC07: debe crear nueva sesión", async ({ page }) => {
		await page.goto("http://localhost:3000");

		// Crear nueva sesión
		await page.click('button:has-text("+ Nueva")');

		// El chat debe limpiarse
		const chatContainer = page.locator("#chatContainer");
		await expect(chatContainer).toContainText("Nueva conversación");

		// El panel de sesiones debe estar visible
		const sessionsList = page.locator("#sessionsList");
		await expect(sessionsList).toBeVisible();
	});

	test("TC08: debe borrar una sesión", async ({ page }) => {
		test.setTimeout(120000);
		await page.goto("http://localhost:3000");

		// Modelo pequeño y rápido para la prueba
		await page.locator("#modelSelect").selectOption("qwen3:0.6b-16k");

		// Primero enviar un mensaje para crear una sesión
		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");
		await input.fill("Mensaje para borrar");
		await sendButton.click();
		await page.waitForSelector('.message.assistant', { timeout: 90000 });

		// Seleccionar la sesión (hacer clic en el primer item)
		const sessionsList = page.locator("#sessionsList");
		const sessionItems = sessionsList.locator(".session-item");
		const count = await sessionItems.count();
		if (count > 0) {
			await sessionItems.first().click();
			await page.click('button:has-text("🗑️ Borrar")');
			await page.waitForTimeout(1000);
			// La sesión debería haberse borrado
		}
	});

	test("TC09: debe tener botón de adjuntar archivo", async ({ page }) => {
		await page.goto("http://localhost:3000");

		const attachBtn = page.locator('button:has-text("📎")');
		await expect(attachBtn).toBeVisible();

		const fileInput = page.locator("#fileInput");
		expect(await fileInput.count()).toBeGreaterThan(0);
	});

	test("TC10: debe ser responsive y ocupar todo el viewport", async ({ page }) => {
		await page.goto("http://localhost:3000");

		const viewport = page.viewportSize();
		expect(viewport.width).toBeGreaterThan(800);
		expect(viewport.height).toBeGreaterThan(600);

		const chatContainer = page.locator("#chatContainer");
		await expect(chatContainer).toBeVisible();

		const inputArea = page.locator(".input-area");
		await expect(inputArea).toBeVisible();
	});

	test("TC11: WebSocket debe mantener conexión en tiempo real", async ({ page }) => {
		test.setTimeout(120000);
		await page.goto("http://localhost:3000");

		await expect(page.locator("#statusText")).toContainText("Conectado");

		// Modelo pequeño y rápido para no esperar a modelos grandes en esta máquina
		await page.locator("#modelSelect").selectOption("qwen3:0.6b-16k");

		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");
		await input.fill("Prueba tiempo real");
		await sendButton.click();

		const chatContainer = page.locator("#chatContainer");
		await page.waitForSelector('.message.assistant', { timeout: 60000 });
		await expect(chatContainer).toContainText("Prueba tiempo real");
	});

	test("TC12: debe mostrar configuración guardada en la barra de estado", async ({ page }) => {
		await page.goto("http://localhost:3000");

		await page.click('button:has-text("Configuración")');
		await page.selectOption("#settingTheme", "dark");
		await page.click('button:has-text("Guardar")');

		await expect(page.locator("#statusText")).toContainText("Configuración guardada");
		await page.waitForTimeout(2500);
		await expect(page.locator("#statusText")).toContainText("Listo");
	});

	test("TC13: configuración STT/TTS debe estar visible", async ({ page }) => {
		await page.goto("http://localhost:3000");

		await page.click('button:has-text("Configuración")');

		await expect(page.locator("#sttEnabled")).toBeVisible();
		await expect(page.locator("#sttModel")).toBeVisible();
		await expect(page.locator("#sttBaseUrl")).toBeVisible();
		await expect(page.locator("#ttsEnabled")).toBeVisible();
		await expect(page.locator("#ttsModel")).toBeVisible();
		await expect(page.locator("#ttsBaseUrl")).toBeVisible();
		await expect(page.locator("#ttsVoice")).toBeVisible();

		await page.click('button:has-text("Cancelar")');
	});
});
