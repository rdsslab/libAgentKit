# Idioma del system prompt: ES vs EN (resultado válido)

> Fuente: suite `idioma` del runner canónico, ejecutada el 2026-11-20T15:12:16Z
> con core v0.4.0 (`67570fd`), Node v24.21.0 y **lfm3-omni:2b** en
> `http://localhost:11434`.
>
> Los documentos y runners anteriores (`run_comparativo_espanol_ingles.mjs`,
> `run_comparativo_idioma_rapido.mjs`) están **superados**: no enviaban el system
> prompt al proveedor y sus conclusiones no son válidas. Fuente de datos:
> `tests/e2e/resultados_por_modelo/canonico_idioma__local__lfm3-omni_2b/resultados.json`.
> Comando: `node tests/e2e/run_canonical.mjs --suite=idioma --output=RESUMEN_IDIOMA_VALIDO.md`.

## Comparación real

El system prompt se seleccionó con `getSystemPromptES(taskType)` /
`getSystemPromptEN(taskType)` y se verificó que llegara al proveedor (longitud
registrada en el artefacto).

| Tarea | Métrica | ES | EN |
|---|---|---|---|
| Código JS | System prompt enviado | 522 chars | 492 chars |
| Código JS | Duración | 27.939 ms | 4.384 ms |
| Código JS | Calidad | 75 | 75 |
| Código JS | Sintaxis válida (`node --check`) | sí | sí |
| Web (HTML/CSS/JS) | System prompt enviado | 510 chars | 480 chars |
| Web (HTML/CSS/JS) | Duración | 66.491 ms | 106.554 ms |
| Web (HTML/CSS/JS) | Bloques devueltos | `html, css, javascript` | `html` |
| Web (HTML/CSS/JS) | Puntuación de los 3 archivos | 45 (HTML 73, CSS 63, JS ausente) | 30 (HTML 91, CSS/JS ausentes) |

La puntuación web divide siempre entre tres archivos: un bloque ausente cuenta
como 0. Por eso un HTML de 91 con CSS/JS faltantes puntúa menos que un HTML de
73 acompañado de CSS.

## Conclusiones

1. **Calidad de código:** empató (75/75) y en ambos casos la sintaxis JavaScript
   es válida. No hay evidencia de que un idioma sea mejor para este modelo en
   esta tarea.
2. **Velocidad:** EN fue más rápido en código (4,4 s vs 27,9 s), pero ES fue más
   rápido en la landing page (66 s vs 107 s). Es una sola muestra por celda;
   la variabilidad del servidor (CPU, sin GPU) explica mejor la diferencia que
   el idioma del prompt. No usar estos tiempos como regla general.
3. **Formato:** ES entregó los tres bloques solicitados; EN solo HTML. Para este
   modelo, el idioma del system prompt sí parece influir en el cumplimiento de
   una salida multitarea, pero harían falta varias repeticiones para afirmarlo.
4. **Estrategia prudente:** mantener las reglas técnicas/formato en inglés y el
   idioma de la respuesta en el del usuario, y validar con el runner canónico
   antes de fijar una política por modelo.

## Uso correcto en el harness

```js
import { askAgent } from "./src/agent.js";
import { getSystemPrompt } from "./src/utils/system-prompts-en.js";

const system = getSystemPrompt("code", "en"); // o "es"

const resultado = await askAgent({
  provider: {
    provider: "ollama",
    model: "lfm3-omni:2b",
    baseUrl: "http://localhost:11434",
    temperature: 0.2,
  },
  system, // askAgent() lo convierte en mensaje { role: "system" }
  messages: [{ role: "user", content: "Escribe una función que valide email" }],
  responseProcessing: true, // solo si quieres extraer el bloque de código
});
```

También funciona `provider.system` o `provider.systemPrompt`; `askAgent()`
acepta las tres formas y deduplica. Con `enhancedAskAgent`, usar
`idiomaSystemPrompt: "en" | "es"` (verificado por test unitario).

## Archivos relacionados

| Archivo | Descripción |
|---|---|
| `tests/e2e/run_canonical.mjs` | Runner canónico (`--suite=idioma`) |
| `tests/e2e/RESUMEN_IDIOMA_VALIDO.md` | Resumen generado |
| `src/utils/system-prompts-en.js` | Prompts ES/EN y `getSystemPrompt(taskType, idioma)` |
| `src/utils/harness-improvements.js` | `enhancedAskAgent` con `idiomaSystemPrompt` |
