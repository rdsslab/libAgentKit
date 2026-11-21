# Mejoras del harness — documento histórico

> ⚠️ **SUPERSEDED.** Este fue el primer registro de cambios (limpieza de
> respuestas, `_clamp`, retry). Varias afirmaciones ya no son válidas: el
> markdown **ya no se elimina por defecto**, `system` sí se envía al proveedor,
> `autoCompact` está conectado y los parámetros nativos de Ollama no se envían
> al endpoint OpenAI-compatible sin opt-in explícito.
>
> Estado actual y resultados reales: **`MEJORAS_HARNESS_FINAL.md`**.
> Comparación ES/EN válida: **`IDIOMA_SYSTEM_PROMPT.md`**.
> Reporte E2E canónico: **`tests/e2e/RESULTADOS_E2E_FINAL.md`**.

## Cambios originales (contexto)

- `src/utils/response-cleaner.js`: extracción de bloques markdown, detección de
  rechazos y validación de contenido mínimo.
- `src/agent.js`: inferencia del tipo de tarea y diagnósticos de limpieza.
- `src/ia.js`: validación de rangos de parámetros y reintento con temperatura
  reducida.
- `src/config/presets.js`: presets por tipo de tarea (`chat`, `code`, `web`,
  `longContext`, `reasoning`).

Todos esos puntos fueron corregidos o ampliados en el documento canónico. La
fuente de verdad es el código y los tests (`npm test`, 32/32).
