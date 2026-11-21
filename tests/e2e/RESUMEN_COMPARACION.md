# Comparación con baselines

- Tolerancia de puntuación: 5 puntos
- Factor de duración: 1.25 (solo informativo)

## canonico_idioma__local__lfm3-omni_2b

| Métrica | Antes | Ahora | Δ | Estado |
|---|---|---|---|---|
| idioma es/code | 75 | 75 | 0 | igual |
| idioma en/code | 75 | 75 | 0 | igual |
| idioma es/web | 45 | 45 | 0 | igual |
| idioma en/web | 30 | 30 | 0 | igual |

## canonico_local__local__lfm3-omni_2b

| Métrica | Antes | Ahora | Δ | Estado |
|---|---|---|---|---|
| P01 ok | ✓ | ✓ |  | igual |
| P01 ms | 4619 | 11160 | +6541 | informativo |
| P03 ok | ✓ | ✓ |  | igual |
| P04 compacta | ✓ | ✓ |  | igual |
| P05 calidad | 75 | 75 | 0 | igual |
| P06 calidad | 55 | 79 | +24 | MEJORA |

## canonico_quality__local__lfm3-omni_2b

| Métrica | Antes | Ahora | Δ | Estado |
|---|---|---|---|---|
| quality | 75 | 75 | 0 | igual |

## canonico_quality__remoto__lfm3-omni_latest

| Métrica | Antes | Ahora | Δ | Estado |
|---|---|---|---|---|
| quality | 75 | 75 | 0 | igual |

## canonico_quality__remoto__qwen2.5-coder_3b

| Métrica | Antes | Ahora | Δ | Estado |
|---|---|---|---|---|
| quality | 100 | 100 | 0 | igual |

## canonico_remote__remoto__lfm3-omni_latest

| Métrica | Antes | Ahora | Δ | Estado |
|---|---|---|---|---|
| P01 ok | ✓ | ✓ |  | igual |
| P01 ms | 7733 | 13058 | +5325 | informativo |
| P03 ok | ✓ | ✓ |  | igual |
| P04 compacta | ✓ | ✓ |  | igual |
| P05 calidad | 75 | 75 | 0 | igual |
| P06 calidad | 51 | 83 | +32 | MEJORA |

## canonico_remote__remoto__qwen2.5-coder_3b

| Métrica | Antes | Ahora | Δ | Estado |
|---|---|---|---|---|
| P01 ok | ✓ | ✓ |  | igual |
| P01 ms | 33125 | 17245 | -15880 | informativo |
| P03 ok | ✓ | ✓ |  | igual |
| P04 compacta | ✓ | ✓ |  | igual |
| P05 calidad | 88 | 100 | +12 | MEJORA |
| P06 calidad | 30 | 83 | +53 | MEJORA |

## canonico_remote__remoto__qwen2.5_1.5b-instruct

| Métrica | Antes | Ahora | Δ | Estado |
|---|---|---|---|---|
| P01 ok | ✓ | ✓ |  | igual |
| P01 ms | 13561 | 9411 | -4150 | informativo |
| P03 ok | ✓ | ✓ |  | igual |
| P04 compacta | ✓ | ✓ |  | igual |
| P05 calidad | 75 | 75 | 0 | igual |
| P06 calidad | 30 | 30 | 0 | igual |

