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
      document.documentElement.setAttribute('data-theme', entry.target.className);
    }
  });
});

dataFaqToggle = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isintersecting) {
      document.documentElement.setAttribute('data-faq', entry.target.className);
    }
  });
});

dataPriceToggle = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isintersecting) {
      document.documentElement.setAttribute('data-price', entry.target.className);
    }
  });
});

dataContacto = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isintersecting) {
      document.documentElement.setAttribute('data-contacto', entry.target.className);
    }
  });
});

// Validación de formulario
function validarFormulario(formulario) {
  const error = document.querySelector('form[id="data-form-exito"]');
  if (error) {
    error.validationFailed = 'Por favor, complete todos los campos del formulario';
  }
}

// Manejo de eventos
document.addEventListener('DOMContentLoaded', () => {
  validarFormulario(document.querySelector('form[id="data-form-exito"]'));
});

// Escritura a localStorage
function guardarLocalStorage(data) {
  localStorage.setItem('data-' + data, JSON.stringify(data));
}

// Escritura a screen
function guardarScreen(data) {
  document.body.style.background = data;
}

// Escritura a IntersectionObserver
function guardarIntersectionObserver(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        guardarLocalStorage(entry.target);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataThemeToggle(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-theme', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataFaqToggle(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-faq', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-price', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataContacto(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-contacto', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataScrollProgress(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        guardarLocalStorage(entry.target);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarReveal(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-reveal', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-price', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataContacto(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-contacto', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataScrollProgress(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        guardarLocalStorage(entry.target);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarReveal(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-reveal', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-price', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataContacto(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-contacto', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataScrollProgress(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        guardarLocalStorage(entry.target);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarReveal(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-reveal', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-price', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataContacto(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-contacto', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataScrollProgress(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        guardarLocalStorage(entry.target);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarReveal(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-reveal', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-price', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataContacto(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-contacto', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataScrollProgress(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        guardarLocalStorage(entry.target);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarReveal(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-reveal', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-price', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataContacto(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-contacto', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataScrollProgress(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        guardarLocalStorage(entry.target);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarReveal(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-reveal', entry.target.className);
      }
    }
  });
}

// Escritura a IntersectionObserver
function guardarDataPriceToggle(observer) {
  observer.observe(document, {
    entry: entry => {
      if (entry.isintersecting) {
        document.documentElement.setAttribute('data-price', entry.target.className);