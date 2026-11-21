try:
    with open('file.txt', 'r') as file:
        for line in file:
            print('error')
except FileNotFoundError:
    print("Error: The file 'file.txt' was not found.")
except Exception as e:
    print(f"An unexpected error occurred: {e}")