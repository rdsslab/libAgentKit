def main():
    try:
        with open('error_log.txt', 'r') as file:
            for line in file:
                if 'error' in line:
                    print(line)
    except FileNotFoundError:
        print("Error: The file 'error_log.txt' was not found.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    main()