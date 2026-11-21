import sys

try:
    with open(sys.argv[1], 'r') as file:
        for line in file:
            if 'error' in line:
                print(line)
except FileNotFoundError:
    print("Error: The file was not found.")
except Exception as e:
    print(f"An error occurred: {e}")