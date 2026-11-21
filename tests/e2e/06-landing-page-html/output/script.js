/* Patitas Felices - Clínica Veterinaria - JavaScript */

document.addEventListener('DOMContentLoaded', function() {
  // Menú móvil toggle
  const btn = document.querySelector('.cta');
  if (btn) {
    btn.addEventListener('click', function() {
      alert('Gracias por contactar Patitas Felices. Te contactaremos pronto.');
    });
  }

  // Validación de formulario de contacto
  const form = document.querySelector('form');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const nombre = form.querySelector('input[type="text"]');
      const email = form.querySelector('input[type="email"]');
      const telefono = form.querySelector('input[type="tel"]');
      const mensaje = form.querySelector('textarea');

      let valido = true;

      if (!nombre || !nombre.value.trim()) {
        alert('Por favor ingresa tu nombre');
        valido = false;
      }

      if (!email || !email.value.includes('@')) {
        alert('Por favor ingresa un email válido');
        valido = false;
      }

      if (!telefono || !telefono.value.trim()) {
        alert('Por favor ingresa tu teléfono');
        valido = false;
      }

      if (!mensaje || !mensaje.value.trim()) {
        alert('Por favor ingresa un mensaje');
        valido = false;
      }

      if (valido) {
        alert('Mensaje enviado correctamente. Te contactaremos pronto.');
        form.reset();
      }
    });
  }

  // Smooth scroll para anclas de navegación
  const links = document.querySelectorAll('header nav ul li a');
  links.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const targetId = this.getAttribute('href');
      if (targetId && targetId.startsWith('#')) {
        const target = document.querySelector(targetId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });
});
