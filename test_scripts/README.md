# ChatDBG Test Scripts

This directory contains Python test scripts for testing the ChatDBG VSCode extension.

## Scripts Overview

### test_successful.py
- **Purpose**: Test successful execution without errors
- **Expected**: Completes successfully, prints Fibonacci sequence and math operations
- **Use for**: Testing the "Run" button

### test_syntax_error.py
- **Purpose**: Trigger a Python syntax error
- **Error**: Missing closing parenthesis
- **Use for**: Testing how ChatDBG handles syntax errors

### test_runtime_error.py
- **Purpose**: Trigger a runtime error during execution
- **Error**: ZeroDivisionError (division by zero)
- **Use for**: Testing "Run & Explain" with a common runtime error

### test_index_error.py
- **Purpose**: Trigger an index out of bounds error
- **Error**: IndexError (accessing list index 10 when length is 5)
- **Use for**: Testing array/list boundary errors

### test_attribute_error.py
- **Purpose**: Trigger an attribute access error
- **Error**: AttributeError (accessing non-existent 'email' attribute)
- **Use for**: Testing object/class attribute errors

### test_type_error.py
- **Purpose**: Trigger a type mismatch error
- **Error**: TypeError (concatenating string with integer)
- **Use for**: Testing type-related errors

## Usage

1. Open any script in the Extension Development Host
2. Use the ChatDBG panel buttons:
   - **Run**: Execute without AI explanation
   - **Run & Explain**: Execute and get AI explanation if error occurs
   - **Explain Last Error**: Re-explain the most recent error

3. Expected outputs:
   - Terminal shows Python execution
   - ChatDBG panel transcript shows AI explanations
   - log.yaml file generated in this directory

## Testing Tips

- Start with `test_successful.py` to verify basic execution
- Then test error scripts to verify AI explanation functionality
- Check the generated `log.yaml` file to see AI conversation logs
- Each script is designed to be simple and focused on one error type

## Cleaning Up

After testing, you can delete the generated `log.yaml` file:
```bash
rm log.yaml
```
