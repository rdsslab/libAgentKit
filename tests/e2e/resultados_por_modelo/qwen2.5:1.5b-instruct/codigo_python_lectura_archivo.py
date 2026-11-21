def leer_lineas_con_error(archivo):
    try:
        with open(archivo, 'r', encoding='utf-8') as archivo_texto:
            for linea in archivo_texto:
                if 'error' in linea.lower():
                    print(linea.strip())
    except FileNotFoundError:
        print(f"El archivo '{archivo}' no se encontró.")
    except Exception as e:
        print(f"Ocurrió un error: {e}")

# Ejemplo de uso
archivo = 'archivo.txt'  # Reemplaza con el nombre del archivo que deseas leer
leer_lineas_con_error(archivo)