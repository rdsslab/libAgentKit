# E2E-08: Contexto Largo con Compactación Automática (Umbral 25%)

Prueba que el core active la compactación automática cuando el contexto supere el 25% del límite del modelo.

## Requisitos
- Node.js >= 18
- Ollama ejecutándose en `http://192.168.100.126:11434`
- Modelo: `qwen3:1.7b` (ctx 40960) o similar con contexto limitado

## Cómo ejecutar
```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e/08-long-context-compaction
node run.mjs
```

## Qué mide
- Número de turnos necesarios para superar el umbral del 25% de contexto
- Si la compactación automática se activa cuando se supera el umbral
- Uso de contexto antes y después de la compactación
- Tiempo de respuesta en cada turno
- Si el modelo recuerda información de turnos anteriores después de la compactación

## Resultado esperado
El script ejecuta muchas conversaciones hasta superar el 25% de contexto, verifica que la compactación se active y que el contexto se reduzca.