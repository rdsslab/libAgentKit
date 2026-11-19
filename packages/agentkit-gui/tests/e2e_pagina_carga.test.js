import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";

test.describe("GUI: la página carga y no está vacía", () => {
	test("debe renderizar el index.html con todos los elementos principales", async ({ page }) => {
		await page.goto(BASE);

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

		await expect(page.locator("#statusText")).toContainText("Conectado");

		await expect(page.locator("#sidebar")).toBeVisible();
		await expect(page.locator("#sessionsList")).toBeVisible();

		// El body no debe estar vacío
		const bodyHtml = await page.locator("body").innerHTML();
		expect(bodyHtml.length).toBeGreaterThan(1000);
	});

	test("el modal de configuración se abre y muestra parámetros", async ({ page }) => {
		await page.goto(BASE);

		await page.click('button:has-text("Configuración")');
		const modal = page.locator("#settingsModal");
		await expect(modal).toBeVisible();

		await expect(page.locator("#settingProvider")).toBeVisible();
		await expect(page.locator("#settingModel")).toBeVisible();
		await expect(page.locator("#settingBaseUrl")).toBeVisible();
		await expect(page.locator("#settingTheme")).toBeVisible();

		await page.click('button:has-text("Cancelar")');
		await expect(modal).not.toBeVisible();
	});
});
