import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { promises as fs } from 'fs';

/* ============================================================
   Type Definitions
   ============================================================ */

/**
 * Represents a single ChatDBG run in the history panel.
 */
interface RunSummary {
  id: string;          // Unique identifier (timestamp-based)
  file: string;        // Python file that was debugged
  args: string;        // Command-line arguments used
  timestamp: number;   // When the run occurred
  status: string;      // Run status ('done', 'error', etc.)
  summary: string;     // Brief summary of the run/explanation
  logPath?: string;    // Path to the log.yaml file for this run
}

/**
 * Configuration settings displayed and editable in the webview panel.
 */
interface PanelSettings {
  python: string;                           // Path to Python interpreter
  activationCommand: string;                // Shell command to activate Python environment
  model: string;                            // AI model to use (e.g., 'gpt-4o')
  format: string;                           // Output format ('md' or 'text')
  unsafe: boolean;                          // Whether to enable unsafe mode
  keySource: 'env' | 'settings' | 'none';   // Where OpenAI API key is configured
}

/* ============================================================
   Global State
   ============================================================ */

// Stores the last command executed for quick rerun functionality
let lastRunCmd: string | null = null;

// Stores the last Python file that was debugged
let lastRunFile: string | null = null;

// Array of past debugging sessions for the history panel
const runHistory: RunSummary[] = [];

// Maps run IDs to their full transcript text for replay in the panel
const runTranscripts = new Map<string, string>();

/* ============================================================
   Utility Functions
   ============================================================ */

/**
 * Generates a cryptographically random nonce for Content Security Policy.
 * Used to secure the webview by allowing only specific scripts to execute.
 *
 * @returns A 32-character random string
 */
function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/* ============================================================
   ChatDBG Webview Panel
   ============================================================ */

/**
 * Manages the ChatDBG interactive UI panel.
 *
 * This class implements a singleton webview panel that displays:
 * - Real-time debugging output and AI explanations
 * - Run history for replaying past sessions
 * - Diagnostic information with clickable file locations
 * - Settings interface for configuring ChatDBG
 *
 * Communication Model:
 * - Extension → Webview: postMessage() sends data (output, history, settings)
 * - Webview → Extension: onDidReceiveMessage() handles user actions (run, settings changes)
 */
class ChatDBGPanel {
  // Singleton instance - only one panel can be open at a time
  public static currentPanel: ChatDBGPanel | undefined;

  // Unique identifier for this panel type
  public static readonly viewType = 'chatdbg.panel';

  /**
   * Sends a message to the webview panel if it's currently open.
   * Used by other parts of the extension to update the UI.
   *
   * @param message - Any JSON-serializable object to send to the webview
   */
  public static postToWebview(message: any) {
    if (!ChatDBGPanel.currentPanel) return;
    ChatDBGPanel.currentPanel.panel.webview.postMessage(message);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  /**
   * Creates or reveals the ChatDBG panel.
   * Implements singleton pattern - if panel exists, just brings it to front.
   *
   * @param extensionUri - URI of the extension directory (for loading webview resources)
   */
  public static createOrShow(extensionUri: vscode.Uri) {
    // If panel already exists, just reveal it in the right column
    if (ChatDBGPanel.currentPanel) {
      ChatDBGPanel.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    // Create new webview panel - always in the right column (ViewColumn.Two)
    // This provides a consistent, split-view experience with code on left, ChatDBG on right
    const panel = vscode.window.createWebviewPanel(
      ChatDBGPanel.viewType,
      'ChatDBG',
      vscode.ViewColumn.Two, // Always open on the right side
      {
        enableScripts: true, // Required for interactive UI
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'panel')],
        retainContextWhenHidden: true, // Keep panel state when hidden
      }
    );

    ChatDBGPanel.currentPanel = new ChatDBGPanel(panel, extensionUri);
  }

  /**
   * Private constructor - use createOrShow() instead.
   * Sets up message handlers for bidirectional communication with the webview.
   *
   * @param panel - The webview panel instance
   * @param extensionUri - URI of the extension directory
   */
  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Clean up resources when panel is closed
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Set up message handler for webview → extension communication
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (!message || typeof message !== 'object') {
          return;
        }

        switch (message.type) {
          case 'webviewReady': {
            // Webview has loaded and is ready to receive data
            console.log('[ChatDBGPanel] webviewReady');
            this.panel.webview.postMessage({
              type: 'hello',
              text: 'Webview connected',
            });
            // Send initial state to populate the UI
            this.sendSettings();
            this.sendHistory();
            break;
          }

          case 'run': {
            // User clicked "Run" button - execute without explanation
            console.log('[ChatDBGPanel] run');
            const runId = Date.now().toString();

            this.panel.webview.postMessage({
              type: 'runStarted',
              runId,
              command: 'chatdbg.runCurrentFile',
            });

            this.panel.webview.postMessage({
              type: 'output',
              runId,
              chunk: '▶ Running under ChatDBG (no explanation query).\n',
            });

            await vscode.commands.executeCommand('chatdbg.runCurrentFile');

            this.panel.webview.postMessage({
              type: 'runFinished',
              runId,
              status: 'done',
            });

            break;
          }

          // case 'runExplain': {
          //   // User clicked "Run & Explain" - execute and automatically ask AI to explain failures
          //   console.log('[ChatDBGPanel] runExplain');
          //   const runId = Date.now().toString();

          //   this.panel.webview.postMessage({
          //     type: 'runStarted',
          //     runId,
          //     command: 'chatdbg.runAndExplain',
          //   });

          //   this.panel.webview.postMessage({
          //     type: 'output',
          //     runId,
          //     chunk: '▶ Running with ChatDBG (Run & Explain)...\n',
          //   });

          //   await vscode.commands.executeCommand('chatdbg.runAndExplain');

          //   // Wait for log.yaml to be written and parse the AI explanation
          //   const file =
          //     lastRunFile || vscode.window.activeTextEditor?.document.fileName;
          //   if (file) {
          //     const logPath = path.join(path.dirname(file), 'log.yaml');
          //     await waitForLogAndSend(this.panel, runId, logPath, file);
          //   }

          //   this.panel.webview.postMessage({
          //     type: 'runFinished',
          //     runId,
          //     status: 'done',
          //   });

          //   break;
          // }
          case 'runExplain': {
            // User clicked "Run & Explain" - execute and automatically ask AI to explain failures
            console.log('[ChatDBGPanel] runExplain');
            const runId = Date.now().toString();
          
            this.panel.webview.postMessage({
              type: 'runStarted',
              runId,
              command: 'chatdbg.runAndExplain',
            });
          
            this.panel.webview.postMessage({
              type: 'output',
              runId,
              chunk: '▶ Running with ChatDBG (Run & Explain)...\n',
            });
          
            // Determine target file and log path up front
            const file =
              lastRunFile || vscode.window.activeTextEditor?.document.fileName;
          
            let logPath: string | null = null;
            let baselineMtimeMs = 0;
          
            if (file) {
              logPath = path.join(path.dirname(file), 'log.yaml');
              try {
                const st = await fs.stat(logPath);
                baselineMtimeMs = st.mtimeMs;   // existing log file mtime (from previous run)
              } catch {
                baselineMtimeMs = 0;            // file does not exist yet
              }
            }
          
            // Kick off the actual ChatDBG Run & Explain command (returns quickly)
            await vscode.commands.executeCommand('chatdbg.runAndExplain');
          
            // Now wait for log.yaml to be UPDATED (mtime > baseline) and then parse
            if (file && logPath) {
              await waitForLogAndSend(this.panel, runId, logPath, file, baselineMtimeMs);
            }
          
            this.panel.webview.postMessage({
              type: 'runFinished',
              runId,
              status: 'done',
            });
          
            break;
          }
          
          case 'explainLast': {
            // User clicked "Explain Last Error" - run diagnostics on the last execution
            console.log('[ChatDBGPanel] explainLast (runWithDiagnostics)');
            await vscode.commands.executeCommand('chatdbg.runWithDiagnostics');
            break;
          }

          case 'rerunLast': {
            // User clicked "Rerun Last" - repeat the previous debugging session
            console.log('[ChatDBGPanel] rerunLast');
            await vscode.commands.executeCommand('chatdbg.rerunLast');
            break;
          }

          case 'openLog': {
            // User clicked "Open Last Log" - open log.yaml file in editor
            console.log('[ChatDBGPanel] openLog');
            await vscode.commands.executeCommand('chatdbg.openLog');
            break;
          }

          case 'openLocation': {
            // User clicked a file location in diagnostics - navigate to that line
            const { file, line } = message;
            if (typeof file === 'string' && typeof line === 'number') {
              const uri = vscode.Uri.file(file);
              vscode.workspace.openTextDocument(uri).then(doc => {
                vscode.window.showTextDocument(doc, { preview: false }).then(editor => {
                  const pos = new vscode.Position(Math.max(0, line - 1), 0);
                  editor.selection = new vscode.Selection(pos, pos);
                  editor.revealRange(
                    new vscode.Range(pos, pos),
                    vscode.TextEditorRevealType.InCenter
                  );
                });
              });
            }
            break;
          }

          case 'selectRun': {
            // User selected a run from history - display its transcript
            const runId = message.runId as string;
            const transcript = runTranscripts.get(runId);
            if (transcript) {
              this.panel.webview.postMessage({
                type: 'showTranscript',
                runId,
                transcript,
              });
            }
            break;
          }

          case 'changeSettings': {
            // User modified settings in the panel - persist to workspace config
            const settings = message.settings || {};
            await applySettingsChange(settings);
            this.sendSettings(); // Send back canonical values
            break;
          }

          case 'testEnvironment': {
            // User clicked "Test Environment" - verify ChatDBG installation
            const result = await runEnvironmentCheck();
            this.panel.webview.postMessage({
              type: 'envCheckResult',
              ok: result.ok,
              summary: result.summary,
              output: result.output,
            });
            break;
          }

          default: {
            console.log('[ChatDBGPanel] unknown message type', message.type);
          }
        }
      },
      null,
      this.disposables
    );

    // Initialize the webview HTML content
    this.update();
  }

  /**
   * Sends current ChatDBG configuration to the webview.
   * Called on initialization and after settings changes.
   */
  private sendSettings() {
    const settings = getCurrentSettings();
    this.panel.webview.postMessage({
      type: 'settings',
      settings,
    });
  }

  /**
   * Sends the run history to the webview.
   * Called on initialization and after each debugging run.
   */
  private sendHistory() {
    this.panel.webview.postMessage({
      type: 'history',
      items: runHistory,
    });
  }

  /**
   * Cleans up resources when the panel is closed.
   * Disposes of all event listeners and resets the singleton instance.
   */
  public dispose() {
    ChatDBGPanel.currentPanel = undefined;

    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  /**
   * Refreshes the webview HTML content.
   * Called once during initialization.
   */
  private update() {
    const webview = this.panel.webview;
    this.panel.webview.html = this.getHtmlForWebview(webview);
  }

  /**
   * Generates the HTML content for the webview panel.
   * Includes the UI structure, scripts, and styling with proper CSP headers.
   *
   * @param webview - The webview instance (needed to convert URIs to webview-accessible format)
   * @returns HTML string for the webview
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    // Convert local file paths to webview URIs
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'panel', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'panel', 'style.css')
    );
    const markedUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'panel', 'marked.min.js')
    );

    // Generate nonce for Content Security Policy
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 img-src ${webview.cspSource} https: data:;">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>ChatDBG</title>
      <link rel="stylesheet" href="${styleUri}" />
    </head>
    <body>
      <div id="root">
        <header id="toolbar">
          <div class="toolbar-left">
            <button id="btn-run">Run</button>
            <button id="btn-run-explain">Run &amp; Explain</button>
            <button id="btn-explain-last">Explain Last Error</button>
            <button id="btn-rerun-last">Rerun Last</button>
            <button id="btn-open-log">Open Last Log</button>
          </div>
          <div class="toolbar-right">
            <span id="status-pill">Idle</span>
          </div>
        </header>

        <main id="main-layout">
          <section id="transcript-panel" class="panel">
            <header class="panel-header">
              <h3>Transcript</h3>
            </header>
            <div id="transcript-body" class="panel-body scrollable markdown"></div>
          </section>

          <aside id="side-panel">
            <section id="diagnostics-panel" class="panel">
              <header class="panel-header">
                <h4>Diagnostics</h4>
              </header>
              <div id="diagnostics-body" class="panel-body scrollable">
                <div class="empty-state">No diagnostics yet.</div>
              </div>
            </section>

            <section id="history-panel" class="panel">
              <header class="panel-header">
                <h4>History</h4>
              </header>
              <div id="history-body" class="panel-body scrollable">
                <div class="empty-state">No runs yet.</div>
              </div>
            </section>

            <section id="settings-panel" class="panel settings-collapsed">
  <header class="panel-header settings-header">
    <div class="settings-header-left">
      <h4>⚙️ Configuration</h4>
      <div class="settings-summary">
        <span id="settings-env-pill" class="pill pill-env" title="Python interpreter">📦 Python env</span>
        <span id="settings-model-pill" class="pill pill-model" title="AI model">🤖 Model: --</span>
        <span id="settings-key-pill" class="pill pill-key pill-warning" title="OpenAI API key">🔑 Not set</span>
      </div>
    </div>
    <button id="settings-toggle" class="settings-toggle-btn" title="Show/hide settings">
      <span class="toggle-arrow">▼</span>
    </button>
  </header>

  <div id="settings-body" class="panel-body scrollable settings-body">
    <!-- Python Environment Section -->
    <div class="settings-section">
      <div class="settings-section-title">Python Environment</div>

      <div class="settings-row">
        <label class="settings-label">
          Python Interpreter
          <span class="settings-label-help" title="Path to Python executable">ℹ️</span>
        </label>
        <div id="cfg-interpreter" class="settings-value code-mono">--</div>
        <div class="settings-status warning" style="display: none;" id="cfg-interpreter-hint">
          💡 From Python extension or chatdbg.pythonPath setting
        </div>
      </div>

      <div class="settings-row">
        <label class="settings-label">
          Environment Activation
          <span class="settings-label-help" title="Command to activate Python environment">ℹ️</span>
        </label>
        <div id="cfg-activation" class="settings-value code-mono">--</div>
      </div>

      <div class="settings-row">
        <label class="settings-label">
          OpenAI API Key
          <span class="settings-label-help" title="Where API key is configured">ℹ️</span>
        </label>
        <div id="cfg-openai-key" class="settings-value">
          Not configured
        </div>
        <div class="settings-status warning" style="margin-top: 0.5rem;">
          ⚠️ API key required to use ChatDBG
        </div>
      </div>
    </div>

    <!-- Behavior & Preferences Section -->
    <div class="settings-section">
      <div class="settings-section-title">Behavior &amp; Preferences</div>

      <div class="settings-row">
        <label class="settings-label" for="cfg-model">
          AI Model
          <span class="settings-label-help" title="Which OpenAI model to use">ℹ️</span>
        </label>
        <input
          id="cfg-model"
          class="settings-input"
          type="text"
          placeholder="e.g., gpt-4o-mini, gpt-4o"
          title="Leave empty for default model"
        />
        <div class="settings-status" style="font-size: 11px; margin-top: 0.3rem;">
          Examples: gpt-4o (recommended), gpt-4o-mini (cheaper), gpt-3.5-turbo
        </div>
      </div>

      <div class="settings-row">
        <label class="settings-label" for="cfg-format">
          Output Format
          <span class="settings-label-help" title="How to format explanations">ℹ️</span>
        </label>
        <select id="cfg-format" class="settings-input">
          <option value="md">📝 Markdown (recommended)</option>
          <option value="text">📄 Plain text</option>
        </select>
      </div>

      <div class="settings-row settings-row-inline">
        <label class="settings-checkbox" title="Allow ChatDBG to execute arbitrary code during diagnosis (experimental)">
          <input id="cfg-unsafe" type="checkbox" />
          <span>🚀 Unsafe mode (execute code)</span>
        </label>
      </div>
      <div class="settings-status warning">
        Advanced: Allows more thorough but potentially risky analysis
      </div>
    </div>

    <!-- Tools Section -->
    <div class="settings-footer">
      <div style="margin-bottom: 0.3rem;">
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 0.5rem;">Tools</div>
        <button id="btn-test-env" title="Test Python environment and ChatDBG installation">
          🔍 Check Environment
        </button>
      </div>
      <div id="env-status" class="env-status"></div>
    </div>
  </div>
</section>

          </aside>
        </main>

        <footer id="status-bar">
          <span id="status-text">Ready.</span>
        </footer>
      </div>

      <script nonce="${nonce}" src="${markedUri}"></script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }
}

/* ============================================================
   Shared Helpers - Configuration & Utilities
   ============================================================ */

// Diagnostic collection for displaying error markers in the editor
const DIAG_COLLECTION = vscode.languages.createDiagnosticCollection('chatdbg');

// Workspace state keys for persisting data across VSCode sessions
const STORAGE_LAST_CMD   = 'chatdbg.lastCommand';
const STORAGE_LAST_FILE  = 'chatdbg.lastFile';
const STORAGE_LAST_ARGS  = 'chatdbg.lastArgs';
const STORAGE_LAST_STDIN = 'chatdbg.lastStdin';

/**
 * Escapes a string for safe use in shell commands.
 * Wraps in double quotes and escapes special characters like $, `, ", and \.
 *
 * @param s - String to quote
 * @returns Shell-safe quoted string
 */
function shQuote(s: string): string {
  return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * Joins command-line arguments, quoting those that contain spaces.
 *
 * @param args - Array of argument strings
 * @returns Space-separated argument string with proper quoting
 */
function joinArgs(args: string[]) {
  return args.map(a => (/\s/.test(a) ? shQuote(a) : a)).join(' ');
}

/**
 * Removes ANSI escape codes (colors, formatting) from terminal output.
 * Necessary for parsing chatdbg output which may contain color codes.
 *
 * @param s - String potentially containing ANSI codes
 * @returns Clean string without ANSI codes
 */
function stripAnsi(s: string): string {
  return s.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/**
 * Gets the configured Python interpreter path.
 * Prefers the Python extension's configured interpreter, falls back to ChatDBG setting.
 *
 * @returns Path to Python interpreter
 */
function getConfiguredPython(): string {
  const fromPyExt = vscode.workspace.getConfiguration('python').get<string>('defaultInterpreterPath');
  const fallback = vscode.workspace.getConfiguration('chatdbg').get<string>('pythonPath')
    || '/opt/miniconda3/envs/chatdbg/bin/python';
  return (fromPyExt && fromPyExt.trim()) ? fromPyExt : fallback;
}

/**
 * Gets the shell command to activate the Python environment.
 *
 * @returns Activation command (e.g., 'source /path/to/activate chatdbg')
 */
function getActivationCommand(): string {
  return vscode.workspace.getConfiguration('chatdbg').get<string>('activationCommand')
    || 'source /opt/miniconda3/bin/activate chatdbg';
}

/**
 * Gets or creates the ChatDBG terminal.
 * Always creates a fresh terminal to avoid state pollution from previous runs.
 * Passes OpenAI API key through environment if configured in settings.
 *
 * @returns A new ChatDBG terminal instance
 */
function getOrCreateTerminal(): vscode.Terminal {
  // Kill any existing ChatDBG terminal and its processes
  const existing = vscode.window.terminals.find(t => t.name === 'ChatDBG');
  if (existing) {
    // Send Ctrl+C and exit to kill any running ChatDBG process
    existing.sendText('\x03'); // Ctrl+C to interrupt
    existing.sendText('exit');  // Exit the shell

    // Dispose immediately - VSCode will handle cleanup
    existing.dispose();
  }

  // Build environment with OpenAI API key if configured
  const openaiKey = vscode.workspace.getConfiguration('chatdbg').get<string>('openaiKey') || '';
  const env: { [key: string]: string } = {};

  if (openaiKey.trim()) {
    env.OPENAI_API_KEY = openaiKey.trim();
  }

  // Create terminal with environment variables
  return vscode.window.createTerminal({
    name: 'ChatDBG',
    env: Object.keys(env).length > 0 ? env : undefined
  });
}

/**
 * Builds ChatDBG command-line flags for model and format settings.
 *
 * @returns Array of flags like ['--model', 'gpt-4o', '--format', 'md']
 */
function getModelFormatFlags(): string[] {
  const cfg = vscode.workspace.getConfiguration('chatdbg');
  const model  = (cfg.get<string>('model')  || '').trim();
  const format = (cfg.get<string>('format') || '').trim();
  const flags: string[] = [];
  if (model)  flags.push('--model', model);
  if (format) flags.push('--format', format);
  return flags;
}

/**
 * Gets the --unsafe flag if enabled in settings.
 * Unsafe mode allows ChatDBG to execute arbitrary code during diagnosis.
 *
 * @returns Array containing ['--unsafe'] if enabled, empty array otherwise
 */
function getUnsafeFlag(): string[] {
  const cfg = vscode.workspace.getConfiguration('chatdbg');
  return cfg.get<boolean>('unsafe') ? ['--unsafe'] : [];
}

/**
 * Removes --format flag and its value from a flag array.
 * Used when we need to force a specific format (e.g., 'text' for diagnostics).
 *
 * @param flags - Array of command-line flags
 * @returns New array with --format flag removed
 */
function stripFormatFlag(flags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--format') { i++; continue; } // Skip --format and its value
    out.push(flags[i]);
  }
  return out;
}

/* ============================================================
   Cost Display - Status Bar Badge
   ============================================================ */

// Status bar item for displaying the approximate cost of the last ChatDBG run
let costItem: vscode.StatusBarItem | null = null;

// Regex to extract cost information from ChatDBG output
const COST_RE = /\[Cost:\s*~\$(.+?)\s*USD]/i;

/**
 * Shows or hides the cost badge in the status bar.
 *
 * @param text - Cost text to display (e.g., "$0.05"), or undefined to hide the badge
 */
function setCostUI(text?: string) {
  if (!costItem) {
    costItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    costItem.tooltip = 'Last ChatDBG run cost (approx.)';
  }
  if (text) {
    costItem.text = `$(meter) ${text}`;
    costItem.show();
  } else {
    costItem.hide();
  }
}

/* ============================================================
   Log File Parsing & History Management
   ============================================================ */

/**
 * Parses ChatDBG's log.yaml file and extracts the AI explanation.
 * Sends the transcript to the webview panel and updates run history.
 *
 * ChatDBG generates a YAML log with structured steps. This function:
 * 1. Loads all YAML documents from the file
 * 2. Extracts text output from 'chat' type steps
 * 3. Sends the explanation to the webview
 * 4. Adds an entry to the run history for later replay
 *
 * @param panel - Webview panel to send messages to
 * @param runId - Unique identifier for this run
 * @param logPath - Path to the log.yaml file
 * @param file - Python file that was debugged
 */
async function parseLogYamlAndSendToPanel(
  panel: vscode.WebviewPanel,
  runId: string,
  logPath: string,
  file: string
) {
  try {
    const raw = await fs.readFile(logPath, 'utf8');

    // Parse all YAML documents in the file
    const docs: any[] = [];
    yaml.loadAll(raw, (d) => docs.push(d));

    // Get the most recent document (or element if it's an array)
    let latest: any = docs.length ? docs[docs.length - 1] : null;
    if (Array.isArray(latest)) latest = latest.length ? latest[latest.length - 1] : null;

    const log = latest || {};

    // Extract all text chunks from chat-type output steps
    const chunks: string[] = [];
    for (const step of log.steps ?? []) {
      if (step?.output?.type === 'chat') {
        for (const out of step.output.outputs ?? []) {
          if (out?.type === 'text' && typeof out.output === 'string') {
            chunks.push(out.output);
          }
        }
      }
    }

    const explanation = chunks.join('\n\n') || raw;

    // Send explanation to webview
    panel.webview.postMessage({
      type: 'output',
      runId,
      chunk: explanation,
    });

    // Store transcript for history replay
    runTranscripts.set(runId, explanation);

    // Generate a brief summary from the first non-empty line
    let summary = '';
    const firstLine = explanation.split(/\r?\n/).find(l => l.trim().length > 0);
    if (firstLine) summary = firstLine.replace(/^#+\s*/, '').slice(0, 200);

    // Add to history
    const summaryItem: RunSummary = {
      id: runId,
      file,
      args: '',
      timestamp: Date.now(),
      status: 'done',
      summary,
      logPath,
    };

    runHistory.push(summaryItem);
    while (runHistory.length > 50) runHistory.shift(); // Keep only last 50 runs

    // Update history in webview
    ChatDBGPanel.postToWebview({
      type: 'history',
      items: runHistory,
    });
  } catch (err) {
    panel.webview.postMessage({
      type: 'output',
      runId,
      chunk: `Failed to load log.yaml: ${String(err)}`,
    });
  }
}

/* ============================================================
   Log Flag Detection (--log vs --logfile)
   ============================================================ */

// Cached result for the correct log flag to use
let resolvedLogFlag: '--log' | '--logfile' | null = null;

/**
 * Detects which log flag the installed ChatDBG version uses.
 * Different versions use either --log or --logfile. We detect this by
 * running `chatdbg --help` and checking which flag appears.
 *
 * @param python - Path to Python interpreter
 * @returns The correct log flag for this ChatDBG version
 */
async function detectLogFlag(python: string): Promise<'--log' | '--logfile'> {
  if (resolvedLogFlag) return resolvedLogFlag;

  const helpCmd = `${shQuote(python)} -m chatdbg --help`;
  const out = await new Promise<string>((resolve) => {
    const child = spawn(helpCmd, { shell: true });
    let buf = '';
    child.stdout.on('data', (d) => (buf += d.toString()));
    child.stderr.on('data', (d) => (buf += d.toString()));
    child.on('close', () => resolve(buf));
  });

  resolvedLogFlag = /--logfile\b/.test(out) ? '--logfile' : '--log';
  return resolvedLogFlag;
}

/**
 * Builds the log flag arguments for ChatDBG.
 *
 * @param python - Path to Python interpreter
 * @param logPath - Path where log.yaml should be written
 * @returns Array like ['--logfile', '/path/to/log.yaml'] or ['--log', '/path/to/log.yaml']
 */
async function getLogArgs(python: string, logPath: string): Promise<string[]> {
  const flag = await detectLogFlag(python);
  return [flag, logPath];
}

/**
 * Polls for the log.yaml file to appear, then parses and sends it to the webview.
 * ChatDBG writes log.yaml asynchronously, so we need to wait for it.
 *
 * @param panel - Webview panel to send data to
 * @param runId - Unique identifier for this run
 * @param logPath - Path to the log.yaml file
 * @param file - Python file being debugged
 * @param attempts - Maximum number of polling attempts (default: 80)
 * @param delayMs - Delay between attempts in milliseconds (default: 300ms)
 */
// async function waitForLogAndSend(
//   panel: vscode.WebviewPanel,
//   runId: string,
//   logPath: string,
//   file: string,
//   attempts = 120, // Increased from 80 to 120 attempts
//   delayMs = 500   // Increased from 300ms to 500ms (total: 60 seconds)
// ) {
//   for (let i = 0; i < attempts; i++) {
//     try {
//       await fs.stat(logPath); // Check if file exists
//       await parseLogYamlAndSendToPanel(panel, runId, logPath, file);
//       return;
//     } catch {
//       await new Promise(res => setTimeout(res, delayMs));
//     }
//   }

//   // Timeout - file never appeared
//   panel.webview.postMessage({
//     type: 'output',
//     runId,
//     chunk: `Failed to load log.yaml after waiting. Looked for: ${logPath}\n`
//   });
// }
async function waitForLogAndSend(
  panel: vscode.WebviewPanel,
  runId: string,
  logPath: string,
  file: string,
  baselineMtimeMs = 0,
  attempts = 90,   // ~45 seconds at 500ms
  delayMs = 500
) {
  for (let i = 0; i < attempts; i++) {
    try {
      const st = await fs.stat(logPath);

      // If there was no file before, any existing file is "new".
      // If there *was* a file, wait until its mtime has advanced.
      if (baselineMtimeMs === 0 || st.mtimeMs > baselineMtimeMs) {
        await parseLogYamlAndSendToPanel(panel, runId, logPath, file);
        return;
      }
      // Otherwise, file exists but hasn't been updated yet.
    } catch {
      // File does not exist yet; keep waiting.
    }

    await new Promise(res => setTimeout(res, delayMs));
  }

  // Timeout - file never appeared or never updated
  panel.webview.postMessage({
    type: 'output',
    runId,
    chunk: `Failed to load an updated log.yaml after waiting. Looked for: ${logPath}\n`,
  });
}

/* ============================================================
   OpenAI API Key Management
   ============================================================ */

/**
 * Ensures an OpenAI API key is configured before running ChatDBG.
 * Checks both settings and environment variables. If neither is set,
 * prompts the user to enter a key.
 *
 * @param context - Extension context for accessing settings
 * @param onReRun - Optional callback to re-run command after key is entered
 * @returns true if key is configured, false if user skipped
 */
async function ensureOpenAIKeyInteractive(context: vscode.ExtensionContext, onReRun?: () => void) {
  const cfgKey = (vscode.workspace.getConfiguration('chatdbg').get<string>('openaiKey') || '').trim();
  const envKey = (process.env.OPENAI_API_KEY || '').trim();

  // Key already configured
  if (cfgKey || envKey) return true;

  // Prompt user to enter key
  const choice = await vscode.window.showWarningMessage(
    'OpenAI API key not set for ChatDBG.',
    'Enter key & re-run',
    'Skip'
  );
  if (choice !== 'Enter key & re-run') return false;

  const entered = await vscode.window.showInputBox({
    title: 'Enter OpenAI API key',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...'
  });
  if (!entered || !entered.trim()) return false;

  // Save to user settings
  await vscode.workspace.getConfiguration('chatdbg').update('openaiKey', entered.trim(), true);
  vscode.window.showInformationMessage('Saved to Settings → chatdbg.openaiKey');

  // Optionally re-run the command
  if (onReRun) onReRun();
  return true;
}

/* ============================================================
   Program Arguments & Standard Input Prompts
   ============================================================ */

/**
 * Prompts the user to enter program arguments and stdin for the Python script.
 * Remembers previous values for convenience.
 *
 * @param context - Extension context for persisting user inputs
 */
async function promptArgsAndStdin(context: vscode.ExtensionContext) {
  const prevArgs  = context.workspaceState.get<string>(STORAGE_LAST_ARGS)  || '';
  const prevStdin = context.workspaceState.get<string>(STORAGE_LAST_STDIN) || '';

  const args = await vscode.window.showInputBox({
    title: 'Program arguments (space-separated)',
    value: prevArgs,
    placeHolder: 'e.g., --flag 123 input.txt'
  });
  if (args === undefined) return; // User cancelled

  const stdin = await vscode.window.showInputBox({
    title: 'stdin (press Enter for empty; use ⇧Enter for newline)',
    value: prevStdin,
    prompt: 'Multiline supported',
    ignoreFocusOut: true
  });
  if (stdin === undefined) return; // User cancelled

  // Persist for next time
  await context.workspaceState.update(STORAGE_LAST_ARGS, args);
  await context.workspaceState.update(STORAGE_LAST_STDIN, stdin);
}

/**
 * Helper to check if a string has non-whitespace content.
 */
function hasText(s?: string | null) { return !!s && s.trim().length > 0; }

/* ============================================================
   Command: Run with Custom Arguments & Standard Input
   ============================================================ */

/**
 * Runs the current Python file with ChatDBG, prompting for program arguments and stdin.
 * This is useful for scripts that need command-line parameters or piped input.
 *
 * @param context - Extension context
 */
async function runWithArgs(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }
  const file = editor.document.fileName;
  if (!file.toLowerCase().endsWith('.py')) {
    vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
    return;
  }

  const logPath = path.join(path.dirname(file), 'log.yaml');

  // Prompt user for args and stdin
  await promptArgsAndStdin(context);

  const userArgs  = context.workspaceState.get<string>(STORAGE_LAST_ARGS)  || '';
  const userStdin = context.workspaceState.get<string>(STORAGE_LAST_STDIN) || '';

  const python        = getConfiguredPython();
  const activationCmd = getActivationCommand();

  // Verify ChatDBG is installed
  if (!(await ensureChatdbgInstalled(python))) {
    vscode.window.showErrorMessage(
      'ChatDBG is not installed for the selected Python interpreter.',
      'Open Settings', 'Copy pip install command'
    ).then(choice => {
      if (choice === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:plasma-umass.chatdbg chatdbg.pythonPath');
      } else if (choice === 'Copy pip install command') {
        vscode.env.clipboard.writeText(`${python} -m pip install chatdbg`);
        vscode.window.showInformationMessage('Copied: python -m pip install chatdbg');
      }
    });
    return;
  }

  // Build command with args and stdin redirection
  const logArgs = await getLogArgs(python, logPath);
  const args = ['-m', 'chatdbg', ...getUnsafeFlag(), ...getModelFormatFlags(), ...logArgs, '-c', 'continue', file];
  const pyQuoted = /\s/.test(python) ? shQuote(python) : python;

  const withUserArgs = userArgs.trim().length ? ` ${userArgs}` : '';
  const stdinBlock = hasText(userStdin)
    ? ` <<'__CHATDBG_STDIN__'\n${userStdin}\n__CHATDBG_STDIN__`
    : '';

  const cmd =
    `${activationCmd} && echo Using Python: ${shQuote(python)} && ` +
    `${pyQuoted} ${joinArgs(args)}${withUserArgs}${stdinBlock}`;
  lastRunCmd = cmd;

  await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

  const term = getOrCreateTerminal();
  term.show(true);
  exportKeyIfConfigured(term);
  term.sendText(cmd);

  await saveLastRun(context, cmd, file);
}

/* ============================================================
   Command: Clear Saved Arguments & Stdin
   ============================================================ */

/**
 * Clears the saved program arguments and stdin values.
 *
 * @param context - Extension context
 */
async function clearSavedArgs(context: vscode.ExtensionContext) {
  await context.workspaceState.update(STORAGE_LAST_ARGS, '');
  await context.workspaceState.update(STORAGE_LAST_STDIN, '');
  vscode.window.showInformationMessage('ChatDBG: cleared saved args/stdin.');
}

/* ============================================================
   Installation Check
   ============================================================ */

/**
 * Checks if ChatDBG is installed for the given Python interpreter.
 * Runs `python -m chatdbg -h` to verify.
 *
 * @param python - Path to Python interpreter
 * @returns true if ChatDBG is installed, false otherwise
 */
async function ensureChatdbgInstalled(python: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const cmd = `${shQuote(python)} -m chatdbg -h`;
    const child = spawn(cmd, { shell: true });
    let ok = true;
    child.on('error', () => { ok = false; });
    child.on('close', (code) => resolve(code === 0 && ok));
  });
}

/* ============================================================
   Command: Open Log File
   ============================================================ */

// Global reference to log viewer panel
let logViewerPanel: vscode.WebviewPanel | undefined;

/**
 * Represents a single log entry from ChatDBG
 */
interface LogEntry {
  timestamp?: string;
  command?: string;
  input?: string;
  status?: string;
  stdout?: string;
  stderr?: string;
  model?: {
    name?: string;
    request_meta?: any;
    response_summary?: string;
    response_full?: string;
  };
  [key: string]: any; // Allow other fields from raw YAML
}

/**
 * Opens a beautiful log viewer for the most recent ChatDBG log.
 * Creates a webview panel with:
 * - Structured overview cards
 * - Collapsible sections for input, model request, response, stdout/stderr
 * - Navigation between log entries
 * - Copy to clipboard functionality
 *
 * @param context - Extension context
 */
async function openLog(context: vscode.ExtensionContext) {
  let logUri: vscode.Uri | null = null;
  let fileNameForToast = '';

  // Strategy 1: Find log.yaml next to the last debugged file
  const lastFile = context.workspaceState.get<string>(STORAGE_LAST_FILE);
  if (lastFile) {
    const dir = path.dirname(lastFile);
    try {
      const candidate = vscode.Uri.file(path.join(dir, 'log.yaml'));
      await vscode.workspace.fs.stat(candidate);
      logUri = candidate;
      fileNameForToast = path.basename(lastFile);
    } catch {}
  }

  // Strategy 2: Search workspace for log.yaml files
  if (!logUri && vscode.workspace.workspaceFolders?.length) {
    const found = await vscode.workspace.findFiles('**/log.yaml', '**/node_modules/**', 1);
    if (found.length) {
      logUri = found[0];
      fileNameForToast = 'last run';
    }
  }

  if (!logUri) {
    vscode.window.showInformationMessage('No log.yaml found yet. Run ChatDBG to generate one.');
    return;
  }

  // Extract cost and metadata from log file
  let costDisplay = '';
  try {
    const bytes = await vscode.workspace.fs.readFile(logUri);
    const txt = Buffer.from(bytes).toString('utf8');
    const m = txt.match(COST_RE);
    if (m) {
      costDisplay = `~$${m[1].trim()} USD`;
      setCostUI(`$${m[1].trim()}`);
    }
  } catch {}

  // Show toast notification
  const costMsg = costDisplay ? ` • ${costDisplay}` : '';
  vscode.window.showInformationMessage(
    `Opened last ChatDBG log (${fileNameForToast})${costMsg}`
  );

  // Parse log file and extract entries
  const entries = await parseLogFile(logUri);

  // Create or show the log viewer panel
  if (logViewerPanel) {
    logViewerPanel.reveal(vscode.ViewColumn.One);
  } else {
    const extensionUri = context.extension.extensionUri;
    logViewerPanel = vscode.window.createWebviewPanel(
      'chatdbgLogViewer',
      'ChatDBG — Last Log',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'panel')],
        retainContextWhenHidden: true,
      }
    );

    // Load the HTML content
    const htmlPath = path.join(context.extension.extensionPath, 'src', 'panel', 'openLog.html');
    const htmlBytes = await fs.readFile(htmlPath);
    logViewerPanel.webview.html = Buffer.from(htmlBytes).toString('utf8');

    // Handle panel disposal
    logViewerPanel.onDidDispose(() => {
      logViewerPanel = undefined;
    });

    // Handle messages from the webview
    logViewerPanel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'getLogEntries') {
        // Send parsed entries to webview
        logViewerPanel?.webview.postMessage({
          type: 'logEntries',
          entries,
        });
      } else if (message.type === 'refreshLog') {
        // Refresh the log by re-parsing
        const updated = await parseLogFile(logUri);
        logViewerPanel?.webview.postMessage({
          type: 'logEntries',
          entries: updated,
        });
      } else if (message.type === 'openRawLog') {
        // Open the raw log file in editor
        try {
          const doc = await vscode.workspace.openTextDocument(logUri);
          await vscode.window.showTextDocument(doc, vscode.ViewColumn.Two);
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to open raw log: ${e}`);
        }
      }
    });
  }

  // Send entries to webview
  if (logViewerPanel) {
    logViewerPanel.webview.postMessage({
      type: 'logEntries',
      entries,
    });
  }
}

/**
 * Parses a ChatDBG log.yaml file and extracts all log entries.
 * Handles YAML format with multiple documents separated by ---
 *
 * @param logUri - URI to the log.yaml file
 * @returns Array of parsed log entries, sorted newest first
 */
async function parseLogFile(logUri: vscode.Uri): Promise<LogEntry[]> {
  try {
    console.log('[parseLogFile] ===== START DEBUG =====');
    console.log('[parseLogFile] Reading log file:', logUri.fsPath);

    const bytes = await vscode.workspace.fs.readFile(logUri);
    const content = Buffer.from(bytes).toString('utf8');
    console.log('[parseLogFile] File content length:', content.length, 'bytes');
    console.log('[parseLogFile] First 200 chars:', content.substring(0, 200));

    // Parse YAML using loadAll (same as parseLogYamlAndSendToPanel) to handle multiple documents
    const docs: any[] = [];
    yaml.loadAll(content, (d) => docs.push(d));
    console.log('[parseLogFile] YAML loadAll found', docs.length, 'document(s)');

    // Get the most recent document (same logic as parseLogYamlAndSendToPanel)
    let latest: any = docs.length ? docs[docs.length - 1] : null;
    if (Array.isArray(latest)) latest = latest.length ? latest[latest.length - 1] : null;
    console.log('[parseLogFile] Latest document type:', typeof latest, 'IsArray:', Array.isArray(latest));

    // Get the last (most recent) session
    const lastSession = latest;
    console.log('[parseLogFile] lastSession exists:', !!lastSession);
    console.log('[parseLogFile] lastSession type:', typeof lastSession);

    if (!lastSession || typeof lastSession !== 'object') {
      console.log('[parseLogFile] ERROR: No valid session found');
      return [];
    }

    console.log('[parseLogFile] lastSession keys:', Object.keys(lastSession).join(', '));
    console.log('[parseLogFile] lastSession.meta:', JSON.stringify(lastSession.meta).substring(0, 300));

    // Extract AI response from steps
    let response = '';
    const steps = lastSession.steps || [];
    console.log('[parseLogFile] Number of steps:', steps.length);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      console.log(`[parseLogFile] Step ${i}: type=${step.type}, has output=${!!step.output}`);

      if (step.type === 'chat' && step.output?.outputs) {
        console.log(`[parseLogFile] Found CHAT step at index ${i}, outputs array length:`, step.output.outputs.length);

        for (let j = 0; j < step.output.outputs.length; j++) {
          const output = step.output.outputs[j];
          console.log(`[parseLogFile]   Output ${j}: type=${output.type}, has output=${!!output.output}`);

          if (output.type === 'text' && output.output) {
            response = output.output;
            console.log(`[parseLogFile] Extracted response (length ${response.length})`);
            break;
          }
        }
        if (response) break;
      }
    }

    console.log('[parseLogFile] Response found:', response.length > 0 ? 'YES (' + response.length + ' chars)' : 'NO');

    // If no AI response found, create a simple summary
    if (!response) {
      const file = lastSession.meta?.command_line || 'unknown';
      response = `Completed debugging session for: ${file}`;
      console.log('[parseLogFile] Using fallback response');
    }

    // Create a single entry from the session
    const entry: LogEntry = {
      timestamp: lastSession.meta?.time || new Date().toISOString(),
      command: 'debug',
      status: 'completed',
      input: lastSession.meta?.command_line || 'unknown file',
      model: {
        name: lastSession.meta?.config?.model || 'gpt-4o',
        response_full: response,
      },
      stdout: lastSession.stdout || '',
      stderr: lastSession.stderr || '',
    };

    console.log('[parseLogFile] Created entry with timestamp:', entry.timestamp);
    console.log('[parseLogFile] ===== SUCCESS: Returning 1 entry =====');
    return [entry];
  } catch (e) {
    console.error('[parseLogFile] ===== ERROR =====');
    console.error('[parseLogFile] Error reading log file:', e);
    console.error('[parseLogFile] Error stack:', (e as any).stack);
    return [];
  }
}

/* ============================================================
   Terminal Environment Setup
   ============================================================ */

/**
 * Exports the OpenAI API key to the terminal environment if configured.
 * If no key is configured, shows a helpful tip comment.
 *
 * @param term - Terminal to export key to
 */
function exportKeyIfConfigured(term: vscode.Terminal) {
  const openaiKey = vscode.workspace.getConfiguration('chatdbg').get<string>('openaiKey') || '';
  if (openaiKey.trim()) {
    term.sendText(`export OPENAI_API_KEY=${shQuote(openaiKey.trim())}`);
  } else if (!process.env.OPENAI_API_KEY) {
    term.sendText('# Tip: export OPENAI_API_KEY=your_key   (or set chatdbg.openaiKey in Settings)');
  }
}

/* ============================================================
   Run History Persistence
   ============================================================ */

/**
 * Saves the last run command and file to workspace state for rerun functionality.
 *
 * @param context - Extension context
 * @param cmd - The full command that was executed
 * @param file - The Python file that was debugged
 */
async function saveLastRun(context: vscode.ExtensionContext, cmd: string, file: string) {
  lastRunCmd = cmd;
  lastRunFile = file;
  await context.workspaceState.update(STORAGE_LAST_CMD, cmd);
  await context.workspaceState.update(STORAGE_LAST_FILE, file);
}

/**
 * Retrieves the last run command and file from workspace state.
 *
 * @param context - Extension context
 * @returns Object containing the last command and file
 */
async function getLastRun(context: vscode.ExtensionContext) {
  const cmd = context.workspaceState.get<string>(STORAGE_LAST_CMD);
  const file = context.workspaceState.get<string>(STORAGE_LAST_FILE);
  return { cmd, file };
}

/* ============================================================
   Command: Run Current File
   ============================================================ */

/**
 * Runs the currently active Python file with ChatDBG.
 * This is the primary command for debugging a Python script.
 * The debugger will automatically continue until the program exits or errors.
 *
 * @param context - Extension context
 */
// async function runCurrentFile(context: vscode.ExtensionContext) {
//   // Find active Python editor
//   const editor =
//     vscode.window.activeTextEditor ??
//     vscode.window.visibleTextEditors.find(e => e.document.languageId === 'python');

//   if (!editor) {
//     vscode.window.showErrorMessage('No Python editor is open.');
//     return;
//   }

//   const file = editor.document.fileName;
//   if (!file.toLowerCase().endsWith('.py')) {
//     vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
//     return;
//   }

//   const logPath = path.join(path.dirname(file), 'log.yaml');
//   const python = getConfiguredPython();
//   const activationCmd = getActivationCommand();

//   // Verify ChatDBG is installed
//   if (!(await ensureChatdbgInstalled(python))) {
//     vscode.window.showErrorMessage(
//       'ChatDBG is not installed for the selected Python interpreter.',
//       'Open Settings', 'Copy pip install command'
//     ).then(choice => {
//       if (choice === 'Open Settings') {
//         vscode.commands.executeCommand('workbench.action.openSettings', '@ext:plasma-umass.chatdbg chatdbg.pythonPath');
//       } else if (choice === 'Copy pip install command') {
//         vscode.env.clipboard.writeText(`${python} -m pip install chatdbg`);
//         vscode.window.showInformationMessage('Copied: python -m pip install chatdbg');
//       }
//     });
//     return;
//   }

//   // Build command: python -m chatdbg [flags] -c continue; q file.py
//   const logArgs = await getLogArgs(python, logPath);
//   const args = ['-m', 'chatdbg', ...getUnsafeFlag(), ...getModelFormatFlags(), ...logArgs, '-c', 'continue; q', file];

//   const pyQuoted = /\s/.test(python) ? shQuote(python) : python;
//   // Clean command: activate env silently, run ChatDBG, auto-quit
//   const cmd = `${activationCmd} > /dev/null 2>&1 && ${pyQuoted} ${joinArgs(args)}`;
//   lastRunCmd = cmd;

//   await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

//   // Execute in terminal
//   const term = getOrCreateTerminal();
//   term.show(true);

//   // Clear screen for clean output
//   term.sendText('clear');
//   term.sendText(cmd);

//   // Force quit ChatDBG after a short delay (handles both success and error cases)
//   setTimeout(() => {
//     term.sendText('q'); // Try to quit gracefully
//     term.sendText('\x03'); // Ctrl+C if still running
//   }, 2000);

//   await saveLastRun(context, cmd, file);
// }
async function runCurrentFile(context: vscode.ExtensionContext) {
  // Find active Python editor
  const editor =
    vscode.window.activeTextEditor ??
    vscode.window.visibleTextEditors.find(e => e.document.languageId === 'python');

  if (!editor) {
    vscode.window.showErrorMessage('No Python editor is open.');
    return;
  }

  const file = editor.document.fileName;
  if (!file.toLowerCase().endsWith('.py')) {
    vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
    return;
  }

  const logPath = path.join(path.dirname(file), 'log.yaml');
  const python = getConfiguredPython();
  const activationCmd = getActivationCommand();

  // Verify ChatDBG is installed
  if (!(await ensureChatdbgInstalled(python))) {
    vscode.window
      .showErrorMessage(
        'ChatDBG is not installed for the selected Python interpreter.',
        'Open Settings',
        'Copy pip install command'
      )
      .then(choice => {
        if (choice === 'Open Settings') {
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:plasma-umass.chatdbg chatdbg.pythonPath'
          );
        } else if (choice === 'Copy pip install command') {
          vscode.env.clipboard.writeText(`${python} -m pip install chatdbg`);
          vscode.window.showInformationMessage('Copied: python -m pip install chatdbg');
        }
      });
    return;
  }

  // Build command: python -m chatdbg [flags] -c "continue; q" file.py
  const logArgs = await getLogArgs(python, logPath);
  const args = [
    '-m',
    'chatdbg',
    ...getUnsafeFlag(),
    ...getModelFormatFlags(),
    ...logArgs,
    '-c',
    'continue; q',
    file,
  ];

  const pyQuoted = /\s/.test(python) ? shQuote(python) : python;

  // Activate env silently, then run ChatDBG
  const cmd = `${activationCmd} > /dev/null 2>&1 && ${pyQuoted} ${joinArgs(args)}`;
  lastRunCmd = cmd;

  await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

  const term = getOrCreateTerminal();
  term.show(true);

  // Clear screen for clean output
  term.sendText('clear');
  term.sendText(cmd);

  // NOTE: no more timed q / Ctrl+C here.
  // ChatDBG will exit on its own because of `-c "continue; q"`.

  await saveLastRun(context, cmd, file);
}



/* ============================================================
   Command: Explain Last Error
   ============================================================ */

/**
 * Sends a "Why did this fail?" query to the active ChatDBG session.
 * If no active session exists, automatically runs "Run & Explain" as a smart fallback.
 * This provides seamless UX where the button always produces a result.
 *
 * @param context - Extension context
 */
async function explainLastError(context: vscode.ExtensionContext) {
  const term = vscode.window.terminals.find(t => t.name === 'ChatDBG');
  if (!term) {
    // Smart fallback: No active terminal, so run "Run & Explain" instead
    // This gives users a frictionless experience - the button always works
    await runAndExplain(context);
    return;
  }
  term.show(true);
  term.sendText('chat Why did this fail?');
}

/* ============================================================
   Command: Run & Explain
   ============================================================ */

/**
 * Runs the current Python file with ChatDBG and automatically asks for
 * an AI explanation if the program fails.
 *
 * This is a combination of:
 * 1. Running the script with ChatDBG
 * 2. Automatically sending "chat Why did this fail?" if there's an error
 *
 * @param context - Extension context
 */
async function runAndExplain(context: vscode.ExtensionContext) {
  // Find active Python editor
  const editor =
    vscode.window.activeTextEditor ??
    vscode.window.visibleTextEditors.find(e => e.document.languageId === 'python');

  if (!editor) {
    vscode.window.showErrorMessage('No Python editor is open.');
    return;
  }

  const file = editor.document.fileName;
  if (!file.toLowerCase().endsWith('.py')) {
    vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
    return;
  }

  const logPath = path.join(path.dirname(file), 'log.yaml');
  const python = getConfiguredPython();
  const activationCmd = getActivationCommand();

  // Verify ChatDBG is installed
  if (!(await ensureChatdbgInstalled(python))) {
    vscode.window.showErrorMessage(
      'ChatDBG is not installed for the selected Python interpreter.',
      'Open Settings', 'Copy pip install command'
    ).then(choice => {
      if (choice === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:plasma-umass.chatdbg chatdbg.pythonPath');
      } else if (choice === 'Copy pip install command') {
        vscode.env.clipboard.writeText(`${python} -m pip install chatdbg`);
        vscode.window.showInformationMessage('Copied: python -m pip install chatdbg');
      }
    });
    return;
  }

  // Build command
  const logArgs = await getLogArgs(python, logPath);
  const args = ['-m', 'chatdbg', ...getUnsafeFlag(), ...getModelFormatFlags(), ...logArgs, '-c', 'continue', file];

  const pyQuoted = /\s/.test(python) ? shQuote(python) : python;
  // Clean command: activate env silently, run ChatDBG (stays open for AI query)
  const cmd = `${activationCmd} > /dev/null 2>&1 && ${pyQuoted} ${joinArgs(args)}`;
  lastRunCmd = cmd;

  await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

  // Execute in terminal and automatically ask for explanation
  const term = getOrCreateTerminal();
  term.show(true);

  // Clear screen for clean output
  term.sendText('clear');
  term.sendText(cmd);

  // Wait for program to run and error, then ask ChatDBG to explain with longer timeout
  // This gives ChatDBG sufficient time to generate a thorough AI response
  setTimeout(() => {
    term.sendText('chat Why did this fail?'); // Automatically request AI explanation

    // Wait longer for AI response (40s handles most cases, 10-15s typical, 30-40s for slow network)
    // ChatDBG streams the response, and we need to let it complete before exiting
    setTimeout(() => {
      // Send exit to gracefully close ChatDBG (allows log.yaml to be written)
      term.sendText('exit');

      // After a brief delay, send Ctrl+C to ensure termination if exit didn't work
      setTimeout(() => {
        term.sendText('\x03');
      }, 2000);
    }, 40000); // Wait 40 seconds for AI response to complete
  }, 3000); // Wait 3 seconds for program to crash

  await saveLastRun(context, cmd, file);
}

/* ============================================================
   Command: Rerun Last
   ============================================================ */

/**
 * Reruns the last ChatDBG command in the terminal.
 * Useful for quickly repeating a debugging session after code changes.
 *
 * @param context - Extension context
 */
async function rerunLast(context: vscode.ExtensionContext) {
  // Load from memory or workspace state
  if (!lastRunCmd) {
    lastRunCmd = context.workspaceState.get<string>(STORAGE_LAST_CMD) || null;
  }

  if (!lastRunCmd) {
    vscode.window.showInformationMessage('ChatDBG: nothing to rerun yet. Run a file first.');
    return;
  }

  // Execute the same command again
  const term = getOrCreateTerminal();
  term.show(true);

  // Clear screen for clean output
  term.sendText('clear');
  term.sendText(lastRunCmd);
}

/* ============================================================
   Command: Run with Diagnostics Collection
   ============================================================ */

/**
 * Runs ChatDBG and parses the output to create VS Code diagnostics.
 * This is more sophisticated than the regular run command:
 *
 * 1. Spawns ChatDBG as a child process (not in terminal)
 * 2. Captures all output in an Output Channel
 * 3. Parses stack traces and error messages
 * 4. Creates diagnostic markers at error locations
 * 5. Opens the Problems panel and navigates to the error
 * 6. Sends diagnostic data to the webview panel
 *
 * This provides IDE-like error navigation and inline error markers.
 */
async function runWithDiagnostics() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }

  const file = editor.document.fileName;
  if (!file.toLowerCase().endsWith('.py')) {
    vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
    return;
  }

  const python = getConfiguredPython();
  const activationCmd = getActivationCommand();
  const openaiKey = vscode.workspace.getConfiguration('chatdbg').get<string>('openaiKey') || '';

  // Create output channel for displaying raw output
  const out = vscode.window.createOutputChannel('ChatDBG');
  out.clear();
  out.show(true);

  // Build command - force text format for easier parsing
  const mfFlags = stripFormatFlag(getModelFormatFlags());
  const unsafeFlags = getUnsafeFlag();
  const args = [
    '-m', 'chatdbg',
    ...unsafeFlags,
    ...mfFlags,
    '--format', 'text',      // Force text format for parsing
    '-c', 'continue; q',     // Auto-continue and quit
    file
  ];
  const runCmd = `${activationCmd} && ${shQuote(python)} ${joinArgs(args)} 2>&1`;

  // Spawn as child process (not terminal) to capture output
  const child = spawn(runCmd, {
    shell: true,
    cwd: path.dirname(file),
    env: {
      ...process.env,
      ...(openaiKey ? { OPENAI_API_KEY: openaiKey } : {}),
      CHATDBG_NO_COLOR: '1',    // Disable ANSI colors for easier parsing
      PYTHONUNBUFFERED: '1'      // Unbuffered output for real-time display
    }
  });

  // Accumulate all output
  let buffer = '';
  const append = (d: Buffer) => { const t = d.toString(); buffer += t; out.append(t); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);

  // Timers to ensure process exits (polite quit, then hard kill)
  const politeQuit = setTimeout(() => { try { child.stdin?.write('q\n'); } catch {} }, 1500);
  const hardKill  = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 3000);

  child.on('error', (e) => {
    clearTimeout(politeQuit); clearTimeout(hardKill);
    vscode.window.showErrorMessage(`ChatDBG: failed to start (${e.message})`);
  });

  child.on('close', async () => {
    clearTimeout(politeQuit); clearTimeout(hardKill);

    const plain = stripAnsi(buffer);

    // Extract and display cost information
    const costMatch = plain.match(COST_RE);
    if (costMatch) {
      const cost = costMatch[1].trim();
      setCostUI(`$${cost}`);
      vscode.window.setStatusBarMessage(`ChatDBG cost ~ $${cost}`, 5000);
    }

    // Parse stack frames from output
    // Look for pdb-style frames: "> file.py(123)"
    const frames: Array<{ file: string; line: number }> = [];
    const pdbLineRe = />\s+(.+?\.py)\((\d+)\)/g;
    for (let m; (m = pdbLineRe.exec(plain)); ) {
      frames.push({ file: m[1], line: parseInt(m[2], 10) });
    }

    // Also look for traceback-style frames: File "file.py", line 123
    const tbRe = /File "([^"]+\.py)", line (\d+)/g;
    for (let t; (t = tbRe.exec(plain)); ) {
      frames.push({ file: t[1], line: parseInt(t[2], 10) });
    }

    // Use the last (most recent) frame as the error location
    let target: { file: string; line: number } | undefined = frames.length ? frames[frames.length - 1] : undefined;

    // Special handling for AssertionError: snap to the actual assert statement
    if (target && /AssertionError\b/.test(plain)) {
      try {
        const uri = vscode.Uri.file(target.file);
        const doc = await vscode.workspace.openTextDocument(uri);
        const lines = doc.getText().split(/\r?\n/);
        const idx = Math.max(0, Math.min(lines.length - 1, target.line - 1));

        // Search nearby lines for the assert statement
        let snapped = idx;
        for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
          const i = idx + delta;
          if (i >= 0 && i < lines.length && /\bassert\b/.test(lines[i])) { snapped = i; break; }
        }
        target.line = snapped + 1;
      } catch { /* best-effort */ }
    }

    // Extract error message
    let message = 'ChatDBG run failed';
    const msgMatch = plain.match(/^(?:.*\n)?([A-Za-z_]*Error|Exception):\s*(.+)$/m);
    if (msgMatch) message = `${msgMatch[1]}: ${msgMatch[2].trim()}`;

    // Create diagnostic marker at error location
    DIAG_COLLECTION.clear();

    if (target && Number.isFinite(target.line)) {
      const uri = vscode.Uri.file(target.file);
      const line0 = Math.max(0, target.line - 1);
      const range = new vscode.Range(line0, 0, line0, 1000);
      const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
      diag.source = 'ChatDBG';
      DIAG_COLLECTION.set(uri, [diag]);

      // Open file and show Problems panel
      vscode.workspace.openTextDocument(uri).then(doc => {
        vscode.window.showTextDocument(doc, { preview: false }).then(() => {
          vscode.commands.executeCommand('workbench.actions.view.problems');
        });
      });
    } else {
      vscode.window.showInformationMessage('ChatDBG finished, but no precise error location was parsed. See the ChatDBG output channel.');
    }

    // Send diagnostic data to webview panel
    const diagItems: Array<{ file: string; line: number; message: string }> = [];

    if (target && Number.isFinite(target.line)) {
      diagItems.push({
        file: target.file,
        line: target.line,
        message,
      });
    }

    if (diagItems.length > 0) {
      ChatDBGPanel.postToWebview({
        type: 'diagnostics',
        runId: null,
        diagnostics: diagItems,
      });
    }
  });
}

/* ============================================================
   Settings Management for Webview Panel
   ============================================================ */

/**
 * Gathers current ChatDBG configuration for display in the webview panel.
 * Includes Python path, activation command, model settings, and API key source.
 *
 * @returns Current panel settings object
 */
function getCurrentSettings(): PanelSettings {
  const cfg = vscode.workspace.getConfiguration('chatdbg');
  const python = getConfiguredPython();
  const activationCommand = getActivationCommand();
  const model = (cfg.get<string>('model') || '').trim();
  const format = (cfg.get<string>('format') || '').trim() || 'md';
  const unsafe = !!cfg.get<boolean>('unsafe');

  // Determine where the API key is configured
  const cfgKey = (cfg.get<string>('openaiKey') || '').trim();
  const envKey = (process.env.OPENAI_API_KEY || '').trim();
  let keySource: PanelSettings['keySource'] = 'none';
  if (envKey) keySource = 'env';
  else if (cfgKey) keySource = 'settings';

  return { python, activationCommand, model, format, unsafe, keySource };
}

/**
 * Applies setting changes from the webview panel to workspace configuration.
 * Only updates the specific settings that were changed.
 *
 * @param settings - Object containing setting changes
 */
async function applySettingsChange(settings: { model?: string; format?: string; unsafe?: boolean }) {
  const cfg = vscode.workspace.getConfiguration('chatdbg');

  if (typeof settings.model === 'string') {
    await cfg.update('model', settings.model || '', vscode.ConfigurationTarget.Workspace);
  }
  if (typeof settings.format === 'string') {
    await cfg.update('format', settings.format || '', vscode.ConfigurationTarget.Workspace);
  }
  if (typeof settings.unsafe === 'boolean') {
    await cfg.update('unsafe', settings.unsafe, vscode.ConfigurationTarget.Workspace);
  }
}

/**
 * Tests the Python environment and ChatDBG installation.
 * Runs `chatdbg -h` and returns the result for diagnostic purposes.
 *
 * @returns Object with success status, output, and summary message
 */
async function runEnvironmentCheck(): Promise<{ ok: boolean; output: string; summary: string }> {
  const python = getConfiguredPython();
  const activation = getActivationCommand();

  const cmd = `${activation} && ${shQuote(python)} -m chatdbg -h`;

  return new Promise(resolve => {
    const child = spawn(cmd, { shell: true });
    let buf = '';
    child.stdout.on('data', d => buf += d.toString());
    child.stderr.on('data', d => buf += d.toString());
    child.on('close', code => {
      const plain = stripAnsi(buf || '');
      const ok = code === 0;
      let summary: string;
      if (ok) {
        const first = plain.split(/\r?\n/).find(l => l.trim().length > 0);
        summary = first || 'chatdbg -h succeeded';
      } else {
        summary = `Environment check failed (exit code ${code ?? 'unknown'})`;
      }
      resolve({ ok, output: plain, summary });
    });
  });
}

/* ============================================================
   CodeLens Provider - Inline Run Buttons
   ============================================================ */

/**
 * Provides CodeLens buttons at the top of Python files.
 * CodeLens are the clickable text links that appear above code in the editor.
 *
 * For each Python file, we show:
 * - "Run with ChatDBG" - runs the file with debugging
 * - "Run & Explain" - runs and automatically asks AI to explain failures
 */
class ChatDBGCodeLensProvider implements vscode.CodeLensProvider {
  onDidChangeCodeLenses?: vscode.Event<void> | undefined;

  /**
   * Provides CodeLens items for a document.
   * Called by VS Code whenever a document is opened or changed.
   *
   * @param document - The document to provide CodeLens for
   * @param _token - Cancellation token (unused)
   * @returns Array of CodeLens items
   */
  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    // Only show CodeLens for Python files on disk (not untitled or virtual files)
    if (document.languageId !== 'python' || document.uri.scheme !== 'file') {
      return [];
    }

    // Place CodeLens at the top of the file (line 0)
    const firstLine = document.lineAt(0);
    const range = new vscode.Range(firstLine.range.start, firstLine.range.start);
    const lenses: vscode.CodeLens[] = [];

    // "Run with ChatDBG" button
    lenses.push(
      new vscode.CodeLens(range, {
        title: 'Run with ChatDBG',
        tooltip: 'Run this Python file under ChatDBG',
        command: 'chatdbg.runCurrentFile',
        arguments: [],
      })
    );

    // "Run & Explain" button
    lenses.push(
      new vscode.CodeLens(range, {
        title: 'Run & Explain',
        tooltip: 'Run and ask ChatDBG to explain any failure',
        command: 'chatdbg.runAndExplain',
        arguments: [],
      })
    );

    return lenses;
  }

  /**
   * Resolves a CodeLens item (optional second phase of CodeLens protocol).
   * We attach commands directly in provideCodeLenses, so this just returns the lens as-is.
   *
   * @param codeLens - The CodeLens to resolve
   * @param _token - Cancellation token (unused)
   * @returns The same CodeLens
   */
  resolveCodeLens(
    codeLens: vscode.CodeLens,
    _token: vscode.CancellationToken
  ): vscode.CodeLens {
    return codeLens;
  }
}

/* ============================================================
   Extension Lifecycle - Activation & Deactivation
   ============================================================ */

/**
 * Called when the extension is activated.
 * This happens when:
 * - VS Code starts up (if auto-activation is configured)
 * - A Python file is opened
 * - A ChatDBG command is executed
 *
 * Responsibilities:
 * - Register all commands
 * - Set up UI elements (status bar, CodeLens)
 * - Initialize state from previous session
 * - Set up event listeners
 *
 * @param context - Extension context for accessing APIs and storage
 */
export function activate(context: vscode.ExtensionContext) {
  // Restore last run command from previous session
  lastRunCmd = context.workspaceState.get<string>(STORAGE_LAST_CMD) || null;

  // Initialize cost badge (hidden initially)
  setCostUI();

  // Register all commands
  context.subscriptions.push(
    vscode.commands.registerCommand('chatdbg.runCurrentFile', () => runCurrentFile(context)),
    vscode.commands.registerCommand('chatdbg.explainLastError', () => explainLastError(context)),
    vscode.commands.registerCommand('chatdbg.runAndExplain', () => runAndExplain(context)),
    vscode.commands.registerCommand('chatdbg.runWithDiagnostics', runWithDiagnostics),
    vscode.commands.registerCommand('chatdbg.rerunLast', () => rerunLast(context)),
    vscode.commands.registerCommand('chatdbg.openLog', () => openLog(context)),
    vscode.commands.registerCommand('chatdbg.runWithArgs', () => runWithArgs(context)),
    vscode.commands.registerCommand('chatdbg.clearArgs', () => clearSavedArgs(context)),
    DIAG_COLLECTION
  );

  // Register command to open the webview panel
  const openPanelDisposable = vscode.commands.registerCommand(
    'chatdbg.openPanel',
    () => {
      ChatDBGPanel.createOrShow(context.extensionUri);
    }
  );
  context.subscriptions.push(openPanelDisposable);

  // Register CodeLens provider for inline "Run" and "Run & Explain" buttons
  const codelensDisposable = vscode.languages.registerCodeLensProvider(
    { language: 'python', scheme: 'file' },
    new ChatDBGCodeLensProvider()
  );
  context.subscriptions.push(codelensDisposable);

  // Create status bar items
  // "ChatDBG" button - runs current file
  const runItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  runItem.text = '$(debug-start) ChatDBG';
  runItem.command = 'chatdbg.runCurrentFile';
  runItem.tooltip = 'Run current Python file with ChatDBG';
  context.subscriptions.push(runItem);

  // "Why?" button - explains last error (only shown when ChatDBG terminal exists)
  const whyItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  whyItem.text = '$(question) Why?';
  whyItem.command = 'chatdbg.explainLastError';
  whyItem.tooltip = 'Ask ChatDBG: Why did this fail?';
  context.subscriptions.push(whyItem);

  // "ChatDBG Panel" button - opens the interactive UI
  const panelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  panelItem.text = '$(comment-discussion) ChatDBG Panel';
  panelItem.command = 'chatdbg.openPanel';
  panelItem.tooltip = 'Open the ChatDBG UI panel';
  context.subscriptions.push(panelItem);

  /**
   * Updates status bar item visibility based on current context.
   * - Show run/panel buttons when a Python file is active
   * - Show "Why?" button only when a ChatDBG terminal session exists
   */
  const refreshStatus = () => {
    const lang = vscode.window.activeTextEditor?.document.languageId;

    // Show run and panel buttons for Python files
    if (lang === 'python') {
      runItem.show();
      panelItem.show();
    } else {
      runItem.hide();
      panelItem.hide();
    }

    // Show "Why?" button only if there's an active ChatDBG terminal
    const hasChatdbgTerm = vscode.window.terminals.some(t => t.name === 'ChatDBG');
    if (hasChatdbgTerm) {
      whyItem.show();
    } else {
      whyItem.hide();
    }
  };

  // Listen to events that might affect status bar visibility
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(refreshStatus));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refreshStatus));
  context.subscriptions.push(vscode.window.onDidOpenTerminal(refreshStatus));
  context.subscriptions.push(vscode.window.onDidCloseTerminal(refreshStatus));

  // Initial status update
  refreshStatus();

  // Auto-open ChatDBG panel when a Python file is opened (for smooth UX)
  // This creates a split-view setup: code on left, ChatDBG panel on right
  const autoOpenPanel = () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.languageId === 'python') {
      // Small delay to ensure editor layout is ready
      setTimeout(() => {
        ChatDBGPanel.createOrShow(context.extensionUri);
      }, 500);
    }
  };

  // Auto-open on activation if a Python file is already open
  autoOpenPanel();

  // Auto-open when switching to a Python file (only if panel doesn't exist)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === 'python' && !ChatDBGPanel.currentPanel) {
        setTimeout(() => {
          ChatDBGPanel.createOrShow(context.extensionUri);
        }, 500);
      }
    })
  );

  // Ensure Python files always open in the left column (ViewColumn.One)
  // This prevents them from opening next to the ChatDBG panel
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      if (document.languageId === 'python') {
        // Find the editor showing this document
        const editor = vscode.window.visibleTextEditors.find(
          e => e.document === document
        );

        // If it's in the wrong column (not ViewColumn.One), move it
        if (editor && editor.viewColumn !== vscode.ViewColumn.One) {
          await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.One,
            preview: false,
            preserveFocus: false
          });
        }
      }
    })
  );
}

/**
 * Called when the extension is deactivated.
 * VS Code automatically disposes of items in context.subscriptions,
 * so we don't need to do anything here.
 */
export function deactivate() {}
