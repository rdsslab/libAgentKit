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
  confirmMessage: '¡Hola! ¡Has confirmado tu cita con Patitas Felices! ¡Gracias!',
  ctaButton: 'Reservar Cita',
  alertMessage: '¡Error! Por favor, verifica los datos y vuelve a intentar.'
};

// DOM Elements
const elements = {
  header: document.createElement('header'),
  nav: document.createElement('nav'),
  form: document.createElement('form'),
  confirmMessage: document.createElement('div'),
  ctaButton: document.createElement('button'),
  alert: document.createElement('div')
};

// Initialize DOM
elements.header = document.createElement('header');
elements.header.innerHTML = `${CONFIG.title} - Patitas Felices`;
elements.header.style.cssText = 'text-align-center; padding: 20px;';

elements.nav = document.createElement('nav');
elements.nav.innerHTML = CONFIG.navLinks.join(' ');
elements.nav.style.cssText = 'margin-top: 20px;';

elements.form = document.createElement('form');
elements.form.style.cssText = 'max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ccc; border-radius: 4px;';

elements.confirmMessage = document.createElement('div');
elements.confirmMessage.style.cssText = 'margin-top: 20px; padding: 15px; border: 1px solid #ccc; border-radius: 4px;';

elements.ctaButton = document.createElement('button');
elements.ctaButton.textContent = CONFIG.ctaButton;
elements.ctaButton.style.cssText = 'background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px;