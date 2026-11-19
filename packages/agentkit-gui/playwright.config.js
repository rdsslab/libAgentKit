import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const guiDir = path.dirname(fileURLToPath(import.meta.url));

// Directorio aislado para la configuración global de los tests e2e,
// así no se mezcla con la configuración real del usuario (~/.config/agentkit).
const e2eConfigDir = "/tmp/opencode/agentkit-e2e-config";

export default defineConfig({
	testDir: "./tests",
	testMatch: ["**/*.test.js", "**/*.spec.js"],
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1, // Un solo worker: ambos archivos de tests comparten el directorio e2e
	// aislado (/tmp/opencode/agentkit-e2e-config) y no deben escribirlo a la vez.
	reporter: "html",
	use: {
		baseURL: "http://localhost:3000",
		headless: false, // Modo headed para que se vea el navegador
		viewport: { width: 1280, height: 720 },
		ignoreHTTPSErrors: true,
		video: "on-first-retry",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "node server.js",
		cwd: guiDir,
		port: 3000,
		timeout: 120000,
		// Siempre se levanta un servidor propio con el entorno e2e aislado.
		// Nunca se reusa un servidor ajeno (podría leer la config real del usuario).
		reuseExistingServer: false,
		env: {
			...process.env,
			PORT: "3000",
			XDG_CONFIG_HOME: e2eConfigDir,
		},
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
			},
		},
	],
});
