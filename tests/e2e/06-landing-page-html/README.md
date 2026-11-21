# E2E-06: Creación de Landing Page HTML (3 Archivos Separados)

Prueba que el core genere una landing page completa separada en 3 archivos: HTML, CSS y JavaScript.

## Requisitos
- Node.js >= 18
- Ollama ejecutándose (localhost o remoto)
- Modelo capaz de generar código: `nemotron-3-nano:4b`, `sorc/qwen3.5-instruct-uncensored:4b`, `qwen3.5:4b`, etc.

## Cómo ejecutar
```bash
cd /home/edwinspire/Desarrollo/libAgentKit/tests/e2e/06-landing-page-html
node run.mjs
```

## Qué mide
- Si el agente puede generar 3 archivos separados (HTML, CSS, JS) coherentes entre sí
- Si el HTML referencia correctamente al CSS y JS
- Si el CSS tiene estilos modernos y animaciones de botones
- Si el JavaScript tiene interactividad (menú móvil, formulario, eventos)
- Tiempo de generación de cada archivo
- Coherencia entre los 3 archivos

## Resultado esperado
El script genera 3 archivos en `output/`:
- `index.html` - Estructura HTML5
- `style.css` - Estilos CSS con animaciones
- `script.js` - Interactividad JavaScript