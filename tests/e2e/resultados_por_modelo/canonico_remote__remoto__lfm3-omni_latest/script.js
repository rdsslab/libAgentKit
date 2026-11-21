document.addEventListener('DOMContentLoaded', function() {
  const form = document.querySelector('form');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const input = form.querySelector('input');
      if (input) {
        const value = input.value.trim();
        if (value) {
          alert('Formulario validado: ' + value);
        } else {
          alert('Formulario vacío. Por favor, introduzca un valor.');
        }
      }
    });
  }
});