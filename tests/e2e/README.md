# Pruebas E2E - Core AgentKit

Este directorio contiene un conjunto de pruebas end-to-end (e2e) independientes para validar el funcionamiento del core de AgentKit (`@rdsslab/agentkit`).

## Runner canónico (recomendado)

`run_canonical.mjs` sustituye a los runners antiguos de las carpetas `01`–`08`.
Incluye P01 (respuesta), P02 (herramientas: IP local y búsqueda web real), P03
(coherencia), P04 (compactación), P05 (código) y P06 (landing page), y guarda
artefactos por modelo en `resultados_por_modelo/`.

```bash
node tests/e2e/run_canonical.mjs --suite=local
node tests/e2e/run_canonical.mjs --suite=remote --models=lfm3-omni:latest
node tests/e2e/run_canonical.mjs --suite=tools --output=RESUMEN_CANONICO_TOOLS.md
node tests/e2e/run_canonical.mjs --suite=idioma
node tests/e2e/run_canonical.mjs --suite=quality
```

Las carpetas numeradas y los `run_*.mjs` anteriores se conservan como
referencia histórica; para reportes nuevos usa el runner canónico.

## Estructura

```
tests/e2e/
├── 01-response-time/          # Tiempos de respuesta con diferentes modelos
├── 02-tool-usage/             # Uso de herramientas (calculator, web_search)
├── 03-response-coherence/     # Coherencia en conversación multi-turno
├── 04-long-context/           # Manejo de contextos largos y compactación
├── 05-code-generation/        # Generación de código (JS, Python, HTML)
├── 06-landing-page-html/      # Creación de landing page completa
└── 07-web-search/             # Búsqueda web con herramienta web_search
```

Cada carpeta contiene:
- `run.mjs` - Script ejecutable de la prueba
- `README.md` - Documentación de qué mide y cómo ejecutar
- `output/` - (opcional) Archivos generados por la prueba

## Requisitos generales

- Node.js >= 18
- Ollama ejecutándose en `http://127.0.0.1:11434`
- Al menos un modelo instalado en Ollama (recomendado: `qwen3:0.6b-16k`)
- Conexión a internet (para pruebas de búsqueda web)

## Cómo ejecutar todas las pruebas

```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e

# Prueba 01: Tiempos de respuesta
node 01-response-time/run.mjs

# Prueba 02: Uso de herramientas
node 02-tool-usage/run.mjs

# Prueba 03: Coherencia en respuestas
node 03-response-coherence/run.mjs

# Prueba 04: Contextos largos
node 04-long-context/run.mjs

# Prueba 05: Generación de código
node 05-code-generation/run.mjs

# Prueba 06: Landing page HTML
node 06-landing-page-html/run.mjs

# Prueba 07: Búsqueda web
node 07-web-search/run.mjs
```

## Cómo replicar en otro proyecto

1. Instala el core de AgentKit:
   ```bash
   npm install git+https://github.com/rdsslab/agentkit-core.git
   ```

2. Copia cualquier carpeta de prueba a tu proyecto y ajusta la ruta de importación:
   ```javascript
   import { askAgent } from "agentkit-core/src/agent.js";
   ```

3. Ejecuta con Node.js:
   ```bash
   node run.mjs
   ```

## Métricas recopiladas

Cada prueba recopila las siguientes métricas cuando están disponibles:

- **Tiempo de respuesta**: milisegundos transcurridos desde el envío hasta la respuesta completa
- **Tokens**: prompt_tokens, completion_tokens, total_tokens
- **Tokens por segundo**: velocidad de generación del modelo
- **Contexto**: used_tokens, limit_tokens, used_percent (porcentaje de contexto usado)
- **Rondas de herramientas**: número de veces que se invocó una herramienta
- **Éxito/fallo**: si la petición se completó sin errores

## Modelos recomendados para pruebas

| Modelo | Tamaño | Uso recomendado |
|--------|--------|-----------------|
| qwen3:0.6b | 0.5 GB | Pruebas rápidas, bajo consumo |
| qwen3:0.6b-16k | 0.5 GB | Contexto extendido (16k) |
| lfm3-omni:2b | 2.0 GB | Pruebas equilibradas |
| deepseek-r1:1.5b | 1.1 GB | Razonamiento lógico |

## Repositorios

- **Core**: `https://github.com/rdsslab/agentkit-core`
- **GUI**: `https://github.com/rdsslab/agentkit-gui`
