function esCorreoValido(correo) {
    // Define la expresión regular para validar un correo electrónico
    const expresionRegular = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Verifica si el correo electrónico coincide con la expresión regular
    return expresionRegular.test(correo);
}

// Ejemplo de uso
console.log(esCorreoValido("usuario@dominio.com")); // Devuelve true
console.log(esCorreoValido("usuario@dominio")); // Devuelve false