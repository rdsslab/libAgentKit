# Changelog

Todas las versiones relevantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
proyecto usa [versionado semántico](https://semver.org/lang/es/).

---

## [0.1.0] - 2026-11-17

### Added

- **Repositorio nuevo**: el harness de agente sale de `libOpenFusionAPI` (donde vivio
  como `src/lib/server/agentKit/` en las versiones 14.3.x) y pasa a ser un paquete
  independiente, `@rdsslab/agentkit`, distribuido por URL git.
  - Este repositorio es la **unica fuente de verdad** del harness. `libOpenFusionAPI`
    lo consume como dependencia y lo re-exporta, asi que su API publica no cambia.
  - El motivo de la extraccion: el harness estaba atado al ciclo de release de la
    plataforma (migracion de BD -> rebuild de Docker -> despliegue), que no es el
    ritmo que necesita una libreria que consumen bots, CLIs y agentes.
- **Modulo `artifacts` con el contrato `create_file`**: genera PDF, imagen, HTML,
  texto, JSON, Markdown y CSV.
  - El renderizador lo inyecta el host (`renderPdf`, `renderImage`): el paquete no
    depende de Chromium y la instalacion sigue siendo ligera.
  - `loadDefaultRenderer()` levanta un renderizador propio con `puppeteer-core` y
    `@sparticuz/chromium` mediante import dinamico, solo si el host los instalo.
  - Si falta el renderizador, la tool responde `ARTIFACT_RENDERER_UNAVAILABLE` en
    lugar de fallar en silencio.
- **Suite de tests de artefactos** (`dev/test/artifacts_test.js`): formatos de texto,
  JSON valido e invalido, HTML, truncado, contenido vacio, renderizador inyectado,
  fallo del renderizador y contrato de la tool.

### Changed

- **La capa de providers (`ia.js`) se carga bajo demanda**: importar el paquete ya no
  arrastra los SDK de OpenAI, Anthropic, Google GenAI y MCP. Se cargan la primera vez
  que corre `askAgent()` o cuando se importan explicitamente con
  `@rdsslab/agentkit/ia`. El nucleo (politicas, buffers, busqueda web) queda sin
  dependencias de provider.
- **`pdfjs-dist` se importa al extraer un PDF, no al cargar el paquete**: el bundle
  legacy de pdfjs pesa ~670 ms de carga. Importar el paquete paso de 693 ms a 24 ms;
  el coste se paga una sola vez, en la primera extraccion de PDF.
- **`safeFileName` endurezcido**: los nombres `..` y `.` se rechazan y se sustituyen
  por el nombre por defecto. Antes podian pasar como nombre de archivo y, si el host
  los concatenaba con un directorio, la escritura salia de el.
- **Nombres de cliente del protocolo MCP** ajustados al paquete (`agentkit-runtime` en
  lugar de `openfusion-ia-runtime`).
- **Requisito de Node.js aclarado: 22 o superior**. `pdfjs-dist` v6 usa
  `Promise.withResolvers`, que no existe en Node 20; en ese runtime la lectura de PDF
  fallaba con un mensaje que señalaba al PDF ("parece danado o protegido") y no al
  runtime. Ahora el error dice exactamente que falta Node 22
  (`PDF_RUNTIME_UNSUPPORTED`).

### Verified

- `dev/test/agentkit_test.js` (hermetico: sin red, sin BD, sin credenciales) y
  `dev/test/artifacts_test.js` en verde.
- Comportamiento heredado tal cual: las politicas de recall y de busqueda web
  multilenguaje, los parsers de busqueda, la extraccion de documentos, los registries
  STT/TTS y la extraccion de fotogramas de video siguen siendo los mismos que en
  `libOpenFusionAPI` 14.3.2.

---

[0.1.0]: https://github.com/rdsslab/libAgentKit/releases/tag/v0.1.0
