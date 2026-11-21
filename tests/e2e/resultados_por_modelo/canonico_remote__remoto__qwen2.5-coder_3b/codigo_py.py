def leer_archivo(ruta):
    try:
        # Abre el archivo en modo lectura
        with open(ruta, 'r') as archivo:
            # Lee todas las líneas del archivo
            contenido = archivo.readlines()
            return contenido
    except FileNotFoundError:
        # Maneja el error si el archivo no se encuentra
        print(f"Error: El archivo '{ruta}' no se encontró.")
        return None
    except Exception as e:
        # Maneja cualquier otro error que pueda ocurrir
        print(f"Error al leer el archivo '{ruta}': {e}")
        return None