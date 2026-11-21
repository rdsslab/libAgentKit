try:
    with open('archivo.txt', 'r') as file:
        for line in file:
            if 'error' in line.lower():
                print(line.strip())
except FileNotFoundError:
    print("El archivo no se encontró.")
except Exception as e:
    print(f"Ocurrió un error: {e}")