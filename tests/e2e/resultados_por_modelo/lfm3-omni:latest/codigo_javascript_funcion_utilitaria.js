```javascript
/**
 * Valida si un correo electrónico es válido utilizando una expresión regular.
 * @param {string} email - El correo electrónico a validar.
 * @returns {boolean} - Devuelve true si el correo es válido, false en caso contrario.
 */
function isValidEmail(email) {
  // Compartir una expresión regular para validar el formato del correo electrónico
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  // Verificar si el correo electrónico coincide con la expresión regular
  return emailRegex.test(email);
}

// Ejemplo de uso:
const testEmails = [
  "user@example.com",  // Válido
  "user@subdomain.example.com", // Válido
  "user.name+tag@subdomain.example.com", // Válido
  "user@-example.com",  // Válido (puede ser válido según la regla)
  "user@.example.com",  // Válido (puede ser válido según la regla)
  "user@example",       // Válido (puede ser válido según la regla)
  "user@.com",          // Válido (puede ser válido según la regla)
  "user@example.com.",  // Válido (puede ser válido según la regla)
  "user@example.com.", // Válido (puede ser válido según la regla)
  "user@example.com",   // Válido (puede ser válido según la regla)
  "user@example.com",   // Válido (puede ser válido según la regla)
  "user@example.com",   // Válido (puede ser válido según la regla)
  "user@example.com",   // Válido (puede ser válido según la regla)
  "user@example.com",   // Válido (puede ser válido según la regla)
  "user@example.com",   // Válido (puede ser válido según la regla)
  "user@example.com",   // Válido (puede ser válido según la regla)
  "user