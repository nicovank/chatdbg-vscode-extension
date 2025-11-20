# ChatDBG VS Code Extension — Terminal Edition

**LLM-assisted debugging, now inside Visual Studio Code.**

This extension brings the power of ChatDBG directly into the IDE, allowing developers to run Python programs, ask "Why did this fail?", and receive AI-annotated explanations and diagnostics — all from within VS Code's terminal and Problems panel.

---

## Overview

The **Terminal Edition** establishes the backend foundation for integrating ChatDBG with VS Code.

- It focuses on **command handling**, **process management**, **traceback parsing**, and seamless developer workflow.
- A future **UI Edition** will build on this core to deliver a full graphical interface with a chat panel, interactive diagnostics, and visual controls.

---

## Key Features

### Core Commands

- **Run with ChatDBG** — Executes the active Python file under ChatDBG inside VS Code's terminal.
- **Explain Last Error** — Automatically sends "Why did this fail?" after a program error.
- **Run & Explain** — Combines both into a single one-click debugging flow.
- **Status Bar Button** — "▶ ChatDBG" appears only when a Python file is active.

### Developer Experience

- Automatically uses the Python interpreter configured in VS Code.
- Gracefully ignores non-Python files.
- Displays a single setup tip if the OpenAI key is missing.
- Supports "Rerun Last" for quick debugging cycles.

### Diagnostics Integration

- Parses ChatDBG's traceback output to detect file paths, line numbers, and error types.
- Displays them directly in the **Problems Panel** with clickable navigation.
- Automatically opens the relevant file and line for inspection.

### Logging and Stability

- Command to open the latest `chatdbg.log.yaml` file.
- Handles missing dependencies and runtime errors gracefully.
- Clean, consistent terminal output designed for daily debugging use.

---

## Configuration

Add the following settings to your VS Code `settings.json`:
```json
{
  "chatdbg.activationCommand": "source ~/venvs/chatdbg/bin/activate",
  "chatdbg.pythonPath": "/usr/bin/python3",
  "chatdbg.openaiKey": "sk-...",
  "chatdbg.model": "gpt-4o",
  "chatdbg.format": "md:simple",
  "chatdbg.unsafe": false
}
```

| Setting | Description |
|---------|-------------|
| `activationCommand` | Shell command used to activate ChatDBG's environment |
| `pythonPath` | Fallback Python interpreter if not set globally |
| `openaiKey` | Local OpenAI API key for ChatDBG |
| `model` | Model identifier (e.g., `gpt-4o`) |
| `format` | Output format — `text`, `md`, `md:simple`, or `jupyter` |
| `unsafe` | Enables `--unsafe` mode (advanced debugging) |

> **Note:** All credentials and configurations are stored locally; nothing is transmitted externally.

---

## Commands

| Command | Description |
|---------|-------------|
| **ChatDBG: Run** | Runs the active Python file under ChatDBG |
| **ChatDBG: Explain Last Error** | Sends "Why did this fail?" automatically |
| **ChatDBG: Run & Explain** | Combines run and explain into one action |
| **ChatDBG: Open Last Log** | Opens the latest ChatDBG log file |

---

## Typical Workflow

1. Open a Python file in VS Code.
2. Click **▶ ChatDBG** on the status bar or use **ChatDBG: Run & Explain**.
3. Observe ChatDBG output directly in the integrated terminal.
4. If an exception occurs, check the **Problems Panel** for a clickable diagnostic.
5. Optionally, run **Explain Last Error** for an LLM-based analysis.

---

## Manual Testing Checklist

| Test Case | Expected Behavior |
|-----------|-------------------|
| Interpreter Detection | Uses configured Python interpreter correctly |
| Missing API Key | Displays a one-time setup tip |
| Run File | Executes cleanly with ChatDBG prompt visible |
| Explain Error | Sends diagnostic query automatically |
| Diagnostics | Displays correct line and file in Problems panel |
| Rerun Last | Repeats the previous ChatDBG run |

---

## Security and Privacy

- No telemetry or remote logging of user data.
- API keys are stored only in local VS Code settings.
- Unsafe mode (`--unsafe`) is opt-in and clearly labeled as advanced.

---

## Architecture

### Extension Host (TypeScript)

- Registers VS Code commands and configuration.
- Spawns ChatDBG using Node's `child_process`.
- Parses traceback output into structured diagnostics.
- Manages message passing to the frontend.

### Frontend (Terminal Interface)

- Displays ChatDBG output (plain text or Markdown).
- Provides action buttons via status bar and command palette.
- Will evolve into a graphical webview in the next edition.

---

## Roadmap

| Stage | Focus | Description |
|-------|-------|-------------|
| **Terminal Edition** | Backend foundation | Command execution, diagnostics, logging |
| **UI Edition** | Webview experience | Interactive panel, Markdown chat, visual tracebacks, session history |

---

## Why Start with the Terminal Edition?

Developing the backend first ensured:

- A robust and well-tested execution core for ChatDBG.
- Clear understanding of its runtime behavior and traceback structure.
- Fast iteration cycles for research and lab experiments.
- A maintainable and easily extensible codebase for the upcoming UI Edition.

This version demonstrates full backend functionality and diagnostic reliability — the upcoming **UI Edition** will simply add polish, interactivity, and visualization.

---

## 👥 Author

**Tawsif Ibne Azad**  
Software Engineering Researcher — PLASMA Lab, University of Massachusetts Amherst

*ChatDBG VS Code Extension · Terminal Edition*