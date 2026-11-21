# Prompt: landing multipágina de evaluación

> Copiar íntegro desde `## PROMPT`. Está en español para alinearse con
> `idiomaSystemPrompt: "auto"` y con los prompts actuales de P05/P06.
> No incluye las notas de evaluación: eso vive en `landing_multipagina_evaluacion.md`.

## PROMPT

Crea el sitio web completo de la clínica veterinaria **Patitas Felices**: 4 páginas HTML estáticas, un CSS compartido y un JavaScript compartido. Debe verse moderno y editorial, con animaciones sutiles y una identidad visual propia. Evita deliberadamente la estética genérica de plantilla.

### Páginas

1. `index.html` — Inicio: hero asimétrico con titular grandes, una marquesina de servicios, sección "método" en 3 pasos numerados, testimonio concreto y CTA final.
2. `servicios.html` — Servicios: 4 fichas (consultas, cirugía, hospitalización, cuidado exótico), barra lateral fija con índice y FAQ de 4 preguntas.
3. `precios.html` — Planes: comparativa de 3 planes con toggle mensual/anual, columna destacada y nota de whats incluido.
4. `contacto.html` — Contacto: formulario, horarios, dirección y cómo llegar en texto + SVG. Sin mapa externo.

### Dirección de diseño (obligatoria)

- Paleta basada en tokens CSS: tinta `#1B1A17`, crema `#F4EFE6`, terracota `#C65D3B`, salvia `#6F8F6A`. Declara todo en `:root` y reutiliza variables; nada de colores sueltos repetidos.
- Tipografía del sistema, sin Google Fonts ni CDN. Titular con `clamp()` entre 2.5rem y 6rem, interlineado ajustado y contraste alto.
- Composición editorial: rejilla asimétrica, mucho espacio en blanco, numeración `01 / 02 / 03`, reglas finas de 1px y marquesina hecha solo con CSS.
- Textura de grano sutil con `repeating-linear-gradient` o SVG inline. Sin imágenes externas.
- Iconos SVG inline con `stroke="currentColor"` y `aria-hidden="true"`. Prohibido emoji y librerías de iconos.
- **Prohibido expresamente**: hero centrado con degradado morado/azul, tres tarjetas con emoji, `Lorem ipsum`, "Tu empresa aquí", el degradado `135deg, #667eea`, sombras exageradas, chatbot flotante y texto de relleno. Todo el copy debe sonar a clínica real en español.

### Animaciones (obligatorias)

- Al menos 2 `@keyframes`: marquesina y reveal escalonado.
- `transition` en enlaces y botones sobre `transform` y `color`, no sobre `all`.
- Reveal al hacer scroll con `IntersectionObserver` y fallback si la API no existe.
- `@media (prefers-reduced-motion: reduce)` que desactive todo movimiento.
- Barra de progreso de scroll fija.

### Funcionalidad JavaScript (vanilla, sin frameworks ni dependencias)

- `data-page` en `<body>` para limitar el comportamiento de cada página.
- Menú móvil con `aria-expanded`; se cierra con Escape y al hacer clic fuera.
- Enlace activo del menú calculado desde `location.pathname`.
- Tema claro/oscuro persistido en `localStorage`, respetando `prefers-color-scheme` por defecto.
- Acordeón FAQ con `aria-expanded` y animación de altura.
- Toggle mensual/anual que recalcula importes leyendo `data-mensual` y `data-anual`.
- Formulario de contacto: validación en cliente de nombre, email, teléfono, servicio y mensaje; errores inline con `aria-invalid` y `aria-describedby`, foco al primer campo inválido y mensaje de éxito. Sin envío de red.
- Debe funcionar abriendo los `.html` por `file://`: sin `fetch`, sin módulos ES, sin CDN y sin `eval`.

**Hooks obligatorios para que el evaluador pueda simular las interacciones** (úsalos tal cual, sin renombrarlos):

- Botón del menú: `data-nav-toggle` (con `aria-expanded`).
- Botón de tema: `data-theme-toggle`.
- Botones del acordeón: `data-faq-toggle` (uno por pregunta, con `aria-expanded`).
- Botón de precios: `data-price-toggle`.
- Importes: cada precio lleva `data-mensual` o `data-anual` según el periodo visible.
- Formulario: `<form data-contacto>` con controles `name="nombre"`, `name="email"`, `name="telefono"`, `name="servicio"` y `name="mensaje"`.
- Mensaje de éxito: un elemento con `data-form-exito` (inicialmente vacío u oculto).
- Barra de progreso: un elemento con `data-scroll-progress`.
- Elementos reveal: `data-reveal`.

Estos nombres son **atributos**, no ids: escribe `<button data-nav-toggle="#menu">`, no `id="data-nav-toggle"`. Si el atributo lleva un valor, úsalo como selector del elemento que quieres mostrar/ocultar.

### Accesibilidad

- `<header>`, `<nav>`, `<main>`, `<footer>` y un único `<h1>` por página.
- `<label>` asociado a cada control, skip link al contenido y estados `:focus-visible`.
- Texto alternativo o `aria-hidden` en todo SVG; contraste suficiente en ambos temas.

### Contrato de salida (crítico)

Devuelve **exactamente 6 bloques de código cercados**, en este orden, sin ninguna línea de texto antes, después o entre ellos:

1. etiqueta `html-index`, primera línea `<!-- index.html -->`
2. etiqueta `html-servicios`, primera línea `<!-- servicios.html -->`
3. etiqueta `html-precios`, primera línea `<!-- precios.html -->`
4. etiqueta `html-contacto`, primera línea `<!-- contacto.html -->`
5. etiqueta `css`, primera línea `/* style.css */`
6. etiqueta `js`, primera línea `// script.js`

Usa etiquetas de bloque formadas solo por letras, números y guiones (`html-index`), nunca puntos ni barras. Cada página enlaza `style.css` y `script.js`; los enlaces entre páginas son relativos. No repitas el contenido de un bloque en otro. Si vas a quedar corto por límite de tokens, entrega los 6 bloques completos pero más breves antes que 3 bloques largos y 4 incompletos.
