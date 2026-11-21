# Resultados E2E canónicos — suite web-complex

- Fecha: 2026-11-21T06:06:05.980Z
- Core: v0.4.0 (6b822d1)

| Modelo | Entorno | Calidad | Funcional | Originalidad | Archivos | Duración |
|---|---|---:|---:|---:|---:|---:|
| qwen2.5-coder:3b | remoto | 85% | 86% | 71% | 6/6 | 599 s |
| lfm3-omni:2b | local | 56% | 39% | 43% | 5/6 | 411 s |

Referencia monolítica (`qwen2.5-coder:3b`): 81% · func 64% · orig 71%, 6/6, 855 s.
Artefacto: `resultados_por_modelo/canonico_web-complex__remoto__qwen2.5-coder_3b_monolitico_baseline/`.

## Tras la reparación determinista del harness

Re-escoreo con el mismo validador (incluye el arreglo que marca las
interacciones como fallidas cuando el JS no ejecuta):

| Modelo | Calidad | Funcional | Originalidad | Archivos | Duración | Nota |
|---|---:|---:|---:|---:|---:|---|
| lfm3-omni:2b (local) | 56% → **70%** | 39% → **47%** | 43% | 5/6 → **6/6** | 503 s | `script.js` truncado recuperado con sintaxis válida |
| qwen2.5-coder:3b (remoto) | 85% → **85%** | 86% → **86%** | 71% | 6/6 | 568 s | corrida final de regresión, sin cambios |

La corrida final de qwen se relanzó con el código definitivo y reprodujo
exactamente 85 / 86% / 71% / 6-6 (`RESUMEN_WEB_FINAL_QWEN.md`).

Corridas intermedias conservadas:
`canonico_web-complex__local__lfm3-omni_2b_{baseline_pre_repair,r1,r2,r3}/`.
Detalle de las decisiones descartadas en `MEJORAS_HARNESS_FINAL.md` §11.

## Suite `local` completa (P01–P06)

`RESUMEN_CANONICO_FINAL_LOCAL.md`: P01 ✓, P02 ip/web ✓, P03 ✓, P04 ✓,
P05 calidad 75 / funcional 100, y **P06 calidad 55 → 87, funcional 100%**
(bloques `html`, `css`, `js`). Sin regresiones en P01–P05.
