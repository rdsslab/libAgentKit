# Mejoras del harness — estado canónico

> Este documento reemplaza las conclusiones de los runners antiguos. Datos:
> `tests/e2e/run_canonical.mjs` (suites `local`, `remote`, `idioma`, `quality`),
> core v0.4.0 (`67570fd`), 2026-11-20, Node v24.21.0.
> Tests unitarios: **42/42 pasan** (`npm test`).
> Nota: la Tabla 3 de resultados se obtuvo antes de la "segunda ronda" de la
> sección 6; las cifras siguen siendo válidas como línea base, pero no reflejan
> los cambios de esa ronda.

## 1. Correcciones aplicadas

| Área | Antes | Ahora |
|---|---|---|
| `src/utils/response-cleaner.js` | Regex global con fuga de `lastIndex`; extraer código borraba markdown de chat | Sin estado entre llamadas, alias de lenguaje, `extractCodeBlocks()`, chat conservado |
| `src/agent.js` | `provider.system` / `provider.systemPrompt` ignorados | Se convierten en mensaje `system`, junto con `system` de nivel superior (deduplicado) |
| `src/agent.js` | Post-procesamiento destructivo por defecto | `responseProcessing` / `postProcess` opt-in; detección de rechazo y contenido mínimo separados |
| `src/agent.js` | `autoCompact` no conectado a la llamada | Compacta el historial **antes** del proveedor y expone `result.compaction` |
| `src/ia.js` | `top_k`, `repeat_penalty`, `options.num_ctx` enviados a `/v1/chat/completions` (rechazados por Ollama) | Parámetros universales por defecto; nativos solo con `sendNativeProviderParams` / `nativeProviderParams: true` |
| `src/ia.js` | Reintento con temperatura `0` la cambiaba a `0.1` y descartaba tool calls | `temperature: 0` se conserva; el reintento mantiene `tool_calls` |
| `src/utils/harness-improvements.js` | Reintentos con mensajes `tool` inválidos, import sobrante | Historial limpio (`system`/`user`), temperatura de reintento correcta, validación sintáctica y caché opcionales |
| `src/config/presets.js` | `getModelConfig()` devolvía un objeto que los runners pasaban entero como `provider` | Sigue devolviendo configuración plana por compatibilidad, con `system` dentro; los runners canónicos la consumen bien |

## 2. Utilidades nuevas (fuera del core del proveedor)

- `src/utils/syntax-validator.js`: `node --check` para JS y `ast.parse` para Python
  (con test omitido automáticamente si no hay `python3`).
- `src/utils/response-cache.js`: caché LRU con TTL y `createCacheKey()`.
- `src/utils/adaptive-timeout.js`: `suggestTimeoutMs()` y `TimeoutPolicy` con muestras reales.
- `src/utils/model-registry.js`: recomendaciones informativas por tarea/entorno.
- Exportaciones públicas añadidas en `src/index.js`.

`num_ctx` se mantiene como límite para métricas/compactación. Para cambiar
realmente la ventana de contexto en Ollama hay que usar Modelfile o la API
nativa `/api/generate`; el endpoint OpenAI-compatible lo ignora.

## 3. Resultados E2E canónicos

### Local vs remoto (P01–P06)

| Modelo / entorno | P01 | P02 | P03 | P04 | P05 | P06 |
|---|---|---|---|---|---|---|
| `lfm3-omni:2b` local | ✓ 5.253 ms | ip ✓ 12.194 ms / web ✓ 13.944 ms | ✓ recuerda nombre, clínica y servicios | compact 93→6 msgs, recuerda dato | 75 | 83 (HTML 91, CSS 75, JS 83) |
| `lfm3-omni:latest` remoto | ✓ 7.733 ms, 5.58 tok/s | ip ✓ 21.902 ms / web ✓ 39.117 ms | ✓ recuerda todo | compact 93→6 msgs, recuerda dato | 75 | 51 (HTML 91, CSS 63, JS ausente) |
| `qwen2.5-coder:3b` remoto | ✓ 33.125 ms | — | ✓ recuerda todo | compact 93→6 msgs, recuerda dato | 88 | 30 (solo HTML 91) |
| `qwen2.5:1.5b-instruct` remoto | ✓ 13.561 ms | — | ✓ recuerda todo | compact 93→6 msgs, recuerda dato | 75 | 30 (solo HTML 91) |

P04 fuerza `providerOverrides: { contextLength: 16384 }` para que el umbral del
25 % sea alcanzable y verificable (5900 tokens estimados = 36,01 %). Sin ese
override, la ventana real del modelo no dispara la compactación en una prueba
corta. Los modelos anteriores reportaban «no recuerda nada» porque **no se
enviaba el historial completo** a P03; ya está corregido.

P06 puntúa siempre tres archivos (HTML, CSS, JS). Un bloque ausente cuenta 0:
por eso HTML 91 + CSS 63 sin JS da 51. La puntuación no es solo pass/fail.

### P02: uso real de herramientas

P02 tiene dos subpruebas. La de IP expone un tool local `get_local_ip` calculado
con `os.networkInterfaces()` y exige que la respuesta contenga **la misma IP**
que devolvió el tool. La de web expone `web_search` contra DuckDuckGo real con
`preSearch: false`, y exige tres señales: tool invocado con éxito, results con el
dato y respuesta final fundamentada en ese dato (`Quito`).

| Modelo / entorno | `get_local_ip` | `web_search` | `tool_choice` forzado |
|---|---|---|---|
| `lfm3-omni:2b` local | ✓ 12.194 ms, IP `192.168.100.129` | ✓ 13.944 ms, DuckDuckGo, `Quito` | No hizo falta |
| `lfm3-omni:latest` remoto | ✓ 21.902 ms, IP `192.168.100.129` | ✓ 39.117 ms, DuckDuckGo, `Quito` | No hizo falta |
| `qwen2.5-coder:3b` remoto | ✓ 10.850 ms, IP `192.168.100.129` | ✓ 20.071 ms, DuckDuckGo, `Quito` | No hizo falta |

El runner registra cada ejecución de herramienta (nombre, argumentos, resultado
y `ok`) en `resultados.json`. Si un modelo pequeño ignora el tool, hay un segundo
intento con `toolChoice` forzado; se marca como `toolChoiceForzado: true` para no
confundir «sabe usar tools» con «acepta el empujón del harness». En la primera
ronda de P02 ninguno lo necesitó; `qwen2.5-coder:3b` sí falló la subprueba web
por un argumento mal formado y se corrigió en el core (ver §7).

### Calidad con `enhancedAskAgent` (suite `quality`)

| Modelo | Intentos | Mejoras aplicadas | Puntuación | Sintaxis |
|---|---|---|---|---|
| `lfm3-omni:2b` local | 2 | `system_prompt_code_en`, `fewshot_javascript`, `reintento_descartado_1` | 75 | válida |
| `lfm3-omni:latest` remoto | 2 | `system_prompt_code_en`, `fewshot_javascript`, `reintento_descartado_1` | 75 | válida |
| `qwen2.5-coder:3b` remoto | 1 | `...`, `validacion_ok_p100` | 100 | válida |

### Idioma del system prompt

Ver `IDIOMA_SYSTEM_PROMPT.md`: con `lfm3-omni:2b`, código JS 75/75 y sintaxis
válida en ES (30.841 ms) y EN (4.874 ms); web ES 45 (3 bloques, 69.752 ms) vs
EN 30 (solo HTML, 115.409 ms). Una sola muestra por celda: no generalizar sobre
velocidad.

## 4. Cómo reproducir

```bash
npm test

node tests/e2e/run_canonical.mjs --suite=local
node tests/e2e/run_canonical.mjs --suite=remote --output=RESUMEN_REMOTO.md
node tests/e2e/run_canonical.mjs --suite=tools --output=RESUMEN_CANONICO_TOOLS.md
node tests/e2e/run_canonical.mjs --suite=idioma --output=RESUMEN_IDIOMA_VALIDO.md
node tests/e2e/run_canonical.mjs --suite=quality --output=RESUMEN_CALIDAD_ENHANCED.md
```

Artefactos por suite y modelo en
`tests/e2e/resultados_por_modelo/canonico_<suite>__<entorno>__<modelo>/`
(`resultados.json` + `codigo_js.js`, `codigo_py.py`, `index.html`, `style.css`,
`script.js` según aplique). Resúmenes en `tests/e2e/RESUMEN_*.md`.

## 5. Recomendaciones derivadas

| Tarea | Modelo sugerido | Motivo |
|---|---|---|
| Chat corto remoto | `qwen2.5:1.5b-instruct` | 13,6 s, coherencia correcta |
| Código remoto | `qwen2.5-coder:3b` | Mejor puntuación (88–100) |
| Web / 3 archivos | `lfm3-omni:2b` local | Único que entregó HTML+CSS+JS en la suite local |
| Calidad con reintento | `qwen2.5-coder:3b` | Vote 100 en el primer intento |

Los runners `run_comparativo_*.mjs` y `run_e2e_presets.mjs` están marcados como
**superados**; no usarlos para nuevos reportes.

## 6. Segunda ronda: calidad y robustez del harness

Correcciones adicionales detectadas al auditar el código (solo `src/` y `tests/`):

| Archivo | Problema | Corrección |
|---|---|---|
| `src/utils/response-cleaner.js` | `extractCodeBlock(text, "javascript")` no reconocía bloques ```` ```js ```` y devolvía el primer bloque (HTML) en respuestas multi-archivo | Alias de lenguaje (`js`/`node`/`mjs`, `py`, `htm`) y selección del bloque por idioma antes que por posición |
| `src/utils/response-cleaner.js` | `No puedo creer...` en un comentario se detectaba como rechazo | Se ignoran las líneas de comentario al buscar negativas |
| `src/agent.js` | Varios mensajes `system` (nivel superior, preset e historial) llegaban por separado; algunos chat templates de modelos pequeños responden vacío | Se consolidan en **un único** mensaje `system`, deduplicado |
| `src/utils/system-prompts-en.js` | `taskType` = `js`, `html` o `css` caía al prompt genérico de `chat` | Alias a `code` / `web` |
| `src/utils/task-enhancer.js` | Si el llamador ya traía un mensaje `system`, se descartaban las reglas de tarea y el few-shot | Se añaden al último mensaje `system` sin duplicar |
| `src/utils/harness-improvements.js` | El reintento se aceptaba por ser más largo, sin revalidarlo, y repetía temperatura/seed | Revalidación del reintento, se acepta solo si puntúa igual o mejor, temperatura a la mitad y seed retirada; la contaminación también dispara corrección |
| `src/utils/response-cache.js` | La clave incluía `apiKey` y no distinguía `umbralPuntuacion`, `validarSintaxis`, etc. | Clave sin secretos y con todos los parámetros de calidad |
| `src/utils/output-validator.js` | Constante `HTML_TAGS_REQUIRED` sin uso | Eliminada |

### Utilidad nueva: `generateMultiFile()`

`src/utils/multi-file-generator.js` resuelve el fallo más repetido en P06: en
una sola respuesta, los modelos pequeños entregan el HTML pero omiten CSS y JS.
La utilidad divide la petición en **una llamada por archivo**, cada una con su
propio system prompt y su few-shot, y después reúne los bloques:

```js
import { generateMultiFile, MULTI_FILE_TEMPLATES } from "@rdsslab/agentkit";

const resultado = await generateMultiFile({
  provider: getModelConfig("lfm3-omni:2b", "web", { baseUrl: "http://localhost:11434" }),
  brief: "Landing responsive para una clínica veterinaria",
  files: MULTI_FILE_TEMPLATES.landing,
  validators: { css: (texto) => validarCSSSalida(texto) },
});
// resultado.archivos.html / .css / .js, resultado.faltantes, resultado.texto
```

Prueba real con `lfm3-omni:2b` local: **3/3 archivos** (HTML 1.604 chars,
CSS 1.321, JS 1.251) en ~126 s. Es más lento que una única llamada, pero
convierte un 0 en calidad (bloques ausentes) en tres archivos validables.
`stripWrapperTags()` elimina además los envoltorios `<style>`/`<script>` que
los modelos pequeños añaden aunque se les pida un archivo plano.

Para refrescar los números canónicos con esta revisión hay que volver a ejecutar
las cinco suites de la sección 4 (la nueva `tools` incluye P02).

## 7. Rerun de código: qué cambió y qué no

Se repitieron `quality`, `idioma`, `local` y `remote` con las correcciones de la
segunda ronda. Los JSON anteriores se conservaron con sufijo
`_baseline_pre_rerun` y los resúmenes como `*.baseline.md`.

| Suite / métrica | Antes | Después | Lectura |
|---|---|---|---|
| `quality` · `lfm3-omni:2b` local | 75, 2 intentos, 17.536 ms | 75, 2 intentos, 15.624 ms | Mismo código válido; aparece `reintento_descartado_1` |
| `quality` · `lfm3-omni:latest` remoto | 75, 2 intentos, 28.295 ms | 75, 2 intentos, 21.407 ms | Igual: el reintento malo se descarta en vez de reemplazar al bueno |
| `quality` · `qwen2.5-coder:3b` | 100, 1 intento, 52.690 ms | 100, 1 intento, 42.745 ms | Sin cambio de puntuación (ya estaba en el techo) |
| `idioma` · código ES/EN | 75 / 75, sintaxis válida | 75 / 75, sintaxis válida | Sin cambio; única diferencia, tiempos |
| `idioma` · web ES/EN | 45 / 30 | 45 / 30 | Sin cambio |
| P05 `local` · `lfm3-omni:2b` | 75 | 75 | Sin cambio |
| P06 `local` · `lfm3-omni:2b` | 55 (JS presente pero no puntuado) | **83** (JS 83, sintaxis válida) | Mejora real por bug del harness |
| P05/P06 `remote` | 75/51, 88/30, 75/30 | 75/51, 88/30, 75/30 | Sin cambio |

### Bug de P06 corregido

`extractCodeBlocks()` normaliza ` ```js ` a `language: "javascript"`, pero el
runner canónico guardaba los bloques bajo esa clave y después buscaba
`bloques.js`. Resultado: el bloque JavaScript existía, pero se puntuaba como
ausente. Se añadió `normalizeBlockKey()` en `run_canonical.mjs` y el mismo
modelo pasó de **55 a 83** sin cambiar su respuesta: el JS ya se extrae y su
sintaxis se valida.

### Bug de tools corregido

`qwen2.5-coder:3b` llamó a `web_search` con el argumento mal formado:

```json
{ "query": { "type": "string", "description": "Search query.", "value": "capital de Ecuador" } }
```

El handler veía `[object Object]`, la búsqueda volvía vacía y el modelo
respondía `Quito` de memoria: P02 web fallaba aunque el tool se hubiera
invocado. `normalizeToolArguments()` en `src/ia.js` ahora desenvuelve objetos
que solo contienen `value` + metadatos de schema, y el handler de `web_search`
tiene una segunda línea de defensa. P02 web de `qwen2.5-coder:3b` pasó a ✓ con
`query: "capital de Ecuador"` y resultado de DuckDuckGo. Hay test unitario
nuevo (en ese momento 43/43; la revisión actual tiene 51/51, ver §8).

## 8. Ronda 3: métrica funcional, seguridad, estabilidad y adapter nativo

Se implementaron las cinco áreas pendientes. Todo sigue sin commit ni push.

| Mejora | Dónde | Resultado |
|---|---|---|
| Validación funcional de código | `tests/utils/code-behavior.js`, integrada en `scoreCode()`, P05, P06 y `quality` | Nueva métrica `funcional`, ejecutada en VM/subprocess con timeout |
| Capabilities fail-closed | `src/policies.js` (`shouldRunPreSearch`), `src/agent.js` | `web:false` o `tools.web_search:false` ya no lanzan pre-search; `{mcp:{enabled:false}}` no conecta servidores |
| `toolChoice` sanitizado | `tests/utils/e2e-helpers.js`, `run_canonical.mjs` | `Get-Local.IP` → `get_local_ip`, igual que `sanitizeToolNamePart()` del core |
| Estabilidad/optimización | `multi-file-generator.js`, `run_canonical.mjs`, `ia.js` | `parallel`/`concurrency` opcionales, `--offline`, comparador de baselines, fix de `webSearchOptions`, sin retry al haber tool calls |
| Adapter nativo | `src/ia.js` (`ollama-native`) | `/api/chat` con `num_ctx`, `top_k`, `repeat_penalty` y `num_predict` reales |

### 8.1 Qué significa ahora «funcional»

Antes un `isValidEmail` que siempre devolviera `true` podía sacar 75–100 si
tenía comentarios y sintaxis válida. Ahora:

- JavaScript se ejecuta en `node:vm` con timeout de 2 s y seis casos
  (válidos, sin `@`, sin punto, vacío, con espacio).
- Python se ejecuta en `python3` con timeout de 5 s contra un archivo real y
  uno inexistente; `input()` queda bloqueado.
- La landing se comprueba por «wiring»: IDs referenciados por el JS que deben
  existir en el HTML, eventos, enlaces a `style.css`/`script.js` y reglas CSS.
- La puntuación antigua (`calidad.puntuacion`) se conserva para comparar con
  baselines; `calidad.funcional` y `funcionalMedia` son columnas nuevas.

Resultados reales de esta ronda (una muestra por celda, no generalizable):

| Suite | Modelo | Calidad | Funcional |
|---|---|---|---|
| `quality` | `lfm3-omni:2b` local | 75 | **100** (6/6 casos) |
| `quality` | `lfm3-omni:latest` remoto | 75 | **100** (6/6) |
| `quality` | `qwen2.5-coder:3b` remoto | 100 | **100** (6/6) |
| P05 local | `lfm3-omni:2b` | 75 | **100** (JS + Python) |
| P06 local | `lfm3-omni:2b` | 83 | **100** (wiring HTML/JS) |

En estos ejemplos el código generado sí hacía lo pedido: la mejora es que el
harness ya puede demostrarlo en vez de asumirlo. El validador vive en `tests/`,
no en el core, y no añade dependencias al proveedor.

### 8.2 Errores del harness corregidos de paso

- **`webSearchOptions` no llegaba a `askAgent`.** El runner pasaba la clave
  `webSearchOptions`, pero `askAgent` lee `webSearch`. Ahora los límites
  (`maxResults`, `timeoutMs`, `maxInjectedContextChars`) se aplican de verdad.
- **Retry desperdiciado con tool calls.** El core reintentaba cuando el texto
  estaba vacío, aunque la respuesta ya contuviera `tool_calls` (el texto suele
  estar vacío por diseño). Ahora no reintenta en ese caso: el test del adapter
  nativo pasó de 4 peticiones a 2.
- **`toolChoice` forzado sin sanitizar.** El fallback de P02 construía el
  nombre crudo; ahora usa el mismo patrón `[^a-z0-9_]+ → _` que el core.

### 8.3 Estabilidad y comparación

- `node tests/e2e/run_canonical.mjs --suite=tools --offline` sustituye
  DuckDuckGo por un fixture con `Quito`, sin red. Los artefactos llevan
  sufijo `__offline` para no sobrescribir los reales. Las tres ejecuciones
  offline de P02 pasaron (local y dos remotos).
- `node tests/e2e/compare_baselines.mjs` compara cada `canonico_*` con su
  `_baseline_pre_rerun`: booleanos que pasan a `false` o bajadas > 5 puntos son
  regresión. Duración es informativa salvo `--check-duration`. Última corrida:
  **8 suites comparadas, 0 regresiones** (`RESUMEN_COMPARACION.md`).
- `generateMultiFile({ parallel: true, concurrency: 3 })` usa un pool acotado;
  el valor por defecto sigue siendo secuencial para no cambiar el comportamiento
  en iGPU/RAM limitada. Test unitario: concurrencia 1 vs 2 verificada.

### 8.4 Adapter `ollama-native`

`provider: "ollama-native"` usa `/api/chat` en lugar de `/v1/chat/completions`:

- `options` incluye `num_ctx` (ventana real), `top_k`, `repeat_penalty`, `seed`,
  `temperature`, `top_p` y `num_predict`.
- Convierte tools y tool calls al formato nativo, mantiene los IDs para los
  mensajes de rol `tool` y soporta streaming NDJSON.
- `tool_choice` con función concreta se mapea a `"required"` (Ollama no permite
  fijar una función específica).

Validación: test unitario con servidor HTTP simulado (comprueba la body
`/api/chat`, `num_ctx:4096`, `top_k:17`, `repeat_penalty:1.2`, ejecución de tools
y mensaje `tool_name`), prueba rápida contra Ollama local y suite completa
`--suite=local --provider=ollama-native`:

| Métrica | OpenAI-compatible | `ollama-native` |
|---|---|---|
| P01 | ✓ 5.299 ms | ✓ 15.044 ms |
| P02 | ip ✓ / web ✓ | ip ✓ / web ✓ |
| P03 / P04 | memoria ✓ / compact 93→6, recuerda ✓ | igual |
| P05 / P06 | 75 / 83 | 75 / 83 |
| Funcional P05 / P06 | 100 / 100 | 100 / 100 |

La diferencia de latencia es de una sola muestra; el punto del adapter no es
ir más rápido, sino que `num_ctx` deje de ser solo una métrica.

### 8.5 Estado

- `node --check` en runner y `src/ia.js`: OK.
- `npm test`: **51/51** (8 tests más que los 43/43 de la ronda anterior:
  validación funcional ×3, paralelismo, preSearch/capabilities ×2,
  sanitización de tools y adapter nativo).
- Resúmenes nuevos: `RESUMEN_CANONICO_NATIVO.md`,
  `RESUMEN_CANONICO_TOOLS_OFFLINE.md`, `RESUMEN_COMPARACION.md`.
- No se hicieron commits ni pushes.

## 9. Ronda 4: calidad real de la salida (harness únicamente)

Cinco mejoras seleccionadas para atacar la calidad, no solo la puntuación.
Ninguna toca la GUI ni añade validación de lenguaje al núcleo del proveedor.

### 9.1 Validación funcional dentro del bucle de auto-corrección

`enhancedAskAgent()` acepta un hook opcional:

```js
validarComportamiento: ({ texto, taskType, lenguaje }) => validateCodeBehavior(texto, lenguaje),
validarComportamientoId: "code-behavior-v1"
```

- La puntuación final de cada intento es `min(validación léxica, funcional)`.
  Un `isValidEmail` que compila pero devuelve `true` para todo baja a 17 y
  dispara el reintento; antes solo se miraban comentarios/sintaxis.
- Los casos fallidos se convierten en problemas concretos del prompt de
  corrección (`caso funcional "email_invalido" falló: devolvió true`).
- El hook vive en `tests/utils/code-behavior.js`; el core sigue agnóstico.
- `createCacheKey()` identifica el hook por `validarComportamientoId` para que
  una función no colapse la clave serializada a `undefined`.

### 9.2 Reintento quirúrgico de archivos faltantes en P06

`MAX_TOKENS.web` es 600 en remoto: el tercer bloque se truncaba con frecuencia.
Ahora, si faltan `html`/`css`/`js` (contando assets incrustados), el runner
pide **solo** el archivo ausente con un prompt mínimo y el doble de techo
(`min(2 × MAX_TOKENS.web, 1800)`). `mergeBlocks()` conserva el primero válido
de cada idioma. El campo `continuacion` del artefacto registra faltantes,
duración y `maxTokens`.

Ejemplo real (`lfm3-omni:latest`, remoto):

| Antes | Después |
|---|---|
| P06 calidad 55, funcional 57%, bloques `html,css` | P06 calidad **83**, funcional **71%**, bloques `html,css,js` |
| Continuación anterior: 144.833 ms, regeneraba todo y truncaba `js` | Continuación: **26.008 ms**, `maxTokens=1200`, bloque `js` completo |

### 9.3 Prompt y scorer alineados

Los presets y los system prompts ES/EN decían «no uses bloques Markdown»,
mientras los scorers esperan bloques etiquetados. Ahora:

- Una sola función → código sin cercos (sigue funcionando el fallback de
  `firstBlock()`).
- Varios archivos → un bloque cercado por archivo con etiqueta `html`, `css`,
  `js`, sin texto entre bloques.

### 9.4 Idioma del system prompt auto-detectado

`idiomaSystemPrompt` admite `"auto"` (por defecto) y detecta marcadores del
último mensaje de usuario; si no hay evidencia, mantiene `"en"`. El runner de
`quality` ya no fija `"en"` con prompts en español. `runQuality` reporta
`diagnosticos.idiomaEfectivo` y la lista `mejorasAplicadas` incluye
`system_prompt_code_es`. La suite `idioma` sigue forzando ES/EN para comparar.

### 9.5 Normalización genérica de argumentos y contexto en retries

- `src/utils/tool-arguments.js` centraliza el unwrap de
  `{type, description, value}` (con envoltorios anidados) y lo usa tanto
  `src/ia.js` como `src/agent.js`, de modo que también los handlers inyectados
  reciben valores limpios. Se exporta desde `src/index.js`.
- `construirMensajesRetry()` sigue descartando mensajes `tool` (para no enviar
  `tool_result` huérfanos), pero añade un resumen compacto de tools y
  resultados web ya ejecutados, marcado como
  `CONTEXTO DE HERRAMIENTAS YA EJECUTADAS`.

### 9.6 Verificación

- `npm test`: **58/58** (7 tests nuevos: idioma ×2, hook funcional, recap de
  tools, unwrap anidado, clave de caché y fusión de bloques).
- `node --check` OK en los 11 archivos JS/MJS modificados.
- Suite local canónica: P01 ✓, P02 ✓/✓, P03 ✓, P04 ✓, P05 75/func 100,
  P06 79/func 100, bloques `html,css,js`.
- `quality`: `lfm3-omni:2b` y `lfm3-omni:latest` 75/func 100 con retry
  descartado; `qwen2.5-coder:3b` 100/func 100 sin retry.
- Revalidación completa posterior: `tools --offline` (3/3 ✓/✓), `tools` real
  (3/3 ✓/✓), suite local con `--provider=ollama-native` (P01–P04 ✓,
  P05 75/func 100, P06 79/func 100) y `remote --models=qwen2.5-coder:3b`
  (P05 100/func 75, P06 **83/func 100**; el baseline tenía calidad 30 y
  aún no registraba la métrica funcional).
- Durante esa revalidación apareció un fallo de estabilidad: P06 de
  `qwen2.5-coder:3b` abortaba a los 200 s por el techo del `TimeoutPolicy`,
  dando un 0/0 falso. Se subió `maxMs` a 300000 en el runner y la repetición
  terminó correctamente.
- `compare_baselines.mjs`: **8 suites, 0 regresiones** (tras el arreglo).
- Resúmenes: `RESUMEN_CANONICO.md`, `RESUMEN_CANONICO_CALIDAD.md`,
  `RESUMEN_CANONICO_REMOTO_LFM3.md`, `RESUMEN_CANONICO_REMOTO_QWEN.md`,
  `RESUMEN_CANONICO_TOOLS.md`, `RESUMEN_CANONICO_TOOLS_OFFLINE.md`,
  `RESUMEN_CANONICO_NATIVO.md`, `RESUMEN_COMPARACION.md`.
- No se hicieron commits ni pushes.
