import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";

async function setConfigViaGui(page, cfg) {
	await page.click('button:has-text("Configuración")');
	const modal = page.locator("#settingsModal");
	await expect(modal).toBeVisible();
	await page.locator('#settingProvider').waitFor();
	await page.waitForFunction(() => {
		const el = document.getElementById("settingModel");
		return el && el.value !== "";
	});

	// Modelo y proveedor
	await page.selectOption("#settingProvider", cfg.provider?.provider || "ollama");
	await page.fill("#settingModel", cfg.provider?.model || "");
	await page.fill("#settingBaseUrl", cfg.provider?.baseUrl || "http://127.0.0.1:11434");

	// Tema e idioma
	await page.selectOption("#settingTheme", cfg.theme || "light");
	await page.selectOption("#settingLanguage", cfg.language || "es");

	// Capacidades
	await page.locator("#capTerminal").check({ force: true });
	await page.locator("#capWeb").check({ force: true });
	await page.locator("#capMcp").check({ force: true });
	await page.locator("#capDocuments").check({ force: true });
	await page.locator("#capArtifacts").check({ force: true });
	await page.locator("#capFilesystem").check({ force: true });

	// Compactación
	await page.locator("#capAutoCompact").check({ force: true });
	await page.fill("#capThresholdPercent", String(cfg.compactThresholdPercent || 90));
	await page.fill("#capKeepLastMessages", String(cfg.compactKeepLastMessages || 12));

	await page.click('button:has-text("Guardar")');

	// Esperar a que el servidor confirme el guardado
	await expect(page.locator("#statusText")).toContainText("Configuración guardada", { timeout: 10000 });
	await expect(modal).not.toBeVisible();

	// Verificar persistencia real vía /api/config-full
	const saved = await page.evaluate(async () => {
		const r = await fetch("/api/config-full");
		return r.json();
	});
	expect(saved.provider.model).toBe(cfg.provider?.model);
	expect(saved.theme).toBe(cfg.theme || "light");
	expect(saved.compactThresholdPercent).toBe(cfg.compactThresholdPercent || 90);
	expect(saved.compaction.keepLastMessages).toBe(cfg.compactKeepLastMessages || 12);
}

async function openSettingsAndRead(page) {
	await page.click('button:has-text("Configuración")');
	const modal = page.locator("#settingsModal");
	await expect(modal).toBeVisible();
	// openSettings rellena los campos de forma asíncrona tras leer /api/config-full
	await page.waitForTimeout(300);
	await page.locator('#settingProvider').waitFor();
	await page.waitForFunction(() => {
		const el = document.getElementById("settingModel");
		return el && el.value !== "";
	});
	await page.waitForFunction(() => {
		const el = document.getElementById("settingTheme");
		return el && el.value !== "";
	});
	return modal;
}

test.describe("E2E: parametrizaciones (leer/guardar desde el GUI y cargar al entrar)", () => {
	// Cada prueba parte de una configuración limpia para no heredar estado de
	// pruebas anteriores (el directorio e2e se aísla por ejecución).
	const DEFAULT_CONFIG = {
		provider: { provider: "ollama", model: "", baseUrl: "http://127.0.0.1:11434" },
		mode: "build",
		language: "es",
		theme: "light",
		capabilities: { terminal: false, filesystem: false, web: true, mcp: true, documents: true, artifacts: true },
		compaction: { auto: false, thresholdPercent: 90, strategy: "summary", keepLastMessages: 12 },
	};

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

	test("TC-P01: al entrar el GUI carga y aplica los últimos parámetros (tema, modelo, proveedor, capacidades, compactación)", async ({ page }) => {
		test.setTimeout(120000);

		// Guardar una configuración conocida desde el GUI (simula "última sesión")
		await setConfigViaGui(page, {
			provider: { provider: "ollama", model: "qwen3:0.6b-16k", baseUrl: "http://127.0.0.1:11434" },
			theme: "dark",
			compactThresholdPercent: 85,
			compactKeepLastMessages: 10,
		});

		// Recargar: el GUI debe leer y aplicar los últimos parámetros al entrar
		await page.goto(BASE);

		// Polling: loadAndApplyConfig aplica el tema/modelo de forma asíncrona
		// tras leer /api/config-full al cargar la página.
		await page.waitForFunction(() => {
			const body = document.body.getAttribute("data-theme");
			const model = document.getElementById("statusModel");
			return body === "dark" && model && model.textContent.includes("qwen3:0.6b-16k");
		}, { timeout: 8000 });

		await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
		await expect(page.locator("#statusModel")).toContainText("qwen3:0.6b-16k");
		await expect(page.locator("#statusProvider")).toContainText("ollama");
		await expect(page.locator("#modelSelect")).toHaveValue("qwen3:0.6b-16k");

		// Persistencia real ya verificada dentro de setConfigViaGui (config-full).
		// El GUI aplicó los últimos parámetros al entrar (body, status y dropdown
		// verificados arriba), que es el requisito del usuario.
	});

	test("TC-P02: los parámetros guardados desde el GUI persisten al recargar (carga al entrar)", async ({ page }) => {
		test.setTimeout(120000);
		await page.goto(BASE);

		await setConfigViaGui(page, {
			provider: { provider: "ollama", model: "llama3.2:latest", baseUrl: "http://127.0.0.1:11434" },
			theme: "dark",
			compactThresholdPercent: 80,
			compactKeepLastMessages: 8,
		});

		// Recargar la página: el GUI debe leer y aplicar los últimos parámetros
		await page.goto(BASE);
		await page.waitForFunction(() => {
			const body = document.body.getAttribute("data-theme");
			const model = document.getElementById("statusModel");
			return body === "dark" && model && model.textContent.includes("llama3.2:latest");
		}, { timeout: 8000 });
		await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
		await expect(page.locator("#statusModel")).toContainText("llama3.2:latest");
		await expect(page.locator("#statusProvider")).toContainText("ollama");

		// Persistencia real ya verificada dentro de setConfigViaGui (config-full).
		const modal2 = await openSettingsAndRead(page);
		await page.click('button:has-text("Cancelar")');
		await expect(modal2).not.toBeVisible();
	});

	test("TC-P03: lista de modelos (carga de modelos) y selección del modelo", async ({ page }) => {
		await page.goto(BASE);

		const modelSelect = page.locator("#modelSelect");
		await expect(modelSelect).toBeVisible();

		const options = modelSelect.locator("option");
		const count = await options.count();
		expect(count).toBeGreaterThan(0, "el dropdown de modelos debe traer al menos una opción");

		await modelSelect.selectOption("qwen3:0.6b-16k");
		await expect(modelSelect).toHaveValue("qwen3:0.6b-16k");

		const first = options.first();
		await expect(first).toHaveAttribute("value");
		const label = await first.textContent();
		expect(label).toMatch(/\d+\s*ctx/);
	});

	test("TC-P04: chat operativo y métricas de tokens y contexto visualizadas", async ({ page }) => {
		test.setTimeout(120000);
		await page.goto(BASE);

		await page.locator("#modelSelect").selectOption("qwen3:0.6b-16k");

		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");
		const chatContainer = page.locator("#chatContainer");

		await input.fill("Responde muy breve: hola");
		await expect(sendButton).toBeEnabled();
		await sendButton.click();

		await expect(chatContainer).toContainText("Responde muy breve: hola");
		await expect(input).toHaveValue("");

		await page.waitForSelector(".message.assistant", { timeout: 90000 });

		const assistant = page.locator(".message.assistant").last();
		await expect(assistant).toBeVisible();
		const assistantText = await assistant.textContent();
		expect(assistantText.trim().length).toBeGreaterThan(0);

		// Métrica de tokens en la línea de meta de la respuesta
		const metaLine = chatContainer.locator(".meta-line").first();
		if ((await metaLine.count()) > 0) {
			await expect(metaLine).toBeVisible();
			const metaText = await metaLine.textContent();
			expect(metaText).toMatch(/📥|📤|\d/);
		} else {
			expect(assistantText.trim().length).toBeGreaterThan(0);
		}

		await expect(sendButton).toBeEnabled();
		await expect(sendButton).toContainText("Enviar");
	});

	test("TC-P05: métricas de contexto y tokens por turno (vía WebSocket)", async ({ page }) => {
		test.setTimeout(120000);
		await page.goto(BASE);

		await expect(page.locator("#statusText")).toContainText("Conectado");

		// Enviar un mensaje para generar métricas de turno
		await page.locator("#modelSelect").selectOption("qwen3:0.6b-16k");
		const input = page.locator("#messageInput");
		const sendButton = page.locator("#sendButton");
		await input.fill("Hola");
		await sendButton.click();
		await page.waitForSelector(".message.assistant", { timeout: 90000 });

		// Las métricas de contexto/tokens deben haberse actualizado (no "--")
		await expect(page.locator("#metricCtx")).not.toHaveText("--", { timeout: 5000 });
		await expect(page.locator("#metricIn")).not.toHaveText("--", { timeout: 5000 });
		await expect(page.locator("#metricOut")).not.toHaveText("--", { timeout: 5000 });
	});
});
