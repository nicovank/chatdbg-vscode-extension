"""
Test script that runs successfully
This should complete without errors for testing the "Run" button
"""

def fibonacci(n):
    """Generates the first n Fibonacci numbers"""
    if n <= 0:
        return []
    elif n == 1:
        return [0]
    elif n == 2:
        return [0, 1]

    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    return fib

def main():
    print("=== Fibonacci Sequence Generator ===")
    n = 10
    print(f"Generating first {n} Fibonacci numbers...")

    result = fibonacci(n)
    print(f"Result: {result}")

    print("\n=== Simple Math Operations ===")
    a, b = 15, 7
    print(f"{a} + {b} = {a + b}")
    print(f"{a} - {b} = {a - b}")
    print(f"{a} * {b} = {a * b}")
    print(f"{a} / {b} = {a / b:.2f}")

    print("\n✓ All operations completed successfully!")

if __name__ == "__main__":
    main()
