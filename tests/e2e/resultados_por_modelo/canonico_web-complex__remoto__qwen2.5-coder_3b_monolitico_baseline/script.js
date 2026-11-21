document.addEventListener('DOMContentLoaded', function() {
  // Data attributes for toggling
  const navToggle = document.querySelectorAll('[data-nav-toggle]');
  const themeToggle = document.querySelectorAll('[data-theme-toggle]');
  const faqToggle = document.querySelectorAll('[data-faq-toggle]');
  const priceToggle = document.querySelectorAll('[data-price-toggle]');
  const contactoToggle = document.querySelectorAll('[data-contacto]');
  const formExitoToggle = document.querySelectorAll('[data-form-exito]');
  const scrollProgressToggle = document.querySelectorAll('[data-scroll-progress]');
  const revealToggle = document.querySelectorAll('[data-reveal]');

  // Toggle functionality
  navToggle.forEach(toggle => toggle.addEventListener('click', function() {
    const target = document.querySelector(toggle.getAttribute('data-nav-toggle'));
    if (target) {
      target.classList.toggle('active');
    }
  }));

  themeToggle.forEach(toggle => toggle.addEventListener('click', function() {
    const target = document.querySelector(toggle.getAttribute('data-theme-toggle'));
    if (target) {
      target.classList.toggle('active');
    }
  }));

  faqToggle.forEach(toggle => toggle.addEventListener('click', function() {
    const target = document.querySelector(toggle.getAttribute('data-faq-toggle'));
    if (target) {
      target.classList.toggle('active');
    }
  }));

  priceToggle.forEach(toggle => toggle.addEventListener('click', function() {
    const target = document.querySelector(toggle.getAttribute('data-price-toggle'));
    if (target) {
      target.classList.toggle('active');
    }
  }));

  contactoToggle.forEach(toggle => toggle.addEventListener('click', function() {
    const target = document.querySelector(toggle.getAttribute('data-contacto'));
    if (target) {
      target.classList.toggle('active');
    }
  }));

  formExitoToggle.forEach(toggle => toggle.addEventListener('click', function() {
    const target = document.querySelector(toggle.getAttribute('data-form-exito'));
    if (target) {
      target.classList.toggle('active');
    }
  }));

  scrollProgressToggle.forEach(toggle => toggle.addEventListener('click', function() {
    const target = document.querySelector(toggle.getAttribute('data-scroll-progress'));
    if (target) {
      target.classList.toggle('active');
    }
  }));

  revealToggle.forEach(toggle => toggle.addEventListener('click', function() {
    const target = document.querySelector(toggle.getAttribute('data-reveal'));
    if (target) {
      target.classList.toggle('active');
    }
  }));

  // LocalStorage functionality
  const theme = localStorage.getItem('theme');
  if (theme) {
    document.body.classList.add(theme);
  }

  // IntersectionObserver for scroll progress
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        document.body.classList.add('scrolling');
      } else {
        document.body.classList.remove('scrolling');
      }
    });
  }, { threshold: 0.5 });

  observer.observe(document.querySelector('body'));

  // Form validation
  const form = document.querySelector('form');
  form.addEventListener('submit', function(event) {
    event.preventDefault();
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const message = document.getElementById('message').value;

    if (name === '' || email === '' || message === '') {
      alert('Por favor, complete todos los campos.');
    } else {
      alert('Formulario enviado correctamente!');
      form.reset();
      formExitoToggle.forEach(toggle => toggle.click());
    }
  });
});