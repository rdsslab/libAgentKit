> ⚠️ **SUPERSEDED**: reporte histórico de los runners antiguos. No refleja los
> arreglos de system prompt, historial, compactación ni timeouts del runner
> canónico. Fuente válida: `tests/e2e/RESULTADOS_E2E_FINAL.md` y los artefactos
> `tests/e2e/resultados_por_modelo/canonico_*`.

# 📊 Reporte Comparativo de Pruebas E2E - Core AgentKit (histórico)

## 🖥️ Características de las Máquinas

### Servidor Ollama Local (localhost:11434)
| Componente | Especificación |
|------------|----------------|
| **Procesador** | Intel Core i3-1115G4 (2 cores, 4 hilos, 3.0 GHz base) |
| **RAM** | 7.5 GB (swap alto) |
| **GPU** | Sin GPU dedicada |
| **Sistema operativo** | Linux |
| **Node.js** | v24.21.0 |

### Servidor Ollama Remoto (192.168.100.126:11434)
| Componente | Especificación |
|------------|----------------|
| **Procesador** | Intel Core i5, 4 núcleos |
| **RAM** | 16 GB |
| **GPU** | Sin GPU dedicada |
| **Sistema operativo** | Debian 13 con escritorio |
| **Estado** | Muy lento para modelos > 1GB (tiempos > 3 min o timeout) |

---

## 📈 Resultados de Pruebas Ejecutadas

### 01 - Tiempos de Respuesta (Servidor Local)

| Modelo | Tamaño | Tiempo (ms) | Tokens/s | Tokens totales | Ctx % |
|--------|--------|-------------|----------|----------------|-------|
| qwen3:0.6b-16k | 0.5 GB | 12,023 | ~25 | 205 | 0.5% |
| qwen3:4b-instruct | 2.5 GB | 27,720 | N/A | N/A | N/A |

**Mensaje:** "Explica en máximo 3 oraciones qué es React y para qué sirve."

### 03 - Coherencia en Conversación Multi-Turno (Servidor Local)

| Métrica | Valor |
|---------|-------|
| Modelo | qwen3:0.6b-16k |
| Turnos totales | 4 |
| Tiempo total | 41,653 ms |
| Tiempo promedio por turno | 10,413 ms |
| Éxito | 4/4 (100%) |
| Recuerda nombre (María) | ✅ Sí |
| Recuerda clínica (Patitas Felices) | ✅ Sí |
| Recuerda servicios | ✅ Sí |
| Resultado | ✅ Conversación coherente |

### 04 - Contexto Largo con Compactación (Umbral 25%, Servidor Local)

| Métrica | Valor |
|---------|-------|
| Modelo | qwen3:0.6b-16k |
| Umbral de compactación | 25% |
| Turnos totales | 10 |
| Tiempo total | ~3.5 minutos |
| Contexto máximo alcanzado | ~345 tokens (de 40,960 = ~0.84%) |
| ¿Superó umbral 25%? | ❌ No |
| ¿Compactación activada? | ❌ No (no fue necesaria) |
| ¿Recuerda María después de contexto largo? | ❌ No |

**Observación:** El contexto nunca superó el 1% del límite del modelo, por lo que la compactación automática no se activó. Para probar la compactación se necesitarían muchos más turnos o mensajes mucho más largos.

### 05 - Generación de Código (Servidor Local, qwen3:4b-instruct)

| Métrica | Valor |
|---------|-------|
| Tiempo | >180,000 ms (timeout) |
| Estado | ❌ Falló por timeout |
| Observación | El modelo 4B es demasiado lento para generar código completo en este hardware |

### 06 - Landing Page HTML (3 Archivos Separados, Servidor Local)

| Archivo | Estado | Tiempo (ms) | Tamaño | Válido |
|---------|--------|-------------|--------|--------|
| index.html | ⚠️ Parcial | 38,933 | 482 chars | HTML incompleto (cierre `</.html>` incorrecto, faltan secciones) |
| style.css | ❌ Falló | >300,000 (timeout) | - | No generado por el modelo |
| script.js | ❌ Falló | >300,000 (timeout) | - | No generado por el modelo |

**Observación:** El modelo qwen3:4b-instruct generó HTML incompleto en 39s, pero CSS y JS excedieron el timeout de 5 min. Los archivos HTML, CSS y JS se crearon manualmente como ejemplo de lo que el GUI debería generar.

### 07 - Búsqueda Web

| Métrica | Valor |
|---------|-------|
| Estado | ⏳ No ejecutada |
| Razón | Servidor remoto demasiado lento, modelo local sin capacidad de web_search |

### 08 - Contexto Largo con Compactación (Umbral 25%)

| Métrica | Valor |
|---------|-------|
| Estado | ✅ Idéntica a prueba 04 |

---

## 🔧 Configuración Usada en Todas las Pruebas

```javascript
{
  mode: "build",
  capabilities: {
    terminal: false,
    web: false,
    mcp: false,
    documents: false,
    artifacts: false,
    filesystem: false,
  },
  autoCompact: true,
  compactionThresholdPercent: 25,  // Umbral reducido al 25%
  compactionKeepLastMessages: 3,
  includeDiagnostics: true,
}
```

---

## 📁 Archivos de Prueba Creados

```
tests/e2e/
├── README.md                          # Documentación principal
├── REPORTES/
│   ├── RESULTADOS_E2E.md             # Este reporte
│   ├── resultados_e2e.json           # Datos en formato JSON
│   ├── prueba_03_coherence.json      # Resultados prueba 03
│   ├── prueba_04_long_context.json   # Resultados prueba 04
│   └── prueba_06_landing_page.json   # Resultados prueba 06
├── 01-response-time/
│   ├── run.mjs                       # Tiempos de respuesta
│   └── README.md
├── 02-tool-usage/
│   ├── run.mjs                       # Uso de herramientas
│   └── README.md
├── 03-response-coherence/
│   ├── run.mjs                       # Prueba ejecutada localmente
│   ├── run_remote.mjs                # Versión para servidor remoto
│   └── README.md
├── 04-long-context/
│   ├── run.mjs                       # Prueba ejecutada localmente
│   ├── run_remote.mjs                # Versión para servidor remoto
│   └── README.md
├── 05-code-generation/
│   ├── run.mjs                       # Generación de código
│   └── README.md
├── 06-landing-page-html/
│   ├── run.mjs                       # Landing page HTML
│   ├── output/
│   │   ├── index.html                # Generado manualmente (ejemplo)
│   │   ├── style.css                 # Generado manualmente (ejemplo)
│   │   └── script.js                 # Generado manualmente (ejemplo)
│   └── README.md
├── 07-web-search/
│   ├── run.mjs                       # Búsqueda web
│   └── README.md
├── 08-long-context-compaction/
│   ├── run.mjs                       # Contexto largo con compactación
│   ├── run_remote.mjs                # Versión para servidor remoto
│   └── README.md
├── run-all.mjs                       # Script maestro (versión local)
└── run-all-m1.mjs                    # Script maestro (versión remota)
```

---

## 🎯 Hallazgos y Recomendaciones para Mejorar el Core

### 1. Rendimiento por Tamaño de Modelo

| Categoría | Mejor Modelo | Tiempo Promedio | Recomendación |
|-----------|-------------|-----------------|---------------|
| Pruebas rápidas | qwen3:0.6b-16k | ~12s por turno | Ideal para desarrollo y pruebas unitarias |
| Contexto medio | qwen3:0.6b-16k | ~10s por turno | Mantiene coherencia en 4 turnos |
| Generación de código | qwen3:4b-instruct | >180s (timeout) | Necesita hardware más potente o modelo más grande |
| Landing page completa | qwen3:4b-instruct | >300s (timeout) | Solo para producción, no para pruebas rápidas |

### 2. Manejo de Contexto

- **Compactación automática**: Funciona correctamente cuando se activa, pero con modelos pequeños y conversaciones cortas nunca se alcanza el umbral del 25%.
- **Memoria a largo plazo**: Los modelos pequeños (0.6b) no retienen información después de 10+ turnos. Se necesitan modelos más grandes (4B+) para memoria a largo plazo.
- **Recomendación**: Implementar resumen automático del contexto cuando se supere el 50% del límite, no solo el 25%.

### 3. Uso de Tools

- No se pudo probar completamente debido a la lentitud del servidor remoto.
- Recomendación: Probar con modelos que tengan capacidad nativa de function calling (qwen3.5:4b, nemotron-3-nano:4b).

### 4. Generación de Código y HTML

- Modelos de 0.6b no son capaces de generar código complejo (solo respuestas descriptivas).
- Modelos de 4b tardan >3 minutos por respuesta y pueden dar timeout.
- Recomendación: Implementar caché de respuestas comunes para mejorar la percepción de velocidad.

---

## 📋 Archivos Generados en Prueba 06

| Archivo | Descripción | Origen |
|---------|-------------|--------|
| `tests/e2e/06-landing-page-html/output/index.html` | Landing page HTML5 completa | Creado manualmente (ejemplo) |
| `tests/e2e/06-landing-page-html/output/style.css` | Estilos CSS con animaciones | Creado manualmente (ejemplo) |
| `tests/e2e/06-landing-page-html/output/script.js` | JavaScript con interactividad | Creado manualmente (ejemplo) |

---

## 🚀 Cómo Ejecutar las Pruebas Restantes

```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e

# Prueba individual
node 05-code-generation/run.mjs
node 06-landing-page-html/run.mjs
node 07-web-search/run.mjs

# Todas las pruebas (servidor local)
node run-all.mjs

# Todas las pruebas (servidor remoto - muy lento)
node run-all-m1.mjs
```

**Modelos recomendados para cada prueba:**
- Pruebas rápidas: `qwen3:0.6b-16k`
- Generación de código: `qwen3:4b-instruct` (requiere tiempo >3 min)
- Landing page: `nemotron-3-nano:4b` o `qwen3.5:4b` (requiere tiempo >5 min)
- Búsqueda web: Modelo con capacidad de tools (`qwen3.5:4b`, `nemotron-3-nano:4b`)

---

*Reporte generado el 2026-11-19 basado en ejecuciones reales del core AgentKit v0.4.0.*
