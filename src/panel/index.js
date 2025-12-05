/**
 * ChatDBG Webview Script
 *
 * This script runs inside the VSCode webview panel and handles:
 * - User interactions with the UI (buttons, inputs)
 * - Bidirectional communication with the extension host
 * - Rendering of transcript output, diagnostics, and run history
 * - Settings management and environment checks
 *
 * Communication Model:
 * - UI events → postMessage to extension
 * - Extension responses → window 'message' event listener
 */
(function () {
  const vscode = acquireVsCodeApi();

  // ---- DOM references for settings ----
  const settingsPanel = document.getElementById('settings-panel');
  const settingsToggle = document.getElementById('settings-toggle');

  const envPill = document.getElementById('settings-env-pill');
  const modelPill = document.getElementById('settings-model-pill');
  const keyPill = document.getElementById('settings-key-pill');

  const cfgInterpreter = document.getElementById('cfg-interpreter');
  const cfgActivation = document.getElementById('cfg-activation');
  const cfgOpenaiKey = document.getElementById('cfg-openai-key');
  const cfgModel = document.getElementById('cfg-model');
  const cfgFormat = document.getElementById('cfg-format');
  const cfgUnsafe = document.getElementById('cfg-unsafe');
  const btnTestEnv = document.getElementById('btn-test-env');

  // ---- Settings panel toggle ----
  if (settingsToggle) {
    settingsToggle.addEventListener('click', () => {
      if (settingsPanel) {
        settingsPanel.classList.toggle('settings-collapsed');
      }
    });
  }

  // ---- Apply settings from extension into UI ----
  function applySettingsToUI(settings) {
    if (!settings) return;

    // Status Pills - Display summary at top
    if (envPill && settings.python) {
      const short = settings.python.split(/[\\/]/).slice(-1).join('/');
      envPill.innerHTML = `📦 <span style="margin-left:0.2rem;">${short || 'Python'}</span>`;
      envPill.title = `Python interpreter: ${settings.python}`;
    }

    if (modelPill) {
      const modelText = settings.model ? `${settings.model}` : 'default';
      modelPill.innerHTML = `🤖 <span style="margin-left:0.2rem;">Model: ${modelText}</span>`;
      modelPill.title = `LLM model: ${modelText}`;
      modelPill.classList.remove('pill-warning');
      modelPill.classList.add('pill-model');
    }

    if (keyPill) {
      keyPill.classList.remove('pill-success', 'pill-warning');

      if (settings.keySource === 'env') {
        keyPill.innerHTML = '🔑 <span style="margin-left:0.2rem;">Key: Environment</span>';
        keyPill.title = 'API key set via OPENAI_API_KEY environment variable';
        keyPill.classList.add('pill-success');
      } else if (settings.keySource === 'settings') {
        keyPill.innerHTML = '🔑 <span style="margin-left:0.2rem;">Key: VS Code</span>';
        keyPill.title = 'API key set in VS Code settings (chatdbg.openaiKey)';
        keyPill.classList.add('pill-success');
      } else {
        keyPill.innerHTML = '🔑 <span style="margin-left:0.2rem;">Not configured</span>';
        keyPill.title = 'API key not set - required to use ChatDBG';
        keyPill.classList.add('pill-warning');
      }
    }

    // Details Section - Configuration display
    if (cfgInterpreter) {
      cfgInterpreter.textContent = settings.python || '(not configured)';
      cfgInterpreter.title = settings.python || 'Python interpreter not set';
    }

    if (cfgActivation) {
      cfgActivation.textContent = settings.activationCommand || '(using shell defaults)';
      cfgActivation.title = settings.activationCommand || 'Environment activation command';
    }

    if (cfgOpenaiKey) {
      let keyStatus = 'Not configured';
      if (settings.keySource === 'env') {
        keyStatus = '✓ Set via OPENAI_API_KEY environment variable';
      } else if (settings.keySource === 'settings') {
        keyStatus = '✓ Set in Settings (chatdbg.openaiKey)';
      }
      cfgOpenaiKey.textContent = keyStatus;
      cfgOpenaiKey.style.color = settings.keySource ? 'var(--vscode-testing-iconPassed, #73c991)' : 'var(--vscode-descriptionForeground)';
    }

    if (cfgModel && typeof settings.model === 'string') {
      cfgModel.value = settings.model;
    }

    if (cfgFormat) {
      const format = settings.format || 'md';
      if (cfgFormat.tagName === 'SELECT') {
        cfgFormat.value = format;
      } else {
        cfgFormat.value = format;
      }
    }

    if (cfgUnsafe && typeof settings.unsafe === 'boolean') {
      cfgUnsafe.checked = settings.unsafe;
    }
  }

  // ---- Send settings changes back to extension ----
  function postSettingsChange() {
    const model = cfgModel?.value ?? '';
    let format = 'md';
    if (cfgFormat) {
      format = cfgFormat.value || 'md';
    }
    const unsafe = !!(cfgUnsafe && cfgUnsafe.checked);

    vscode.postMessage({
      type: 'changeSettings',
      settings: { model, format, unsafe },
    });
  }

  if (cfgModel) {
    cfgModel.addEventListener('change', postSettingsChange);
    cfgModel.addEventListener('blur', postSettingsChange);
  }
  if (cfgFormat) {
    cfgFormat.addEventListener('change', postSettingsChange);
  }
  if (cfgUnsafe) {
    cfgUnsafe.addEventListener('change', postSettingsChange);
  }

  // ---- Test environment button ----
  if (btnTestEnv) {
    btnTestEnv.addEventListener('click', () => {
      envStatus.textContent = 'Running environment check...';
      vscode.postMessage({ type: 'testEnvironment' });
    });
  }

  // ---- Handle messages from extension ----
  window.addEventListener('message', event => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'settings':
        applySettingsToUI(msg.settings);
        break;

      case 'envCheckResult':
        if (envStatus) {
          envStatus.textContent = msg.summary || '';
        }
        break;

      // keep your other cases: output, history, diagnostics, runStarted, runFinished, etc.
      default:
        break;
    }
  });

  // send ready message on load
  vscode.postMessage({ type: 'webviewReady' });


  /* ============================================================
     DOM ELEMENT REFERENCES
     ============================================================ */

  // Toolbar action buttons
  const btnRun = document.getElementById('btn-run');
  const btnRunExplain = document.getElementById('btn-run-explain');
  const btnExplainLast = document.getElementById('btn-explain-last');
  const btnRerunLast = document.getElementById('btn-rerun-last');
  const btnOpenLog = document.getElementById('btn-open-log');

  // Main content panels
  const transcriptEl = document.getElementById('transcript-body');
  const diagnosticsEl = document.getElementById('diagnostics-body');
  const historyEl = document.getElementById('history-body');

  // Settings panel - read-only labels
  const interpLabel = document.getElementById('cfg-interpreter');
  const activationLabel = document.getElementById('cfg-activation');
  const keyLabel = document.getElementById('cfg-openai-key');

  // Settings panel - user-editable controls
  const modelInput = document.getElementById('cfg-model');
  const formatInput = document.getElementById('cfg-format');
  const unsafeCheckbox = document.getElementById('cfg-unsafe');

  const envButton = document.getElementById('btn-test-env');
  const envStatus = document.getElementById('env-status');

  // Status bar elements
  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');

  /* ============================================================
     STATE MANAGEMENT
     ============================================================ */

  // Currently active run ID (null when idle)
  let currentRunId = null;

  // Historical run records from the extension
  let historyItems = [];

  /* ============================================================
     UI UPDATE FUNCTIONS
     ============================================================ */

  /**
   * Updates the status bar with pill and/or text.
   * @param {string} pill - Status pill text (e.g., "Running", "Done")
   * @param {string} text - Status text description
   */
  function setStatus(pill, text) {
    if (pill !== undefined && pill !== null) {
      statusPill.textContent = pill;
    }
    if (text !== undefined && text !== null) {
      statusText.textContent = text;
    }
  }

  /**
   * Appends a markdown chunk to the transcript panel.
   * Uses marked.js library to render markdown to HTML.
   * Auto-scrolls to bottom to show latest content.
   * @param {string} chunk - Markdown text to append
   */
  function appendTranscriptMarkdown(chunk) {
    if (!chunk) return;

    // Parse markdown if marked.js is available, otherwise use plain text
    const html = (window.marked && window.marked.parse)
      ? window.marked.parse(chunk)
      : chunk;

    const wrapper = document.createElement('div');
    wrapper.className = 'transcript-chunk';
    wrapper.innerHTML = html;
    transcriptEl.appendChild(wrapper);

    // Auto-scroll to show latest output
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  /**
   * Renders diagnostic errors/warnings in the diagnostics panel.
   * Each diagnostic is clickable and navigates to the source location.
   * @param {Array} diags - Array of diagnostic objects {message, file, line}
   */
  function renderDiagnostics(diags) {
    diagnosticsEl.innerHTML = '';

    if (!diags || diags.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No diagnostics yet.';
      diagnosticsEl.appendChild(empty);
      return;
    }

    for (const d of diags) {
      const item = document.createElement('div');
      item.className = 'diagnostic-item';

      const msg = document.createElement('div');
      msg.className = 'diagnostic-message';
      msg.textContent = d.message;

      const file = document.createElement('div');
      file.className = 'diagnostic-file';
      file.textContent = `${d.file}:${d.line}`;

      item.appendChild(msg);
      item.appendChild(file);

      // Click to navigate to source location in editor
      item.addEventListener('click', () => {
        vscode.postMessage({
          type: 'openLocation',
          file: d.file,
          line: d.line,
        });
      });

      diagnosticsEl.appendChild(item);
    }
  }

  /**
   * Renders the run history panel with previous ChatDBG executions.
   * Each history item is clickable to view its transcript.
   * @param {Array} items - Array of run summary objects {id, file, timestamp, status, summary}
   */
  function renderHistory(items) {
    historyItems = Array.isArray(items) ? items : [];
    historyEl.innerHTML = '';

    if (historyItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No runs yet.';
      historyEl.appendChild(empty);
      return;
    }

    for (const run of historyItems) {
      const item = document.createElement('div');
      item.className = 'history-item';

      // File name/path
      const title = document.createElement('div');
      title.className = 'history-title';
      title.textContent = run.file || '(unknown)';

      // Timestamp and status
      const ts = new Date(run.timestamp || Date.now());
      const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const meta = document.createElement('div');
      meta.className = 'history-meta';
      const statusLabel = run.status || 'unknown';
      meta.textContent = `${timeStr} • ${statusLabel}`;

      // Brief summary of the run
      const summary = document.createElement('div');
      summary.className = 'history-summary';
      summary.textContent = run.summary || '';

      item.appendChild(title);
      item.appendChild(meta);
      if (run.summary) item.appendChild(summary);

      // Click to load this run's transcript
      item.addEventListener('click', () => {
        vscode.postMessage({
          type: 'selectRun',
          runId: run.id,
        });
      });

      historyEl.appendChild(item);
    }
  }

  /**
   * Applies settings received from the extension to the UI.
   * Updates both read-only labels and user-editable controls.
   * @param {Object} settings - Settings object {python, activationCommand, model, format, unsafe, keySource}
   */
  function applySettings(settings) {
    const s = settings || {};

    // Read-only configuration labels
    if (interpLabel) {
      interpLabel.textContent = s.python || '(not set)';
    }
    if (activationLabel) {
      activationLabel.textContent = s.activationCommand || '(none)';
    }
    if (keyLabel) {
      let txt = 'Not configured';
      if (s.keySource === 'env') txt = 'From OPENAI_API_KEY';
      else if (s.keySource === 'settings') txt = 'Set in Settings (chatdbg.openaiKey)';
      keyLabel.textContent = txt;
    }

    // User-editable controls
    if (modelInput) {
      modelInput.value = s.model || '';
    }
    if (formatInput) {
      formatInput.value = s.format || 'md';
    }
    if (unsafeCheckbox) {
      unsafeCheckbox.checked = !!s.unsafe;
    }
  }

  /**
   * Updates the environment check status display.
   * Shows success/failure with appropriate styling and emoji indicators.
   * @param {Object} result - Result object {ok, summary, output}
   */
  function updateEnvStatus(result) {
    if (!envStatus) return;
    envStatus.textContent = '';

    const ok = !!result.ok;
    envStatus.className = 'env-status ' + (ok ? 'ok' : 'error');

    const icon = ok ? '✅' : '❌';
    const summary = result.summary || (ok ? 'Environment is ready!' : 'Environment check failed.');
    envStatus.textContent = `${icon} ${summary}`;

    // Add visual feedback
    if (ok) {
      envStatus.style.fontWeight = '500';
    }
  }

  /**
   * Sends changed settings back to the extension for persistence.
   * Triggered when user modifies model, format, or unsafe mode.
   */
  function sendSettingsChange() {
    const settings = {
      model: modelInput ? modelInput.value.trim() : '',
      format: formatInput ? formatInput.value.trim() : '',
      unsafe: unsafeCheckbox ? !!unsafeCheckbox.checked : false,
    };

    vscode.postMessage({
      type: 'changeSettings',
      settings,
    });
  }

  /* ============================================================
     EVENT LISTENERS - User Interactions
     ============================================================ */

  // Toolbar action buttons
  btnRun?.addEventListener('click', () => {
    vscode.postMessage({ type: 'run' });
  });

  btnRunExplain?.addEventListener('click', () => {
    vscode.postMessage({ type: 'runExplain' });
  });

  btnExplainLast?.addEventListener('click', () => {
    vscode.postMessage({ type: 'explainLast' });
  });

  btnRerunLast?.addEventListener('click', () => {
    vscode.postMessage({ type: 'rerunLast' });
  });

  btnOpenLog?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openLog' });
  });

  // Settings panel - auto-save on change
  modelInput?.addEventListener('change', sendSettingsChange);
  formatInput?.addEventListener('change', sendSettingsChange);
  unsafeCheckbox?.addEventListener('change', sendSettingsChange);

  // Environment check button
  envButton?.addEventListener('click', () => {
    updateEnvStatus({ ok: true, summary: 'Running environment check…' });
    vscode.postMessage({ type: 'testEnvironment' });
  });

  /* ============================================================
     MESSAGE HANDLER - Extension → Webview Communication
     ============================================================ */

  /**
   * Handles messages sent from the extension host to the webview.
   * Message types include:
   * - hello: Initial connection acknowledgment
   * - runStarted: Debugging session started
   * - runFinished: Debugging session completed
   * - output: Incremental transcript output
   * - diagnostics: Error/warning diagnostics to display
   * - history: Updated run history list
   * - showTranscript: Load a previous run's transcript
   * - settings: Configuration update
   * - envCheckResult: Result of environment check
   */
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'hello': {
        // Initial connection from extension
        setStatus('Connected', msg.text || 'Webview connected.');
        break;
      }

      case 'runStarted': {
        // New debugging session started
        currentRunId = msg.runId;
        transcriptEl.innerHTML = '';
        setStatus('Running…', `Running command: ${msg.command || ''}`);
        break;
      }

      case 'runFinished': {
        // Debugging session completed
        if (msg.runId === currentRunId) {
          setStatus('Done', 'Run completed.');
          currentRunId = null;
        }
        break;
      }

      case 'output': {
        // Stream transcript output (only for current run)
        if (!msg.runId || msg.runId === currentRunId) {
          appendTranscriptMarkdown(msg.chunk || '');
        }
        break;
      }

      case 'diagnostics': {
        // Update diagnostics panel
        renderDiagnostics(msg.diagnostics || []);
        break;
      }

      case 'history': {
        // Update run history panel
        renderHistory(msg.items || []);
        break;
      }

      case 'showTranscript': {
        // Load a previous transcript from history
        transcriptEl.innerHTML = '';
        const banner = document.createElement('div');
        banner.className = 'history-banner';
        banner.textContent = 'Viewing previous run.';
        transcriptEl.appendChild(banner);

        appendTranscriptMarkdown(msg.transcript || '');
        setStatus('History', 'Viewing previous run.');
        break;
      }

      case 'settings': {
        // Apply settings from extension
        applySettings(msg.settings || {});
        break;
      }

      case 'envCheckResult': {
        // Environment check completed
        updateEnvStatus(msg);
        if (msg.output) {
          appendTranscriptMarkdown(
            '```text\n' + msg.output + '\n```'
          );
        }
        break;
      }

      default:
        console.log('[ChatDBG panel] Unknown message type:', msg.type);
    }
  });

  /* ============================================================
     INITIALIZATION
     ============================================================ */

  // Signal to extension that webview is ready to receive messages
  vscode.postMessage({ type: 'webviewReady' });
})();
