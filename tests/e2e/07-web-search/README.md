# E2E-07: Búsqueda Web

Prueba que el core pueda realizar búsquedas web a través de la herramienta `web_search` y usar los resultados en la respuesta.

## Requisitos
- Node.js >= 18
- Ollama ejecutándose en `http://127.0.0.1:11434`
- Modelo: `qwen3:0.6b-16k` o similar
- Conexión a internet (para búsqueda real)

## Cómo ejecutar
```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e/07-web-search
node run.mjs
```

## Qué mide
- Si el core invoca la herramienta de búsqueda web
- Si los resultados de búsqueda se inyectan en la respuesta
- Número de rondas de búsqueda ejecutadas
- Precisión de la información obtenida

## Resultado esperado
El script muestra los resultados de búsqueda y verifica que la respuesta contenga información relevante.