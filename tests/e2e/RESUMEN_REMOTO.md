# Resultados E2E canónicos

- Fecha: 2026-11-20T17:17:14.172Z
- Core: v0.4.0 (67570fd)
- Node: v24.21.0

| Modelo | Entorno | Suite | P01 | P02 | P03 | P04 | P05 | P06 |
|---|---|---|---|---|---|---|---|---|
| lfm3-omni:latest | remoto | remote | ✓ 8299ms | ip:✓ web:✓ | ✓ memoria | compact/recuerda | 75% | 51% |
| qwen2.5-coder:3b | remoto | remote | ✓ 19031ms | ip:✓ web:✗ | ✓ memoria | compact/recuerda | 88% | 30% |
| qwen2.5:1.5b-instruct | remoto | remote | ✓ 9411ms | ip:✓ web:✓ | ✓ memoria | compact/recuerda | 75% | 30% |

Los detalles y artefactos están en `resultados_por_modelo/`.
