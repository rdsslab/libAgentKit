def leer_archivo(ruta):
    try:
        with open(ruta, 'r') as archivo:
            return archivo.read()
    except FileNotFoundError:
        print(f"Error: El archivo '{ruta}' no fue encontrado.")
    except PermissionError:
        print(f"Error: No se tiene permiso para leer '{ruta}'.")
    except Exception as e:
        print(f"Ocurrió un error inesperado al leer el archivo: {e}")
    return None