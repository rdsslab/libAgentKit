function isValidEmail(email) {
    // Expresión regular para validar un correo electrónico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // Comprueba si el correo electrónico coincide con la expresión regular
    return emailRegex.test(email);
}