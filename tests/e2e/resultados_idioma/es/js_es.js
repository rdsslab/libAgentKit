```javascript
// Landing Page for Patitas Felices - Pure JavaScript

// Configuration
const CONFIG = {
  title: 'Patitas Felices',
  logo: 'https://patitasfelices.com',
  navLinks: ['Home', 'Servicios', 'Contacto', 'Información'],
  formFields: [
    { name: 'Nombre', type: 'text', required: true },
    { name: 'Email', type: 'email', required: true },
    { name: 'Fecha', type: 'date', required: true },
    { name: 'Mensaje', type: 'text', required: true }
  ],
  confirmMessage: '¡Hola! ¡Estamos listos para atenderle. Confirme su visita!',
  alertMessage: '¡Confirmación! Su visita ha sido confirmada. ¡Gracias!'
};

// DOM Elements
const elements = {
  header: document.createElement('header'),
  nav: document.createElement('nav'),
  form: document.createElement('form'),
  confirmMessage: document.createElement('div'),
  alertMessage: document.createElement('div'),
  scrollView: document.createElement('div'),
  cta: document.createElement('button')
};

// Initialize DOM
function initDOM() {
  elements.header = document.createElement('header');
  elements.header.innerHTML = `${CONFIG.title} - Patitas Felices`;
  elements.header.style.background = '#f9f9f9';
  elements.header.style.padding = '10px 20px';
  elements.header.style.border = '1px solid #ddd';
  elements.header.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

  elements.nav = document.createElement('nav');
  elements.nav.innerHTML = `${CONFIG.navLinks.join(' ')}`;
  elements.nav.style.padding = '10px';
  elements.nav.style.border = '1px solid #ddd';
  elements.nav.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

  elements.form = document.createElement('form');
  elements.form.innerHTML = `
    <form action="${CONFIG.formFields[0].name}">
      <div class="form-group">
        <label for="nombre">Nombre</label>
        <input type="text" id="nombre" name="${CON