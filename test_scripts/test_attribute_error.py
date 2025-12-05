"""
Test script with an AttributeError
This should trigger an AttributeError that ChatDBG can explain
"""

class Person:
    def __init__(self, name, age):
        self.name = name
        self.age = age

    def greet(self):
        return f"Hello, I'm {self.name}"

def main():
    person = Person("Alice", 30)

    # This works fine
    print(person.greet())
    print(f"Name: {person.name}")

    # This will cause an AttributeError (no 'email' attribute)
    print(f"Email: {person.email}")

if __name__ == "__main__":
    main()
