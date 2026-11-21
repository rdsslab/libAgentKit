# E2E-03: Coherencia en las Respuestas

Prueba que el core mantenga coherencia en una conversación multi-turno, recordando información de mensajes anteriores.

## Requisitos
- Node.js >= 18
- Ollama ejecutándose en `http://127.0.0.1:11434`
- Modelo: `qwen3:0.6b-16k` o similar

## Cómo ejecutar
```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e/03-response-coherence
node run.mjs
```

## Qué mide
- Si el modelo recuerda información dada en turnos anteriores
- Coherencia entre respuestas consecutivas
- Número de turnos en la conversación
- Tiempo total de la conversación

## Resultado esperado
El script muestra una conversación de 4 turnos y verifica que el modelo recuerde detalles de turnos anteriores.