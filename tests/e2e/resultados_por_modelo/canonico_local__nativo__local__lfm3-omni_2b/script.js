document.addEventListener('DOMContentLoaded', function() {
  const form = document.querySelector('form');
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const nombre = document.getElementById('nombre').value;
    const edad = document.getElementById('edad').value;

    if (nombre && edad) {
      alert(`Suscríbete con: Nombre: ${nombre}, Edad: ${edad}`);
    } else {
      alert('Por favor, complete los campos del formulario.');
    }
  });
});