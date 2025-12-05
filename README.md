# ChatDBG VS Code Extension — Phase 1 UI Edition

**LLM-assisted debugging with a polished UI panel, now inside Visual Studio Code.**

This extension brings the power of ChatDBG directly into VS Code with a beautiful webview panel that streams ChatDBG output, displays AI explanations, and provides an intuitive debugging experience — all without leaving the editor.

---

## Overview

The **Phase 1 UI Edition** builds on the Terminal Edition backend with a gorgeous, interactive webview interface.

- **Dedicated ChatDBG Panel**: Streams ChatDBG output directly into VS Code as formatted markdown
- **Session History**: Keeps track of all your debugging runs with searchable transcripts
- **Beautiful Log Viewer**: Browse ChatDBG logs with structured cards, collapsible sections, and navigation
- **Smart Settings UI**: Configure Python interpreter, API key, model, and format directly in the panel
- **Zero Terminal Clutter**: All output goes to the panel, not the terminal

---

## Key Features

### 🎨 UI Panel

- **Dedicated ChatDBG Panel** (right sidebar): Displays streaming output in real-time
- **Transcript Area**: Shows the current run's output formatted as markdown
- **History Panel**: Lists all previous debugging sessions with timestamps and error summaries
- **Settings Panel**: Configure Python, OpenAI key, model selection, output format
- **Collapsible Sections**: Keep the panel clean while viewing detailed information

### 🚀 Commands

| Command | Description |
|---------|-------------|
| **ChatDBG: Open Panel** | Opens the ChatDBG panel (keyboard shortcut available) |
| **ChatDBG: Run Current File** | Runs active Python file under ChatDBG |
| **ChatDBG: Run & Explain** | Runs file and automatically asks "Why did this fail?" |
| **ChatDBG: Explain Last Error** | Smart button: continues session or runs "Run & Explain" if no terminal |
| **ChatDBG: Rerun Last** | Repeats the previous ChatDBG command |
| **ChatDBG: Open Last Log** | Opens beautiful log viewer with AI responses |

### 📋 Open Last Log Viewer

When you click "Open Last Log", a webview opens with:

- **Overview Card**: Command, status, model, timestamp
- **Input/Error Section**: The error that occurred (syntax highlighted)
- **Model Response**: Full AI explanation formatted as markdown
- **Metadata Sections**: Collapsible details on request parameters, stdout, stderr, raw JSON
- **Navigation**: Dropdown and Previous/Next buttons to browse log history
- **Actions**: Copy, Refresh, and "Open Raw" buttons

### ⚙️ Settings UI

Configure everything directly in the panel:

- 📦 **Python Interpreter**: Auto-detected or manually set
- 🤖 **AI Model**: Choose gpt-4o, gpt-4o-mini, or custom
- 📋 **Output Format**: Markdown (recommended) or plain text
- 🔑 **OpenAI API Key**: Set via environment or VS Code settings
- 🚀 **Unsafe Mode**: Enable experimental analysis features
- ✅ **Environment Check**: Verify Python and ChatDBG installation

### 📊 Session History

- Automatically saves all debugging sessions
- One-click replay to view any previous transcript
- Searchable by timestamp and filename
- Persists across panel opens (within session)

---

## Typical Workflow

```
1. Open a Python file with a bug
2. Click ChatDBG panel icon (or Cmd+Shift+P → "ChatDBG: Open Panel")
3. Click "Run & Explain" button
4. Watch output stream in real-time (5-50 seconds)
5. AI explanation appears in Transcript area
6. Click "Open Last Log" to see beautiful formatted version
7. Browse history, copy results, inspect raw logs
```

---

## Configuration

Add to VS Code `settings.json`:

```json
{
  "chatdbg.pythonPath": "/usr/bin/python3",
  "chatdbg.openaiKey": "sk-...",
  "chatdbg.model": "gpt-4o",
  "chatdbg.format": "md",
  "chatdbg.unsafe": false
}
```

| Setting | Description | Default |
|---------|-------------|---------|
| `pythonPath` | Python interpreter path | Auto-detected |
| `openaiKey` | OpenAI API key | From OPENAI_API_KEY env var |
| `model` | LLM model (gpt-4o, gpt-4o-mini, etc.) | gpt-4o |
| `format` | Output format (md or text) | md |
| `unsafe` | Enable --unsafe mode | false |

---

## Architecture

### Extension Backend (TypeScript)

- **Process Management**: Spawns ChatDBG CLI and captures output
- **YAML Parsing**: Extracts AI responses from ChatDBG log files
- **Command Handling**: Registers VS Code commands and responds to panel requests
- **Settings Management**: Persists user configuration

### Panel Frontend (HTML/CSS/JavaScript)

- **Real-time Rendering**: Displays streaming output with markdown formatting
- **Webview Communication**: Bidirectional messaging with extension via postMessage
- **Interactive UI**: Buttons, dropdowns, collapsible sections, copy-to-clipboard
- **Theme Integration**: Automatically adapts to VS Code dark/light theme

### Log Viewer (HTML/CSS/JavaScript)

- **Beautiful Layout**: Structured cards with VS Code styling
- **Navigation**: Entry dropdown and Previous/Next buttons
- **Markdown Support**: Renders AI responses with proper formatting
- **Responsive Design**: Works at any panel size

---

## How It Works

### Run & Explain Flow

1. User clicks "Run & Explain"
2. Extension launches ChatDBG with `-c continue` flag
3. Program runs, hits error, ChatDBG starts debugger
4. Extension sends `chat Why did this fail?` command
5. ChatDBG calls OpenAI API (3-8 seconds typical)
6. AI response streams to terminal
7. Extension captures output and sends to panel
8. Response displays in Transcript area (formatted markdown)
9. Session saved to `log.yaml` alongside Python file
10. History panel updates with new entry

### Open Last Log Flow

1. User clicks "Open Last Log" button
2. Extension finds most recent `log.yaml` file
3. Parses YAML array to extract session data
4. Extracts AI response from nested steps array
5. Creates LogEntry with formatted response
6. Opens new webview panel with beautiful log viewer
7. User can navigate entries, expand sections, copy data

---

## What's Included

### Source Code
- `src/extension.ts` — Main extension logic (2000+ lines)
- `src/panel/index.html` — ChatDBG panel UI
- `src/panel/index.js` — Panel event handling and streaming
- `src/panel/style.css` — VS Code theme-integrated styling
- `src/panel/openLog.html` — Log viewer panel
- `src/panel/openLog.js` — Log viewer logic

### Test Files
- `test_scripts/test_type_error.py` — Simple TypeError for testing
- `test_scripts/sample_log.yaml` — Sample ChatDBG log

---

## Testing

### Quick Test

```bash
1. Open test_scripts/test_type_error.py
2. Cmd+Shift+P → "ChatDBG: Open Panel"
3. Click "Run & Explain"
4. Watch transcript stream (should complete in 5-50 seconds)
5. Click "Open Last Log" to see beautiful viewer
```

### What You Should See

**Transcript Panel:**
```
ChatDBG Interactive Debugger
┌─ Running: python .../test_type_error.py
├─ Python: 3.11
├─ Model: gpt-4o
└─ Format: markdown

Stopped at line 16 in test_type_error.py
The error is: TypeError: can only concatenate str (not "int") to str

## Explanation

In the `concatenate_strings()` function, you're trying to add a string...

[Full AI response appears here, fully formatted]
```

**Log Viewer Panel:**
```
📋 ChatDBG — Last Log
Updated: 2:14:32 PM

Overview:
- Command: debug
- Status: ✅ Completed
- Model: gpt-4o
- Timestamp: Dec 5, 2025 2:14 PM

Input / Error: [expanded]
- Shows the error traceback

Model Response: [expanded]
- Full AI explanation with markdown formatting
```

---

## Keyboard Shortcuts

- `Cmd+Shift+P` → Type "ChatDBG" to see all available commands
- `Cmd+Shift+B` → Status bar button appears when Python file is active

---

## Performance & Reliability

- **Streaming Output**: Real-time display as ChatDBG produces output
- **Timeout Handling**: 45-second timeout for AI responses (covers 99% of cases)
- **Error Recovery**: Smart fallback behavior for missing terminals or logs
- **Log Parsing**: Simplified parser extracts AI responses reliably
- **No Performance Impact**: Panel updates don't block editor

---

## Limitations (Phase 1)

- **Batch Mode Only**: Runs ChatDBG, gets explanation, then exits (no interactive follow-ups)
- **No DAP Integration**: Not a full debugger with breakpoints/step-through
- **Session History**: Stored in memory (clears when VS Code restarts)
- **Single Entry Viewer**: "Open Last Log" shows most recent run (use Previous/Next to browse)

---

## Future Work (Phase 2+)

- Interactive mode with follow-up questions in the panel
- Debugger integration (breakpoints, step-through, watch)
- CodeLens integration for inline diagnostics
- Cost tracking and analytics
- Log filtering and search
- Team sharing of debugging sessions

---

## Security & Privacy

- ✅ No telemetry or remote data collection
- ✅ API keys stored locally only (in VS Code settings or environment)
- ✅ All processing happens locally
- ✅ No data sent anywhere except OpenAI API

---

## Troubleshooting

### "ChatDBG Panel not opening"
- Check that Python is installed: `python --version`
- Check that ChatDBG is installed: `python -m chatdbg --version`
- Click "Check Environment" in Settings panel

### "Run & Explain shows error"
- Make sure a `.py` file is active in editor
- Check that OpenAI API key is configured (should prompt if missing)
- Look at VS Code Output panel for error details

### "Open Last Log is empty"
- Make sure you've run "Run & Explain" at least once
- Check that `log.yaml` was created next to your Python file
- Try clicking "Refresh" in the log viewer

### "Transcript shows incomplete output"
- The 45-second timeout should be sufficient for most responses
- If response is still truncated, your response may be unusually complex
- Check the raw `log.yaml` file to see full response

---

## Implementation Notes

### Why SimpleParser?
The log parser is intentionally simple and straightforward:
- Load YAML file as array
- Get the last (most recent) session
- Extract AI response from nested steps
- Return single LogEntry

This avoids over-engineering and handles ChatDBG's actual log format reliably.

### Why 45-Second Timeout?
- Average ChatDBG response: 3-8 seconds
- Slow network/complex explanations: 10-30 seconds
- Safety buffer: +15 seconds
- Result: Handles 99% of cases without truncation

---

## Author

**Tawsif Ibne Azad**
Software Engineering Researcher — PLASMA Lab, University of Massachusetts Amherst

---

## License

See LICENSE file in repository.

---

## Contributing

Contributions welcome! Please check CONTRIBUTING.md for guidelines.

---

**ChatDBG VS Code Extension · Phase 1 UI Edition**
*LLM-assisted debugging, beautifully integrated into your IDE*
