document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        const nombre = document.getElementById('nombre').value;
        const edad = document.getElementById('edad').value;
        const contacto = document.getElementById('contacto').value;

        if (nombre && edad && contacto) {
            alert(`¡Hola, ${nombre}! A ${edad} años. Contacto: ${contacto}`);
        } else {
            alert('Por favor, complete todos los campos.');
        }
    });
});