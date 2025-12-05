"""
Test script with a runtime error
This should trigger a ZeroDivisionError that ChatDBG can explain
"""

def divide_numbers(a, b):
    """Divides two numbers"""
    return a / b

def main():
    print("Starting division test...")

    # This will work fine
    result1 = divide_numbers(10, 2)
    print(f"10 / 2 = {result1}")

    # This will cause a ZeroDivisionError
    result2 = divide_numbers(10, 0)
    print(f"10 / 0 = {result2}")

if __name__ == "__main__":
    main()
