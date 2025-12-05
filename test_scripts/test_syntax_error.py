"""
Test script with a syntax error
This should trigger a SyntaxError that ChatDBG can explain
"""

def calculate_sum(a, b):
    result = a + b
    return result

# Syntax error: missing closing parenthesis
print("The sum is:", calculate_sum(5, 10)
