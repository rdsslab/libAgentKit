# E2E-01: Tiempos de Respuesta

Mide el tiempo de respuesta del core `askAgent()` con diferentes modelos locales de Ollama.

## Requisitos
- Node.js >= 18
- Ollama ejecutándose en `http://127.0.0.1:11434`
- Al menos un modelo instalado en Ollama

## Cómo ejecutar
```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e/01-response-time
node run.mjs
```

## Qué mide
- Tiempo total de respuesta (ms)
- Tokens por segundo
- Tokens de entrada y salida
- Porcentaje de contexto usado
- Número de rondas de herramientas

## Resultado esperado
El script imprime una tabla comparativa con los tiempos de cada modelo.