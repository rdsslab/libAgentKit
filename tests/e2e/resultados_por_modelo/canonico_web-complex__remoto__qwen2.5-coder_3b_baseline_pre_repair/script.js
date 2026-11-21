document.addEventListener('DOMContentLoaded', function() {
  // Data attributes for toggling
  const navToggle = document.querySelectorAll('[data-nav-toggle]');
  const themeToggle = document.querySelectorAll('[data-theme-toggle]');
  const faqToggle = document.querySelectorAll('[data-faq-toggle]');
  const priceToggle = document.querySelectorAll('[data-price-toggle]');
  const contactoToggle = document.querySelectorAll('[data-contacto]');
  const formExito = document.querySelector('[data-form-exito]');
  const scrollProgress = document.querySelector('[data-scroll-progress]');
  const reveal = document.querySelectorAll('[data-reveal]');

  // Toggle navigation
  navToggle.forEach(toggle => {
    toggle.addEventListener('click', function() {
      this.classList.toggle('active');
    });
  });

  // Toggle theme
  themeToggle.forEach(toggle => {
    toggle.addEventListener('click', function() {
      document.body.classList.toggle('dark');
      localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    });
  });

  // Toggle FAQ
  faqToggle.forEach(toggle => {
    toggle.addEventListener('click', function() {
      const faqContent = this.nextElementSibling;
      faqContent.classList.toggle('active');
    });
  });

  // Toggle prices
  priceToggle.forEach(toggle => {
    toggle.addEventListener('click', function() {
      const pricesContent = this.nextElementSibling;
      pricesContent.classList.toggle('active');
    });
  });

  // Toggle contact
  contactoToggle.forEach(toggle => {
    toggle.addEventListener('click', function() {
      const contactoContent = this.nextElementSibling;
      contactoContent.classList.toggle('active');
    });
  });

  // Form submission and success message
  const form = document.querySelector('form');
  const successMessage = document.querySelector('[data-form-exito]');

  form.addEventListener('submit', function(event) {
    event.preventDefault();
    const formData = new FormData(form);
    const name = formData.get('name');
    const email = formData.get('email');
    const message = formData.get('message');

    // Basic validation
    if (!name || !email || !message) {
      alert('Por favor, complete todos los campos.');
      return;
    }

    // Show success message
    successMessage.style.display = 'block';

    // Clear form fields
    form.reset();
  });

  // Scroll progress
  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        scrollProgress.classList.add('active');
      } else {
        scrollProgress.classList.remove('active');
      }
    });
  }, { threshold: 0.5 });

  observer.observe(document.body);

  // Reveal elements on scroll
  reveal.forEach(reveal => {
    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          reveal.classList.add('active');
        }
      });
    }, { threshold: 0.5 });

    observer.observe(reveal);
  });

  // Restore theme from localStorage
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
  }
});