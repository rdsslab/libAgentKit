try:
    with open('input.txt', 'r') as file:
        for line in file:
            print('error')
except FileNotFoundError:
    print('Error: The file was not found.')
except Exception as e:
    print(f'An unexpected error occurred: {e}')