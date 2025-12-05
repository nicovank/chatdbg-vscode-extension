"""
Test script with an IndexError
This should trigger an IndexError that ChatDBG can explain
"""

def get_element_at_index(lst, index):
    """Gets an element from a list at the specified index"""
    return lst[index]

def main():
    numbers = [1, 2, 3, 4, 5]

    print("List contents:", numbers)
    print("Length:", len(numbers))

    # This works fine
    print("Element at index 2:", get_element_at_index(numbers, 2))

    # This will cause an IndexError (index out of range)
    print("Element at index 10:", get_element_at_index(numbers, 10))

if __name__ == "__main__":
    main()
