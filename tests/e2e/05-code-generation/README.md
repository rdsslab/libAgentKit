# E2E-05: Creación de Código de Programación

Prueba que el core pueda generar código de programación funcional en diferentes lenguajes.

## Requisitos
- Node.js >= 18
- Ollama ejecutándose en `http://127.0.0.1:11434`
- Modelo: `qwen3:0.6b-16k`, `qwen3:4b-instruct`, o similar

## Cómo ejecutar
```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e/05-code-generation
node run.mjs
```

## Qué mide
- Si el modelo genera código válido en el lenguaje solicitado
- Si el código incluye comentarios y es legible
- Tiempo de generación
- Longitud del código generado

## Resultado esperado
El script genera código en JavaScript, Python y HTML, y verifica que contenga elementos característicos de cada lenguaje.