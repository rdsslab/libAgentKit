# E2E-04: Manejo de Contextos Largos

Prueba que el core maneje correctamente conversaciones largas con muchos mensajes, verificando que no se rompa y que el uso de contexto se mantenga dentro de límites razonables.

## Requisitos
- Node.js >= 18
- Ollama ejecutándose en `http://127.0.0.1:11434`
- Modelo: `qwen3:0.6b-16k` o `qwen3:4b-instruct` (con contexto grande)

## Cómo ejecutar
```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e/04-long-context
node run.mjs
```

## Qué mide
- Número de mensajes que el contexto soporta antes de degradarse
- Uso de contexto (tokens usados / límite)
- Si el core activa compactación automática cuando se excede el umbral
- Tiempo de respuesta en conversaciones largas

## Resultado esperado
El script ejecuta 10 turnos de conversación y muestra cómo crece el uso de contexto en cada turno.