# Reporte E2E final (fuente canónica)

**Fecha:** 2026-11-20  
**Core:** v0.4.0 (`67570fd`) · **Node:** v24.21.0  
**Runner:** `tests/e2e/run_canonical.mjs`  
**Servidores:** local `http://localhost:11434`, remoto `http://192.168.100.126:11434`

> Los reportes anteriores generados por `run_e2e_presets.mjs`,
> `run_comparativo_local_remoto.mjs` y los comparativos ES/EN están
> **superados**. No enviaban correctamente el system prompt ni el historial, y
> no enforceaban `responseTimeout`. Sus conclusiones (por ejemplo «P03 no
> recuerda nada» o «la compactación nunca se activa») son inválidas.

## Entornos

| Servidor | Detalle |
|---|---|
| Local | i3-1115G4, 2 núcleos/4 hilos, 7,5 GB RAM, sin GPU dedicada, Linux |
| Remoto | i5 4 núcleos, 16 GB RAM, sin GPU dedicada, Debian 13 |

## Metodología

- P01: explicación corta sobre React; mide duración, tok/s y que el system
  prompt del preset llegue al proveedor.
- P03: cuatro turnos con historial real (`María` / `Patitas Felices` /
  servicios); comprueba nombre, clínica y servicios.
- P04: 93 mensajes con un dato enterrado al inicio; `autoCompact` con umbral
  25 %, estrategia `summary` y `contextLength: 16384` forzado para que el
  umbral sea verificable (5900 tokens estimados = 36,01 %; 93 → 6 mensajes).
- P05: JavaScript y Python con puntuación por checks + validación sintáctica
  real (`node --check`, `ast.parse`).
- P06: landing page con HTML/CSS/JS; se puntúan los tres archivos (un bloque
  ausente cuenta 0) y se extraen CSS/JS incrustados cuando el modelo no los
  separa.
- Timeouts: `responseTimeout` en el provider + `AbortSignal`, con política
  adaptativa que solo registra muestras de llamadas exitosas.

## Resultados

### Suite `local`

| Modelo | P01 | P03 | P04 | P05 | P06 |
|---|---|---|---|---|---|
| `lfm3-omni:2b` | ✓ 4.619 ms · 10,55 tok/s | ✓ memoria | ✓ compact/recuerda | 75 | 55 · `html,css,javascript` |

### Suite `remote`

| Modelo | P01 | P03 | P04 | P05 | P06 |
|---|---|---|---|---|---|
| `lfm3-omni:latest` | ✓ 7.733 ms · 5,58 tok/s | ✓ memoria | ✓ compact/recuerda | 75 | 51 · `html,css` |
| `qwen2.5-coder:3b` | ✓ 33.125 ms | ✓ memoria | ✓ compact/recuerda | 88 | 30 · `html` |
| `qwen2.5:1.5b-instruct` | ✓ 13.561 ms | ✓ memoria | ✓ compact/recuerda | 75 | 30 · `html` |

P06 no es pass/fail: `lfm3-omni:2b` obtuvo HTML 91 + CSS 75 pero no entregó JS,
por eso 55. En ejecuciones anteriores hubo timeouts (30 s y 200 s) en modelos
remotos; el runner actual usa techos por tarea (chat 90 s, código 150 s, web
180 s) y con `max_tokens` acotado todas las celdas de arriba completaron.

### Suite `idioma`

Ver `../../../IDIOMA_SYSTEM_PROMPT.md` y `../RESUMEN_IDIOMA_VALIDO.md`.
Código JS: ES 75 / EN 75, sintaxis válida en ambos. Web: ES 45 (3 bloques) /
EN 30 (solo HTML).

### Suite `quality` (`enhancedAskAgent`)

| Modelo | Intentos | Puntuación | Sintaxis |
|---|---|---|---|
| `lfm3-omni:2b` | 2 | 75 | válida |
| `lfm3-omni:latest` | 2 | 75 | válida |
| `qwen2.5-coder:3b` | 1 | 100 | válida |

Detalle en `../RESUMEN_CALIDAD_ENHANCED.md`.

## Artefactos

```
tests/e2e/resultados_por_modelo/
├── canonico_local__local__lfm3-omni_2b/
├── canonico_remote__remoto__lfm3-omni_latest/
├── canonico_remote__remoto__qwen2.5-coder_3b/
├── canonico_remote__remoto__qwen2.5_1.5b-instruct/
├── canonico_idioma__local__lfm3-omni_2b/
└── canonico_quality__*/
    ├── resultados.json
    ├── codigo_js.js
    ├── codigo_py.py
    ├── index.html
    ├── style.css
    └── script.js
```

Cada carpeta incluye su `resultados.json` con metadata, configuración del
provider, system prompt enviado, puntuaciones y errores. Los resúmenes
generados están en `../RESUMEN_CANONICO.md`, `../RESUMEN_REMOTO.md`,
`../RESUMEN_IDIOMA_VALIDO.md` y `../RESUMEN_CALIDAD_ENHANCED.md`.

## Reproducción

```bash
node tests/e2e/run_canonical.mjs --suite=local
node tests/e2e/run_canonical.mjs --suite=remote --output=RESUMEN_REMOTO.md
node tests/e2e/run_canonical.mjs --suite=idioma --output=RESUMEN_IDIOMA_VALIDO.md
node tests/e2e/run_canonical.mjs --suite=quality --output=RESUMEN_CALIDAD_ENHANCED.md
```

Nota sobre parámetros: `temperature`, `top_p`, `seed`, `max_tokens` y
`tool_choice` se envían al endpoint OpenAI-compatible. `top_k`,
`repeat_penalty` y `num_ctx` se conservan en config para métricas/compactación,
pero Ollama los ignora en `/v1/chat/completions` salvo
`sendNativeProviderParams: true`.
