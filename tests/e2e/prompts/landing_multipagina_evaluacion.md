# Evaluación del prompt `landing_multipagina.md`

Este documento acompaña al prompt de `tests/e2e/prompts/landing_multipagina.md`.
No modifica el runner: P06 sigue siendo la corrida canónica y esta propuesta se
ejecutaría como una suite nueva (`web-complex`) para no romper las 8 comparativas
de `RESUMEN_COMPARACION.md`.

## 1. Qué estrés añade frente a P06

| Dimensión | P06 actual | Este prompt |
|---|---|---|
| Archivos | 3 (`html`, `css`, `js`) | 6 (4 HTML + CSS + JS) |
| Parser | `blocksByLanguage()` colapsa todos los `html` en uno | Necesita clave por ruta/`html-<slug>` |
| Enlaces | Un solo HTML | 4 HTML con hrefs relativos entre sí |
| Estado JS | Un formulario y eventos | Tema persistente, toggle de precios, acordeón, nav, progreso |
| Calidad visual | `:root`, `:hover`, `@media` | Tokens, `clamp()`, animaciones, anti-plantilla, reduced-motion |
| Funcionalidad | Regex de IDs y eventos | Requiere ejecución con DOM stub y simulación de interacciones |
| Presupuesto | `MAX_TOKENS.web` = 600 remoto | Insuficiente: 6 bloques se truncarán |

## 2. Rúbrica propuesta (separada de `calidad.puntuacion`)

Mantener `calidad.puntuacion` intacto para baselines y añadir ejes nuevos:

| Eje | Peso | Qué medir |
|---|---:|---|
| `contratoSalida` | 10 | 6 bloques, etiquetas exactas, comentario de nombre de archivo, cero prosa fuera |
| `estructuraMultipagina` | 15 | 4 HTML no vacíos, `<title>` por página, nav coherente, hrefs que resuelven, `data-page` correcto |
| `calidadDiseno` | 20 | `:root`, `clamp()`, `box-sizing`, `prefers-reduced-motion`, `:focus-visible`, rejilla asimétrica, SVG inline |
| `funcionalidad` | 25 | Handlers registrados y simulables: nav, tema, acordeón, precios, formulario, progreso, sin excepciones |
| `accesibilidad` | 10 | Landmarks, `h1` único, labels, `aria-expanded`/`aria-describedby`, skip link |
| `robustez` | 10 | Sin CDN/fetch/eval/handlers inline, sin `Lorem ipsum`, funciona por `file://` |
| `originalidad` | 10 | Ausencia de los anti-patrones listados en el prompt; copy concreto y no relleno |

`funcional` y `originalidad` deben reportarse como campos propios, igual que se
hizo con el hook `validarComportamiento`, no mezclarse en el score histórico.

## 3. Oportunidades concretas de mejora del harness

### 3.1 Parser con conocimiento de rutas

`extractCodeBlocks()` en `src/utils/response-cleaner.js` acepta etiquetas
`[\w-]+`, así que `html-index` se extrae bien. El problema está aguas abajo:

- `normalizeBlockKey()` en `tests/utils/e2e-helpers.js` solo colapsa `html|htm`.
- `blocksByLanguage()` guarda `html-index`, `html-servicios`, ... como claves
  distintas, por lo que `missingBlockLanguages()` (constante `LANDING_FILES =
  ["html", "css", "js"]`) vería `html` como faltante y dispararía una
  continuación innecesaria.

Propuesta: nuevo helper `blocksByPath(text)` que devuelva
`{ "index.html", "servicios.html", "precios.html", "contacto.html", "style.css", "script.js" }`
usando la etiqueta del bloque y, como respaldo, el comentario de primera línea.
Mantener `blocksByLanguage()` para P06 y baselines.

### 3.2 Continuación por bloque, no por idioma

Hoy `runP06()` calcula `faltantes` sobre `html|css|js` y pide solo esos bloques
con `maxTokens = min(2 × web, 1800)`. Con 6 archivos hace falta:

- una lista de bloques esperados inyectada por suite;
- comparar la lista esperada contra `blocksByPath()`;
- pedir `html-precios` o `script.js` por su nombre exacto;
- un techo distinto por bloque (HTML de página ≈ 700, CSS ≈ 1200, JS ≈ 1200).

### 3.3 Presupuesto y timeout por suite

`MAX_TOKENS[target.label].web` está ajustado para 3 bloques pequeños. Añadir
`web-complex` con un techo propio (p. ej. 4000 remoto / 6000 local) y medir
`duracionMs` y `tokens` por página. `TimeoutPolicy.maxMs` de 300000 s puede
quedar corto con modelos lentos: medir antes de subirlo.

### 3.4 Validación funcional con DOM stub

`validateLandingWiring()` en `tests/utils/code-behavior.js` es solo regex sobre
un HTML. Proponer `validateMultiPage({ pages, css, js })` con dos capas:

1. **Estática**: cada `.html` enlaza `style.css`/`script.js`; todo `href="*.html"`
   existe en `pages`; los IDs usados por `getElementById`/`querySelector('#…')`
   existen en alguna página; `data-page` coincide con el nombre de archivo.
2. **Dinámica**: ejecutar `js` en `vm` con un stub mínimo de `document`,
   `window`, `localStorage`, `IntersectionObserver` y `location`, y afirmar que:
   - se registran `click`, `submit`, `DOMContentLoaded` y `keydown`;
   - el toggle de precios cambia el texto de `[data-mensual]`/`[data-anual]`;
   - un formulario inválido pone `aria-invalid="true"`, llama a `focus()` y no
     muestra el mensaje de éxito;
   - un formulario válido muestra el éxito sin `fetch`;
   - el theme toggle escribe en `localStorage` y cambia `data-theme`.

Reutilizar el patrón de `summarize()`/`casos` para conservar el formato
`{ soportado, ok, puntuacion, casos }`.

### 3.5 Detección de "no genérico"

Añadir comprobaciones baratas y auditables, no juicios subjetivos:

- `@keyframes` ≥ 2, `@media` ≥ 2, `prefers-reduced-motion` presente.
- `:focus-visible`, `clamp(`, `stroke="currentColor"`, `aria-hidden="true"`.
- Ausencia de `Lorem|lorem`, emoji, `#667eea`, `linear-gradient(135deg`,
  `onclick=`, `eval(`, `https?://`, `fetch(`, `type="module"`.
- Número de tokens de paleta en `:root` ≥ 4 y de reglas CSS ≥ 20.

Esto convierte "diseño no genérico" en una métrica reproducible y explicable,
manteniendo la calificación visual humana como capa opcional.

### 3.6 Aislamiento de la suite

Registrar el resultado como `canonico_web-complex__<entorno>__<modelo>/` dentro
de `tests/e2e/resultados_por_modelo/`, con `metadata.suite = "web-complex"` y
el `seed` usado. No sustituir P06: `compare_baselines.mjs` debe seguir
comparando las 8 suites actuales y añadir esta como nueva referencia.

## 4. Riesgos del propio prompt

- **Longitud**: es probable que modelos de 2–3B truncen aunque se les pida
  "6 bloques breves". Eso es señal útil, pero hay que distinguir truncamiento de
  falta de capacidad: guardar `tokens`, `finishReason` y bloques recuperados.
- **Idioma**: el system prompt `web` está en español; si se prueba con
  `idiomaSystemPrompt: "en"` conviene traducir también el prompt para no medir
  cambio de idioma en lugar de cambio de modelo.
- **Repetición**: los modelos suelen repetir el bloque `html-index` en los otros
  tres HTML. El validador de `href`s y de `data-page` debe fallar explícitamente
  ese caso en lugar de darlo por válido.
- **`file://` y `location.pathname`**: en algunos navegadores el pathname incluye
  el nombre de archivo con codificación; el validador debe aceptar tanto
  `precios.html` como `%70recios.html`, pero no un `router` inventado.

## 5. Estado

Implementado en el runner canónico como suite `web-complex`:

- `blocksByPath()`, `missingBlockPaths()`, `mergePathBlocks()` y
  `blockTagForPath()` en `tests/utils/e2e-helpers.js` (3.1).
- Generación **por archivo por defecto** con etiqueta exacta y techo propio
  (`html` 900, `css`/`js` 1400 tokens) en `runWebComplex()` (3.2). El modo
  monolítico sigue disponible con `--web-generacion=monolitico`.
- Presupuesto `MAX_TOKENS["web-complex"]` (6000 local / 4000 remoto) y
  `TimeoutPolicy.maxMs = 420000` solo para esta suite (3.3).
- `validateMultiPage()` + `createDomStub()` comprueban enlaces, `data-page`,
  anti-plantilla e interacciones simuladas (nav, tema, FAQ, precios,
  formulario, reveal y progreso) (3.4 y 3.5).
- Artefactos en `canonico_web-complex__<entorno>__<modelo>/`; P06 y las 8
  comparativas de `RESUMEN_COMPARACION.md` quedan intactos (3.6).

Uso:

```bash
node tests/e2e/run_canonical.mjs --suite=web-complex --models=qwen2.5-coder:3b
```

El prompt añade hooks explícitos (`data-nav-toggle`, `data-theme-toggle`,
`data-faq-toggle`, `data-price-toggle`, `data-contacto`, `data-form-exito`,
`data-scroll-progress`, `data-reveal`) para que la simulación sea determinista.
`data-contacto` también se acepta como `querySelector('form')` para no penalizar
código equivalente.

## 6. Hallazgos de la primera corrida real (`qwen2.5-coder:3b`)

Artefacto conservado como `canonico_web-complex__remoto__qwen2.5-coder_3b_monolitico_baseline/`.

| Métrica | Valor |
|---|---:|
| Calidad media | 81 |
| Funcional | 64% |
| Originalidad | 71% |
| Archivos entregados | 6/6 (todos por continuación) |
| Duración total | 855 s |

**Hallazgo de harness 1 — llamada monolítica inútil.** La primera petición
agotó 300 s con `maxTokens=4000` y no devolvió ningún bloque; los seis archivos
vinieron de continuaciones de 42–153 s cada una. Por eso el modo por defecto
ahora genera archivo por archivo desde el principio. El modo monolítico queda
solo como prueba de estrés.

**Hallazgo de harness 2 — hooks ambiguos.** El modelo interpretó
`data-nav-toggle` etc. como *valor* de atributo (`getAttribute()` devuelve un
selector) y como `id="data-contacto"`. El stub ahora da valores de selector
reales a los hooks y acepta tanto `aria-expanded` como cambios de `classList`;
`data-contacto` también se acepta como `querySelector('form')`.

**Hallazgo de modelo — fallos legítimos detectados.** Enlaces solo `#anchor` en
lugar de `.html`, `header` sin `nav`, IDs `name`/`message` que no existen en el
HTML (`nombre`/`mensaje`), ausencia de `data-mensual`/`data-anual`, sin `clamp()`
y sin SVG inline. El validator los marcó correctamente como fallos de
funcionalidad/originalidad, no del harness.

Después de estos ajustes se relanzó la misma suite para medir el efecto del
cambio de modo de generación y del stub más tolerante. En ese momento la
batería quedó en **63/63** tests (uno nuevo para hooks con selector,
`classList` y `alert`); tras el diagnóstico de §6.1 y el re-escore de §6.2
quedó en **65/65**.

### 6.1 Regresión del primer intento `por-archivo` (diagnóstico y corrección)

El primer relanzamiento con el nuevo modo por defecto fue **peor** que el
baseline: calidad 10, funcional 42%, originalidad 43% y solo 1/6 archivos
(`script.js`), con 1492 s de duración. No era una medida honesta del modelo:

| Causa | Evidencia | Corrección |
|---|---|---|
| El prompt de cada archivo incluía **el contrato completo de 6 bloques** y además «ignora el contrato anterior, entrega solo X». | Cada llamada HTML tardó ~200 s (vs 42–153 s de las continuaciones cortas del baseline). | `instruccionArchivo()` usa un prompt corto con contexto mínimo y la instrucción de fences explícita. |
| Respuestas truncadas con fence de apertura sin cierre. | 6 delimitadores ``` en cinco respuestas; solo `script.js` tenía bloque cerrado. | `blockForPath()` exige bloque cerrado y `fenceBalance()` detecta truncamiento para reintentar una vez. |
| `respuestaCruda` concatenaba textos de llamadas distintas. | El parser encontraba 3 archivos en la concatenación pero 1 al parsear cada respuesta por separado: el fence de apertura de la llamada N se cerraba con el de la N+1. | Cada respuesta se guarda en `respuestasPorLlamada` y se parsea **independientemente**; la concatenación ya no se re-parsea. |
| `style.css` abortó a 420004 ms. | Error `Request was aborted.` tras cinco llamadas lentas seguidas. | Prompts cortos + reintento acotado + deadline de pared de 15 min (`deadlineAlcanzado`) para no repetir corridas de 25 min. |

Se añadió además un test unitario que verifica que un fence sin cerrar **no**
produce bloque y que una etiqueta genérica `html` sí se acepta en modo por
archivo. La batería quedó en **64/64**.

### 6.2 Resultado del relanzamiento corregido (`qwen2.5-coder:3b`)

| Métrica | Baseline monolítico | Por archivo corregido | Δ |
|---|---:|---:|---:|
| Calidad media | 81 | **85** | +4 |
| Funcional | 64% | **86%** | +22 |
| Originalidad | 71% | 71% | 0 |
| Archivos entregados | 6/6 | 6/6 | — |
| Duración total | 855 s | **599 s** | −256 s |
| Llamadas | 1 + 6 continuaciones | 6 (sin reintentos) | — |

Los seis archivos se entregaron al primer intento (`fences=2`, `bloqueExtraido=true`,
`fuente=path`), sin aborts ni deadline. Funcional pasó de 72% a **86% tras
arreglar el stub** (`nextElementSibling`, `FormData`, `classList` propio y
`style.display`) re-escorando el **mismo código generado**: esos 14 puntos eran
limitaciones del evaluador, no del modelo. El re-escore queda registrado en
`resultados.json` bajo `reescorado`.

Los fallos que sí son del modelo y siguen midiéndose: `h1_unico`,
`data_page_por_pagina` (puso `data-page` en `<header>`), `css_clamp`,
`html_svg_inline` y los hooks `data-mensual`/`data-anual`.

## 7. Comparación entre modelos

Resumen consolidado en `RESUMEN_CANONICO_WEB_COMPLEX.md`.

| Modelo | Entorno | Calidad | Funcional | Originalidad | Archivos | Duración |
|---|---|---:|---:|---:|---:|---:|
| `qwen2.5-coder:3b` | remoto | 85% | 86% | 71% | 6/6 | 599 s |
| `lfm3-omni:2b` | local | 56% | 39% | 43% | 5/6 | 411 s |
| `qwen2.5-coder:3b` (monolítico) | remoto | 81% | 64% | 71% | 6/6 | 855 s |

La suite nueva **sí discrimina** donde P05/P06 no lo hacían: en los informes
anteriores ambos modelos estaban en 75–100% funcional (P05/P06), mientras que
aquí `qwen2.5-coder:3b` sostiene 86% con seis archivos y `lfm3-omni:2b` cae a
39% y no entrega `script.js`.

El fallo de `lfm3-omni:2b` es legítimo y no se maquilló: la respuesta de JS
tenía **un solo delimitador ```** en dos intentos de 115 s cada uno, con un
bucle de repetición (`guardarDataNavToggle`, `guardarDataThemeToggle`, ...),
variables sin declarar y `isintersecting` mal escrito. Aceptar el fence sin
cerrar habría puntuado código roto, así que `blockForPath()` lo rechazó y el
archivo se marcó como faltante. El modelo también falló enlaces `.html`,
landmarks, `clamp()`, animaciones y usó el gradiente genérico `#667eea`.

**Conclusión para el harness:** la dificultad añadida no era solo más volumen.
Añadir hooks explícitos, parseo por ruta y ejecución con DOM stub convirtió
fallos invisibles para P06 (código que "parece" landing pero no reacciona) en
métricas auditables, sin tocar el core ni cambiar `calidad.puntuacion`.
