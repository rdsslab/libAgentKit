function isValidEmail(email) {
  // Expresión regular para validar un email básico
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // Comprueba si el email coincide con la expresión regular
  return emailRegex.test(email);
}

// Ejemplo de uso:
console.log(isValidEmail("example@example.com")); // true
console.log(isValidEmail("invalid-email")); // false
console.log(isValidEmail("user@domain.co.uk")); // true
console.log(isValidEmail("user@domain")); // false