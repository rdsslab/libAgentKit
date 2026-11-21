/**
 * DOM mínimo para ejecutar el JS generado por la suite `web-complex`.
 *
 * No es un navegador: registra listeners y expone los selectores que el prompt
 * obliga a usar (`data-nav-toggle`, `data-price-toggle`, ...). Sirve para
 * comprobar que el código "engancha" y reacciona, no para validar pintado.
 */

const HOOKS = [
  ["data-nav-toggle", ["#nav-toggle", "#menuToggle", ".menu-toggle", "button[aria-expanded]"]],
  ["data-theme-toggle", ["#theme-toggle", "#themeToggle", ".theme-toggle"]],
  ["data-faq-toggle", [".faq-toggle", ".faq button", "button.faq-pregunta"]],
  ["data-price-toggle", ["#price-toggle", "#togglePrecios", "#toggle-precios", ".price-toggle"]],
  ["data-contacto", ["form", "#contacto-form", "#formContacto", "#formulario-contacto"]],
  ["data-form-exito", ["#form-exito", "#mensaje-exito", ".form-exito"]],
  ["data-scroll-progress", ["#scroll-progress", ".scroll-progress", ".progress-bar"]],
];

const FIELD_NAMES = ["nombre", "email", "telefono", "servicio", "mensaje"];

// Muchos modelos interpretan el valor del atributo como un selector objetivo
// (`getAttribute('data-nav-toggle')`). Darles un valor real evita falsos
// negativos: el código "engancha" con un destino concreto del stub.
const HOOK_TARGETS = {
  "data-nav-toggle": "#nav-menu",
  "data-theme-toggle": "html",
  "data-faq-toggle": ".faq-respuesta",
  "data-price-toggle": "#tabla-precios",
  "data-contacto": "#contacto-form",
  "data-form-exito": ".form-exito",
  "data-scroll-progress": "#barra-progreso",
};

const camel = (value) => value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function makeEventTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    __listeners: listeners,
    addEventListener(type, handler) {
      if (typeof handler !== "function") return;
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const current = listeners.get(type) || [];
      listeners.set(type, current.filter((item) => item !== handler));
    },
    dispatchEvent(event) {
      const current = [...(listeners.get(event.type) || [])];
      for (const handler of current) handler.call(this, event);
      return !event.defaultPrevented;
    },
  };
}

function makeElement(tagName = "div") {
  const attributes = new Map();
  const classes = new Set();
  const syncClasses = () => { element.className = [...classes].join(" "); };
  const classList = {
    add(...names) { names.forEach((name) => classes.add(String(name))); syncClasses(); },
    remove(...names) { names.forEach((name) => classes.delete(String(name))); syncClasses(); },
    contains(name) { return classes.has(String(name)); },
    toggle(name, force) {
      const key = String(name);
      const shouldAdd = force === undefined ? !classes.has(key) : Boolean(force);
      if (shouldAdd) classes.add(key); else classes.delete(key);
      syncClasses();
      return shouldAdd;
    },
    get value() { return [...classes].join(" "); },
    toString() { return [...classes].join(" "); },
  };
  const element = makeEventTarget({
    tagName: String(tagName).toUpperCase(),
    dataset: {},
    style: {},
    className: "",
    classList,
    nextElementSibling: null,
    value: "",
    checked: false,
    textContent: "",
    innerHTML: "",
    hidden: false,
    __valid: true,
    __focusCount: 0,
    setAttribute(name, value) {
      const key = String(name);
      attributes.set(key, String(value));
      if (key.startsWith("data-")) element.dataset[camel(key.slice(5))] = String(value);
    },
    getAttribute(name) {
      const key = String(name);
      return attributes.has(key) ? attributes.get(key) : null;
    },
    removeAttribute(name) {
      const key = String(name);
      attributes.delete(key);
      if (key.startsWith("data-")) delete element.dataset[camel(key.slice(5))];
    },
    hasAttribute(name) { return attributes.has(String(name)); },
    focus() { element.__focusCount += 1; },
    blur() {},
    click() {
      element.dispatchEvent({
        type: "click",
        target: element,
        currentTarget: element,
        defaultPrevented: false,
        preventDefault() {},
        stopPropagation() {},
      });
    },
    checkValidity() { return element.__valid; },
    reportValidity() { return element.__valid; },
    resetValidity() { element.__valid = true; },
    matches() { return false; },
    closest() { return null; },
    scrollIntoView() {},
    appendChild(child) { return child; },
    removeChild(child) { return child; },
    insertBefore(child) { return child; },
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
    },
  });
  return element;
}

/**
 * @param {{ ids?: string[], pathname?: string }} options
 * @returns {{sandbox: object, bySelector: (selector: string) => object|null,
 *   all: (selector: string) => object[], fire: (target: object, type: string) => void,
 *   elements: object, localStorage: Map}}
 */
export function createDomStub({ ids = [], pathname = "/precios.html" } = {}) {
  const registry = new Map();
  const register = (selector, element) => {
    if (!registry.has(selector)) registry.set(selector, element);
    return element;
  };

  const bySelector = (selector) => {
    const value = registry.get(String(selector || "").trim());
    if (Array.isArray(value)) return value[0] || null;
    return value || null;
  };
  const all = (selector) => {
    const value = registry.get(String(selector || "").trim());
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  };

  const documentElement = makeElement("html");
  const body = makeElement("body");
  body.setAttribute("data-page", "precios");
  documentElement.scrollTop = 0;
  body.scrollTop = 0;

  const document = makeEventTarget({
    documentElement,
    body,
    scrollingElement: documentElement,
    readyState: "loading",
    title: "Patitas Felices",
    querySelector: bySelector,
    querySelectorAll: all,
    getElementById(id) { return bySelector(`#${id}`); },
    createElement: (tag) => makeElement(tag),
    getElementsByTagName: (tag) => all(String(tag).toLowerCase()),
  });

  const storage = new Map();
  const localStorage = {
    getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
    setItem(key, value) { storage.set(String(key), String(value)); },
    removeItem(key) { storage.delete(String(key)); },
    clear() { storage.clear(); },
    key(index) { return [...storage.keys()][index] ?? null; },
    get length() { return storage.size; },
  };

  const observers = [];
  class IntersectionObserverStub {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      observers.push(this);
    }
    observe(element) { this.observed.push(element); }
    unobserve(element) { this.observed = this.observed.filter((item) => item !== element); }
    disconnect() { this.observed = []; }
    takeRecords() { return []; }
    simulate() {
      const entries = this.observed.map((target) => ({ target, isIntersecting: true, intersectionRatio: 1 }));
      if (entries.length && typeof this.callback === "function") {
        this.callback(entries, this);
      }
      return entries.length;
    }
  }

  const windowTarget = makeEventTarget({
    localStorage,
    location: {
      pathname,
      href: `http://localhost${pathname}`,
      hash: "",
      search: "",
    },
    innerWidth: 1280,
    innerHeight: 900,
    scrollY: 0,
    matchMedia(query) {
      return {
        media: query,
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      };
    },
    requestAnimationFrame(callback) {
      if (typeof callback === "function") {
        try { callback(0); } catch {}
      }
      return 1;
    },
    cancelAnimationFrame() {},
    IntersectionObserver: IntersectionObserverStub,
  });

  const elements = {};

  for (const name of Object.keys(MULTIPAGE_HOOKS)) {
    const element = makeElement(name === "data-contacto" ? "form" : "button");
    element.setAttribute(name, HOOK_TARGETS[name] || "");
    register(`[${name}]`, element);
    elements[name] = element;
    for (const alias of MULTIPAGE_HOOKS[name]) register(alias, element);
  }

  register("html", documentElement);
  register("body", body);
  register("#nav-menu", makeElement("nav"));
  register(".faq-respuesta", makeElement("div"));
  register("#tabla-precios", makeElement("table"));
  register("#barra-progreso", elements["data-scroll-progress"]);

  // `this.nextElementSibling.classList.toggle(...)` es el patrón que usan los
  // modelos para acordeones y tablas de precios: el stub debe ofrecer un destino
  // con `classList` funcional, no `undefined`.
  elements["data-faq-toggle"].nextElementSibling = bySelector(".faq-respuesta");
  elements["data-price-toggle"].nextElementSibling = bySelector("#tabla-precios");
  elements["data-contacto"].nextElementSibling = makeElement("div");

  /** `new FormData(form)` con aliases (`name`→`nombre`, `message`→`mensaje`). */
  class FormDataStub {
    constructor(form) {
      this.form = form;
      this.entries = new Map();
      const alias = { name: "nombre", phone: "telefono", service: "servicio", message: "mensaje" };
      for (const [key, field] of Object.entries(form?.elements || {})) {
        this.entries.set(key, field?.value ?? "");
      }
      for (const [from, to] of Object.entries(alias)) {
        if (this.entries.has(to) && !this.entries.has(from)) {
          this.entries.set(from, this.entries.get(to));
        }
      }
    }
    get(key) { return this.entries.has(String(key)) ? this.entries.get(String(key)) : null; }
    has(key) { return this.entries.has(String(key)); }
    set(key, value) { this.entries.set(String(key), value); }
    append(key, value) { this.entries.set(String(key), value); }
    delete(key) { this.entries.delete(String(key)); }
    forEach(callback) { for (const [key, value] of this.entries) callback(value, key, this); }
    *[Symbol.iterator]() { yield* this.entries; }
  }

  elements["data-contacto"].tagName = "FORM";
  elements["data-contacto"].elements = {};
  const fields = [];
  for (const name of FIELD_NAMES) {
    const field = makeElement(name === "mensaje" ? "textarea" : "input");
    field.setAttribute("name", name);
    field.setAttribute("required", "");
    field.value = "";
    elements["data-contacto"].elements[name] = field;
    fields.push(field);
    register(`[name="${name}"]`, field);
    register(`#${name}`, field);
  }
  registry.set("input[name]", fields.filter((field) => field.tagName === "INPUT"));
  registry.set("textarea[name]", fields.filter((field) => field.tagName === "TEXTAREA"));
  registry.set("input[name], textarea[name]", fields);
  registry.set("[required]", fields);
  register("#name", fields[0]);
  register("#phone", fields[2]);
  register("#service", fields[3]);
  register("#message", fields[4]);
  elements["data-contacto"].reset = () => {
    for (const field of fields) {
      field.value = "";
      field.__valid = true;
      field.setAttribute("aria-invalid", "false");
    }
  };

  const mensuales = [1, 2, 3].map((index) => {
    const element = makeElement("span");
    element.setAttribute("data-mensual", String(90 - index * 10));
    element.textContent = `${90 - index * 10} €`;
    return element;
  });
  const anuales = [1, 2, 3].map((index) => {
    const element = makeElement("span");
    element.setAttribute("data-anual", String(900 - index * 100));
    element.textContent = `${900 - index * 100} €`;
    return element;
  });
  registry.set("[data-mensual]", mensuales);
  registry.set("[data-anual]", anuales);
  registry.set("[data-reveal]", [1, 2, 3].map(() => makeElement("section")));

  for (const rawId of ids) {
    const id = String(rawId || "").trim();
    if (!id || bySelector(`#${id}`)) continue;
    const element = makeElement("div");
    element.setAttribute("id", id);
    register(`#${id}`, element);
  }

  class EventStub {
    constructor(type, init = {}) {
      this.type = type;
      this.target = null;
      this.currentTarget = null;
      this.defaultPrevented = false;
      this.bubbles = Boolean(init.bubbles);
      this.cancelable = Boolean(init.cancelable);
      this.key = init.key || "";
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() {}
  }

  const sandbox = {
    ...windowTarget,
    window: windowTarget,
    document,
    localStorage,
    Event: EventStub,
    CustomEvent: EventStub,
    FormData: FormDataStub,
    navigator: { userAgent: "agentkit-harness", language: "es-ES" },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    alerts: [],
    alert(message) { sandbox.alerts.push(String(message)); },
    setTimeout(callback) { return typeof callback === "function" ? 1 : 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    performance: { now: () => 0 },
    IntersectionObserver: IntersectionObserverStub,
  };
  sandbox.globalThis = sandbox;

  const fire = (target, type) => {
    const event = new EventStub(type, { bubbles: true, cancelable: true });
    event.target = target;
    event.currentTarget = target;
    if (typeof target?.dispatchEvent === "function") target.dispatchEvent(event);
    return event;
  };

  return {
    sandbox,
    document,
    window: windowTarget,
    elements,
    localStorage,
    storage,
    alerts: sandbox.alerts,
    observers,
    bySelector,
    all,
    fire,
    mensuales,
    anuales,
  };
}

const MULTIPAGE_HOOKS = {
  "data-nav-toggle": HOOKS[0][1],
  "data-theme-toggle": HOOKS[1][1],
  "data-faq-toggle": HOOKS[2][1],
  "data-price-toggle": HOOKS[3][1],
  "data-contacto": HOOKS[4][1],
  "data-form-exito": HOOKS[5][1],
  "data-scroll-progress": HOOKS[6][1],
};
