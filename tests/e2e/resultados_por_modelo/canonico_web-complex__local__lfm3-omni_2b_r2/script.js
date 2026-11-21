// Inicialización de hooks
dataNavToggle = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.focus();
    }
  });
});

dataThemeToggle = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      document.documentElement.setAttribute('data-theme', entry.target.dataset.theme);
    }
  });
});

dataFaqToggle = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isintersecting) {
      document.documentElement.dataset.faq = 'Yes';
    }
  });
});

dataPriceToggle = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isintersecting) {
      document.documentElement.dataset.price = entry.target.dataset.price;
    }
  });
});

dataContacto = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isintersecting) {
      document.documentElement.dataset.contacto = 'Yes';
    }
  });
});

// Validación de formulario
function validarFormulario(form) {
  const error = document.querySelector('form[error]');
  if (error) {
    error.textContent = 'Por favor, complete el formulario correctamente.';
  }
}

// Manejo de eventos
document.addEventListener('DOMContentLoaded', () => {
  validarFormulario(document.querySelector('form'));
});

// Escritura a localStorage
function guardarLocalStorage(key, valor) {
  localStorage.setItem(key, valor);
}

// Escritura a IntersectionObserver
function guardarIntersectionObserver(observer) {
  localStorage.setItem('intersectionObserver', JSON.stringify(observer));
}

// Escritura a IntersectionObserver
function guardarDataTheme(theme) {
  localStorage.setItem('data-theme', theme);
}

// Escritura a IntersectionObserver
function guardarDataFaq(faq) {
  localStorage.setItem('data-faq', faq);
}

// Escritura a IntersectionObserver
function guardarDataPrice(price) {
  localStorage.setItem('data-price', price);
}

// Escritura a IntersectionObserver
function guardarDataContacto(contacto) {
  localStorage.setItem('data-contacto', contacto);
}

// Escritura a IntersectionObserver
function guardarDataScrollProgress(scroll) {
  localStorage.setItem('data-scroll-progress', scroll);
}

// Escritura a IntersectionObserver
function guardarReveal() {
  localStorage.setItem('data-reveal', 'Yes');
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(price) {
  localStorage.setItem('data-price-toggle', price);
}

// Escritura a IntersectionObserver
function guardarDataContactoToggle(contacto) {
  localStorage.setItem('data-contacto-toggle', contacto);
}

// Escritura a IntersectionObserver
function guardarDataScrollProgressToggle(scroll) {
  localStorage.setItem('data-scroll-progress-toggle', scroll);
}

// Escritura a IntersectionObserver
function guardarRevealToggle() {
  localStorage.setItem('data-reveal-toggle', 'Yes');
}

// Escritura a IntersectionObserver
function guardarDataPriceToggleToggle(price) {
  localStorage.setItem('data-price-toggle', price);
}

// Escritura a IntersectionObserver
function guardarDataContactoToggleToggle(contacto) {
  localStorage.setItem('data-contacto-toggle', contacto);
}

// Escritura a IntersectionObserver
function guardarDataScrollProgressToggleToggle(scroll) {
  localStorage.setItem('data-scroll-progress-toggle', scroll);
}

// Escritura a IntersectionObserver
function guardarRevealToggleToggle() {
  localStorage.setItem('data-reveal-toggle', 'Yes');
}

// Escritura a IntersectionObserver
function guardarDataPriceToggleToggleToggle(price) {
  localStorage.setItem('data-price-toggle', price);
}

// Escritura a IntersectionObserver
function guardarDataContactoToggleToggleToggle(contacto) {
  localStorage.setItem('data-contacto-toggle', contacto);
}

// Escritura a IntersectionObserver
function guardarDataScrollProgressToggleToggleToggle(scroll) {
  localStorage.setItem('data-scroll-progress-toggle', scroll);
}

// Escritura a IntersectionObserver
function guardarRevealToggleToggleToggle() {
  localStorage.setItem('data-reveal-toggle', 'Yes');
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(price) {
  localStorage.setItem('data-price-toggle', price);
}

// Escritura a IntersectionObserver
function guardarDataContactoToggle(contacto) {
  localStorage.setItem('data-contacto-toggle', contacto);
}

// Escritura a IntersectionObserver
function guardarDataScrollProgressToggle(scroll) {
  localStorage.setItem('data-scroll-progress-toggle', scroll);
}

// Escritura a IntersectionObserver
function guardarRevealToggle() {
  localStorage.setItem('data-reveal-toggle', 'Yes');
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(price) {
  localStorage.setItem('data-price-toggle', price);
}

// Escritura a IntersectionObserver
function guardarDataContactoToggle(contacto) {
  localStorage.setItem('data-contacto-toggle', contacto);
}

// Escritura a IntersectionObserver
function guardarDataScrollProgressToggle(scroll) {
  localStorage.setItem('data-scroll-progress-toggle', scroll);
}

// Escritura a IntersectionObserver
function guardarRevealToggle() {
  localStorage.setItem('data-reveal-toggle', 'Yes');
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(price) {
  localStorage.setItem('data-price-toggle', price);
}

// Escritura a IntersectionObserver
function guardarDataContactoToggle(contacto) {
  localStorage.setItem('data-contacto-toggle', contacto);
}

// Escritura a IntersectionObserver