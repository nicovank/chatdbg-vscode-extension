"""
Test script with a TypeError
This should trigger a TypeError that ChatDBG can explain
"""

def concatenate_strings(str1, str2):
    """Concatenates two strings"""
    return str1 + str2

def main():
    # This works fine
    result1 = concatenate_strings("Hello, ", "World!")
    print(result1)

    # This will cause a TypeError (can't concatenate str and int)
    result2 = concatenate_strings("Age: ", 25)
    print(result2)

if __name__ == "__main__":
    main()
