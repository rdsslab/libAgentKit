Aquí tienes una función en JavaScript que utiliza una expresión regular para validar si un correo electrónico es válido. La función también incluye comentarios para explicar su funcionamiento:

```javascript
// Definimos la función validarCorreo
function validarCorreo(correo) {
    // Expresión regular para validar un correo electrónico
    // Esta expresión regular es:
    // ^[\w-]+([\w-]+)*@[\w-]+(\.[\w-]+)*$ 
    // Explicación:
    // ^ - comienza una cadena de caracteres
    // [\w-]+ - hasta un número de caracteres, incluyendo espacios y guiones
    // ([\w-]+)* - esto se repite una o más veces
    // @ - este es el carácter @
    // [\w-]+ - hasta un número de caracteres, incluyendo espacios y guiones
    // (\.[\w-]+)* - esto se repite una o más veces
    // $ - termina la cadena de caracteres
    // Si la cadena de caracteres cumple con la expresión regular, se considera un correo electrónico válido
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(correo);
}

// Ejemplo de uso de la función
let correoCorrecto = validarCorreo("usuario@ejemplo.com");
console.log(correoCorrecto); // Debería imprimir "true" si el correo es válido

let correoIncorrecto = validarCorreo("usuario@ejemplo.com");
console.log(correoIncorrecto); // Debería imprimir "false" si el correo es inválido
```

Este código define una función `validarCorreo` que devuelve `true` si el correo es válido y `false` si no lo es. La función utiliza una expresión regular `^[^\s@]+@[^\s@]+\.[^\s@]+$` para validar el formato del correo. Si el correo coincide con esta expresión regular, se considera válido.

Es importante notar que la expresión regular utilizada aquí es muy básica y puede no ser suficiente para validar todos los correos electrónicos válidos. Para un enfoque más robusto, se recomienda usar el método `email-validator` o otros servicios de validación de correo electrónico más completos.