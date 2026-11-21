def leer_archivo(ruta):
    try:
        with open(ruta, 'r') as f:
            return f.read()
    except FileNotFoundError:
        print(f"Error: El archivo '{ruta}' no fue encontrado.")
    except Exception as e:
        print(f"Ocurrió un error: {e}")
    return None