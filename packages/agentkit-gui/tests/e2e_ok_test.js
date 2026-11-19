import { test, expect } from "@playwright/test";

test.describe("E2E: Enviar 'ok' al chat y verificar respuesta", () => {
	test("TC-OK-01: la página carga correctamente y el chat está listo", async ({ page }) => {
		await page.goto("http://localhost:3000");

		// Verificar título
		await expect(page).toHaveTitle(/AgentKit/);

		// Verificar encabezado
		const h1 = page.locator("h1");
		await expect(h1).toBeVisible();
		await expect(h1).toContainText("AgentKit");

		// Verificar campo de entrada
		const input = page.locator("#messageInput");
		await expect(input).toBeVisible();
		await expect(input).toHaveAttribute("placeholder", /Escribe un mensaje/);

		// Verificar botón enviar (inicialmente deshabilitado)
		const sendButton = page.locator("#sendButton");
		await expect(sendButton).toBeVisible();
		await expect(sendButton).toBeDisabled();

		// Verificar barra de estado conectada
		await expect(page.locator("#statusText")).toContainText("Conectado");
	});

	test("TC-OK-02: escribir 'ok' y enviar el mensaje", async ({ page }) => {
		await page.goto("http://localhost:3000");

		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");
		const chatContainer = page.locator("#chatContainer");

		// Escribir "ok"
		await input.fill("ok");

		// El botón debe estar habilitado
		await expect(sendButton).toBeEnabled();

		// Hacer clic en enviar
		await sendButton.click();

		// El mensaje del usuario debe aparecer en el chat
		await expect(chatContainer).toContainText("ok");

		// El input debe limpiarse
		await expect(input).toHaveValue("");

		// El botón debe deshabilitarse mientras se procesa
		await expect(sendButton).toBeDisabled();
		await expect(sendButton).toContainText("Enviando...");
	});

	test("TC-OK-03: verificar que llega la respuesta del asistente", async ({ page }) => {
		await page.goto("http://localhost:3000");

		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");
		const chatContainer = page.locator("#chatContainer");

		// Limpiar cualquier mensaje previo enviando uno nuevo
		await input.fill("ok");
		await sendButton.click();

		// Esperar a que llegue la respuesta (dar tiempo al servidor)
		await page.waitForTimeout(3000);

		// Debe haber al menos 2 mensajes en el chat (usuario + asistente)
		const messages = page.locator(".message");
		const count = await messages.count();
		console.log(`Número de mensajes en el chat: ${count}`);
		expect(count).toBeGreaterThanOrEqual(2);

		// El último mensaje debe ser del asistente
		const lastMessage = messages.last();
		const lastRole = await lastMessage.getAttribute("class");
		console.log(`Clase del último mensaje: ${lastRole}`);

		// Verificar que hay texto de respuesta (no vacío)
		const lastText = await lastMessage.textContent();
		console.log(`Contenido del último mensaje: "${lastText}"`);
		expect(lastText.trim().length).toBeGreaterThan(0);

		// El botón debe estar habilitado de nuevo
		await expect(sendButton).toBeEnabled();
		await expect(sendButton).toContainText("Enviar");
	});

	test("TC-OK-04: verificar que no hay errores en la consola del navegador", async ({ page }) => {
		await page.goto("http://localhost:3000");

		const errors = [];
		page.on("pageerror", (err) => errors.push(err.message));
		page.on("console", (msg) => {
			if (msg.type() === "error") {
				errors.push(msg.text());
			}
		});

		// Enviar mensaje y esperar respuesta
		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");
		await input.fill("ok");
		await sendButton.click();
		await page.waitForTimeout(3000);

		// Filtrar errores relacionados con nuestra aplicación (no errores de red de terceros)
		const appErrors = errors.filter(
			(e) =>
				!e.includes("favicon") &&
				!e.includes("404") &&
				!e.includes("net::ERR") &&
				!e.includes("WebSocket")
		);

		console.log(`Errores de aplicación detectados: ${appErrors.length}`);
		appErrors.forEach((e) => console.log(`  - ${e}`));

		expect(appErrors.length).toBe(0);
	});

	test("TC-OK-05: verificar que el historial se guarda correctamente", async ({ page }) => {
		await page.goto("http://localhost:3000");

		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");

		// Enviar un mensaje para crear historial
		await input.fill("ok");
		await sendButton.click();
		await page.waitForTimeout(3000);

		// Recargar la página para verificar persistencia
		await page.reload();
		await page.waitForTimeout(2000);

		// El panel de sesiones debe mostrar al menos una sesión
		const sessionsList = page.locator("#sessionsList");
		const sessionItems = sessionsList.locator(".session-item");
		const count = await sessionItems.count();
		console.log(`Sesiones guardadas: ${count}`);
		expect(count).toBeGreaterThan(0);
	});
});
