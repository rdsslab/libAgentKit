/* script.js */
document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('contactForm');

  form.addEventListener('submit', function(event) {
    event.preventDefault();

    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const message = document.getElementById('message').value;

    if (name.trim() === '' || email.trim() === '' || message.trim() === '') {
      alert('Por favor, complete todos los campos.');
    } else {
      alert('Formulario enviado correctamente!');
      form.reset();
    }
  });
});