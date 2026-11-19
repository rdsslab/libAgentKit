# Changelog

Todas las versiones relevantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
proyecto usa [versionado semántico](https://semver.org/lang/es/).

---

## [Unreleased]

### Added

- **TUI interactiva (`npm run tui`)** sobre el motor existente (`askAgent`), sin nuevo runtime: encabezado con `cwd`/rama reales, historial con scroll, editor multilínea, paleta `Ctrl+P` y comandos `/`, estados de turno, cancelación con `Esc`/`Ctrl+C`, restauración de terminal y guard de TTY (sin TTY sale con código 2 y mensaje plano).
- **Ajustes editables desde la terminal**: proveedores (`ollama`, `openrouter`, `openai`, `openai-compatible`), modelo, base URL, token, modo, idioma, tema, capacidades, compactación y servidores MCP remotos (alta, edición, confianza y borrado). Guardado global (`0600`, tokens enmascarados o `env:VAR`) y guardado de proyecto (`stripSecrets()`).
- **Dos temas**, claro y oscuro, y panel lateral opcional con uso, herramientas y archivos recientes.
- **`@` para adjuntar archivos** dentro de `cwd` y aprobaciones/preguntas del motor resueltas desde la TUI.
- **Streaming opcional**: `onTextDelta` en `askAgent`, `askIAWithProviderMCP` y adaptadores OpenAI-compatible/Anthropic/Google, con fallback a la ruta no-streaming. Sin callback, el camino embebido permanece intacto. `onToolStart`/`onToolFinish` son observadores adicionales.
- **Nuevas suites**: `tui_test.js`, `tui_engine_test.js`, `streaming_test.js` y `tui_pty_test.js`; script `test:tui`.

### Changed

- `writeJsonFile` acepta `mode`; `saveGlobalConfig` escribe el config global con `0600`.
- `src/index.js` exporta `GLOBAL_CONFIG_MODE`, `resolveSecretReference` y `resolveConfigSecrets`.

### Notas

- No se implementa gestión de agentes ni visor de diffs: quedan como solicitudes futuras en [issue #1](https://github.com/rdsslab/libAgentKit/issues/1) e [issue #2](https://github.com/rdsslab/libAgentKit/issues/2).
- `Esc` aborta la petición al modelo; un hijo ya iniciado por `run_command` sigue sujeto a su propio timeout.

### Verified

- `npm test` (8/8 suites).

---

## [0.4.0] - 2026-11-18

### Added

- **Suite de demos reproducible (`demo/01`–`demo/07`)** con ejecución por modelo, captura de entorno/métricas y documentación de resultados.
  - Por prueba/corrida se registran duración total y por paso, uso de tokens (`prompt/completion/total`), `tokens_per_second`, `timing_ms`, contexto (`used/limit/percent/estimated`), rondas, diagnósticos de herramientas/web y validación/coherencia.
  - Artefactos de documentación: `demo/RESULTS.md` (comparación pre/post mejora, por modelo/prueba), `demo/_results/index.json`, `demo/_results/environment.json` y corridas timestamped + `latest.json`.

### Changed

- **Harness de herramientas más genérico y robusto (sin lógica hardcodeada por tarea):**
  - `src/terminal.js` (`run_command`): normalización/tokenización segura de llamadas mal formadas cuando se pasa la línea completa en `command` (p. ej. `"ip route get 1.1.1.1"`) hacia `{command,args}` **sin shell** (`spawn` con argv). Se preservan allowlist, resolución de binario, restricciones de `cwd/roots`, hooks de aprobación/validación, redacción de secretos, límites de tiempo/salida y auditoría; se expone información de normalización para diagnóstico.
  - `src/ia.js`: manejo recuperable de herramientas desconocidas (error estructurado con guía y herramientas disponibles en lugar de abortar la ejecución), alias genérico de nombres tipo binario a `run_command` cuando está disponible, truncado de resultados grandes de herramientas para reducir presión de contexto, y en `max_tool_rounds_exceeded` devolución de resultado parcial con diagnósticos/métricas (incluido `usage` cuando está disponible) en rutas soportadas.
  - `src/agent.js`: presupuesto/truncado de contexto inyectado (recaps de documentos y pre-búsqueda web, configurable) y propagación de señales de diagnóstico/ejecución (p. ej. `incomplete`, `reason`) para mejor observabilidad.
- **Búsqueda web (`src/websearch.js`)**: normalización de consultas, detección de páginas de anomalía/anti-bot/challenge para mejorar fallback, mejor manejo de proveedores/configuración y reporte de `providersTried`.
- **API/exportaciones y configuración**: exportaciones adicionales en `src/index.js` y módulos de soporte (`capabilities`, `config`, `clipboard`, `compaction`, `i18n`, `ollama`, `tui`) incluidos en el árbol de trabajo, junto con ajustes en buffers/documentos/artifacts y pruebas.

### Fixed

- Mejor tolerancia a errores de formato en llamadas de herramientas y mejor preservación de evidencia (ejecuciones parciales, uso y diagnósticos) en bucles largos o agotamiento de rondas.

### Verified

- `npm test` (4/4 suites) tras los ajustes del harness.
- Re-ejecución post-mejora de `demo/01`–`demo/07` (secuencial, 3 modelos locales): `qwen3:0.6b-16k` (2/7 fallos), `lfm3-omni:2b` (1/7), `qwen3:4b-instruct-8k` (1/7), con mejoras puntuales en uso de herramientas/recuperación y variabilidad/regresiones documentadas en `demo/RESULTS.md`.

---

## [0.3.0] - 2026-11-18

### Added

- **Transporte MCP por stdio**: un servidor MCP local arranca como proceso hijo y se
  habla con el por stdin/stdout. El transporte se importa bajo demanda, de modo que
  un despliegue que solo usa HTTP no paga por el.
  - Entrada: `{ command, args, env, cwd }`. El entorno del hijo es el del transporte
    (`getDefaultEnvironment`) mas el que declara la configuracion, no el del host.
  - El stderr del hijo se ignora: un servidor MCP ruidoso no ensucia el log del host.
- **Niveles de confianza por servidor**: `trusted` (por defecto), `untrusted` y
  `disabled`.
  - `trusted`: las tools se ofrecen al modelo y se ejecutan automaticamente.
  - `untrusted`: las tools se ofrecen, pero **cada llamada** necesita la decision del
    host mediante `approveToolCall`. Sin hook de aprobacion la llamada se rechaza:
    falla cerrado, porque "nadie vigila" no es una decision.
  - `disabled`: el servidor no se conecta y sus tools nunca se exponen.
- **Hook `approveToolCall`**: recibe `{ serverName, toolName, toolAlias, arguments }` y
  devuelve `true`/`false` (o `{ approved: true }`). Cableado en `askAgent`,
  `askIAWithMCP`, `askIAWithProviderMCP` y `AIProviderMCPClient`.
  - Una llamada rechazada no llega al servidor: se registra como ejecucion fallida
    (`TOOL_CALL_NOT_APPROVED`) y el modelo recibe el motivo.
- **Modulo `src/mcp.js`**: configuracion de servidores MCP.
  - `normalizeMcpServer` / `normalizeMcpServers`: normalizan nombre, transporte, URL,
    comando, argumentos, entorno, cabeceras y nivel de confianza. Una entrada sin
    nombre recibe el hostname de la URL o el basename del comando.
  - `findMcpConfig` / `loadMcpConfig` / `loadMcpServers`: lectura del fichero de
    configuracion.
  - `describeTrust`: descripcion legible de cada nivel.
- **Fichero de configuracion** (`~/.config/agentkit/config.json` por defecto):
  ```json
  {
    "mcpServers": {
      "files": { "url": "http://127.0.0.1:8931/mcp", "trust": "trusted" },
      "git": { "command": "mcp-server-git", "args": ["--repo", "/srv/repo"], "trust": "untrusted" },
      "old": { "url": "http://127.0.0.1:8932/mcp", "trust": "disabled" }
    },
    "terminal": { "allowedBinaries": ["git", "ls"] }
  }
  ```
  - El config del proyecto (`agentkit.config.json` o `.agentkit/config.json`) **no** se
    carga salvo que el host lo pida con `allowProjectConfig: true`: un repositorio
    puede traerlo, y un repositorio no es una frontera de confianza.
  - Un JSON invalido informa de la ruta exacta del fichero.

### Changed

- `ia.js` delega la normalizacion de servidores en `mcp.js`: una sola regla para
  nombre, transporte y confianza, en lugar de dos que podrian divergir.
- El catalogo y los diagnosticos de servidores incluyen ahora `command` y `trust`,
  para que un servidor stdio no aparezca con `url: null` y sin nivel de confianza.

### Verified

- `dev/test/mcp_test.js`: 15 comprobaciones (niveles de confianza, normalizacion de
  entradas y de mapas, lectura del config, JSON invalido, config del proyecto
  ignorado por defecto y con opt-in explicito, config de usuario, servidor stdio real
  conectado y con sus tools listadas, servidor `disabled` no conectado, entrada http
  sin URL con error claro, y cuatro comprobaciones de llamada a tool via modelo:
  `trusted` ejecuta, `untrusted` sin hook falla cerrado, `untrusted` aprobado ejecuta y
  `untrusted` rechazado no ejecuta).

---

## [0.2.0] - 2026-11-17

### Added

- **Tool `run_command`**: ejecuta un binario en el terminal. Inerte por defecto: sin
  lista de binarios permitidos, toda llamada se rechaza.
  - **Nunca hay shell**: `spawn(bin, args, { shell: false })`. `;`, `|`, `&&` y los
    acentos graves llegan como argumentos literales, no como sintaxis.
  - **Lista de binarios**: un nombre permite ese binario; una ruta absoluta permite
    exactamente ese fichero. Los nombres se resuelven por un PATH restringido
    (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`).
  - **El entorno no se filtra**: el hijo no hereda `process.env`; recibe un PATH
    restringido, `HOME` y el locale, mas lo que el host pase explicitamente. Las
    credenciales del host nunca llegan al comando.
  - **Aprobacion**: `approve()` puede vetar cada comando.
  - **Limites**: timeout (30 s por defecto, luego SIGKILL), tope de salida (256 KB) y
    maximo de comandos por turno (10).
  - **Redaccion de secretos** en la salida: `sk-…`, `ghp_…`, `github_pat_…`,
    `AKIA…`, tokens Bearer, JWT, bloques de clave privada y asignaciones del tipo
    `*_TOKEN=…`, mas los literales que registre el host.
  - **Auditoria**: `onAudit()` recibe cada decision, incluidas las denegadas.
  - Validacion de argumentos (`validateArgs`) y restriction del directorio de
    trabajo (`allowedRoots`).
- **`runProcess` acepta `env` y `cwd`**: el envoltorio de bajo nivel deja de
  depender de heredar el entorno del proceso.

### Verified

- `dev/test/terminal_test.js`: 21 comprobaciones (tool inerte sin lista, binario no
  permitido, ruta absoluta nominal, ausencia de shell, linea de comandos completa
  rechazada, secretos del host ausentes en el hijo, timeout, tope de salida,
  redaccion, hook de aprobacion, hook de validacion, hook de auditoria, limite por
  turno, directorio de trabajo restringido).

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
