```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Patitas Felices</title>
    <style>
        /* Estilos CSS aquí */
    </style>
</head>
<body>
    <header>
        <nav>
            <a href="#inicio" class="toggle">Inicio</a>
            <a href="#servicios" class="toggle">Servicios</a>
            <a href="#contacto" class="toggle">Contacto</a>
        </nav>
    </header>

    <section id="inicio">
        <h1>Patitas Felices</h1>
        <p>¡Bienvenido a la Clínica Veterinaria!</p>
        <form id="formulario">
            <label for="nombre">Nombre:</label>
            <input type="text" id="nombre" name="nombre" required>

            <label for="email">Email:</label>
            <input type="email" id="email" name="email" required>

            <button type="submit">Enviar</button>
        </form>

        <div id="mensaje-confirmation">
            <p>¡Gracias por contactarnos!</p>
            <button id="boton-cta">Continuar</button>
        </div>

        <script>
            const formulario = document.getElementById('formulario');
            const mensajeConfirmation = document.getElementById('mensaje-confirmation');

            formulario.addEventListener('submit', function(event) {
                event.preventDefault();

                const nombre = formulario.elements['nombre'].value;
                const email = formulario.elements['email'].value;

                if (nombre && email) {
                    mensajeConfirmation.style.display = 'block';
                    formulario.reset();
                } else {
                    mensajeConfirmation.style.display = 'none';
                }
            });

            const botonCTA = document.getElementById('boton-cta');
            botonCTA.addEventListener('click', function() {
                mensajeConfirmation.style.display = 'none';
            });
        </script>
    </section>

    <section id="servicios">
        <h2>Servicios</h2>
        <p>¡Nuestros servicios incluyen...</p>
    </section>

    <section id="contacto">
        <h2>Contacto</h2>
        <p>¡Contáctanos para más información!</p>