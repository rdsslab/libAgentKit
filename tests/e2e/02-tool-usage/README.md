# E2E-02: Uso de Tools (Herramientas)

Prueba que el core pueda usar herramientas disponibles a través de `toolHandlers` y MCP.

## Requisitos
- Node.js >= 18
- Ollama ejecutándose en `http://127.0.0.1:11434`
- Modelo: `qwen3:0.6b-16k` o similar

## Cómo ejecutar
```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e/02-tool-usage
node run.mjs
```

## Qué mide
- Si el modelo puede invocar una herramienta local (web_search simulada)
- Si el resultado de la herramienta se inyecta correctamente en la respuesta
- Número de rondas de herramientas ejecutadas
- Éxito/fallo de cada herramienta

## Resultado esperado
El script muestra qué herramientas se intentaron usar y si tuvieron éxito.