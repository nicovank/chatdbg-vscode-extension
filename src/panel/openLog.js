/**
 * ChatDBG Log Viewer
 *
 * Displays the last ChatDBG log entry with:
 * - Structured cards (overview, input, model request, response, stdout/stderr)
 * - Navigation between entries
 * - Copy to clipboard functionality
 * - Clean, modern UI with VS Code theme integration
 */

(function () {
  const vscode = acquireVsCodeApi();

  // ---- DOM references ----
  const logContent = document.getElementById('logContent');
  const logTime = document.getElementById('logTime');
  const logNavSelect = document.getElementById('logNavSelect');
  const logPrevBtn = document.getElementById('logPrevBtn');
  const logNextBtn = document.getElementById('logNextBtn');
  const logCopyBtn = document.getElementById('logCopyBtn');
  const logRefreshBtn = document.getElementById('logRefreshBtn');
  const logRawBtn = document.getElementById('logRawBtn');

  // ---- State ----
  let allEntries = [];
  let currentIndex = -1;

  // ---- Message Handling from Extension ----
  window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'logEntries') {
      allEntries = message.entries || [];
      if (allEntries.length === 0) {
        showEmpty();
        return;
      }
      // Start with the latest entry (index 0)
      currentIndex = 0;
      updateUI();
    }

    if (message.type === 'logError') {
      showError(message.error || 'Failed to load log');
    }
  });

  // ---- UI Updates ----

  function updateUI() {
    if (allEntries.length === 0) {
      showEmpty();
      return;
    }

    // Clamp index
    currentIndex = Math.max(0, Math.min(currentIndex, allEntries.length - 1));

    const entry = allEntries[currentIndex];

    // Update header
    updateHeader(entry);

    // Update select dropdown
    updateNavSelect();

    // Update buttons
    logPrevBtn.disabled = currentIndex === allEntries.length - 1;
    logNextBtn.disabled = currentIndex === 0;

    // Render content
    renderEntry(entry);
  }

  function updateHeader(entry) {
    if (entry.timestamp) {
      const date = new Date(entry.timestamp);
      const time = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      logTime.textContent = `Updated: ${time}`;
    }
  }

  function updateNavSelect() {
    logNavSelect.innerHTML = '';
    for (let i = 0; i < allEntries.length; i++) {
      const entry = allEntries[i];
      const label = formatEntryLabel(entry, i);
      const option = document.createElement('option');
      option.value = i;
      option.textContent = label;
      if (i === currentIndex) {
        option.selected = true;
      }
      logNavSelect.appendChild(option);
    }
  }

  function formatEntryLabel(entry, index) {
    const total = allEntries.length;
    const timestamp = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      : 'Unknown time';
    const command = (entry.command || 'Run').replace(/^\//, '');
    return `#${total - index} — ${command} at ${timestamp}`;
  }

  function renderEntry(entry) {
    logContent.innerHTML = '';

    // Overview Card
    const overviewCard = createCard('overview');
    overviewCard.innerHTML = `
      <div class="log-overview">
        <div class="log-overview-item">
          <div class="log-overview-label">Command</div>
          <div class="log-overview-value">${escapeHtml(entry.command || 'N/A')}</div>
        </div>
        <div class="log-overview-item">
          <div class="log-overview-label">Status</div>
          <div>
            <span class="log-status-badge ${entry.status === 'error' ? 'error' : 'ok'}">
              ${escapeHtml(entry.status || 'completed')}
            </span>
          </div>
        </div>
        <div class="log-overview-item">
          <div class="log-overview-label">Model</div>
          <div class="log-overview-value">${escapeHtml(entry.model?.name || 'N/A')}</div>
        </div>
        <div class="log-overview-item">
          <div class="log-overview-label">Timestamp</div>
          <div class="log-overview-value">${
            entry.timestamp
              ? new Date(entry.timestamp).toLocaleString()
              : 'N/A'
          }</div>
        </div>
      </div>
    `;
    logContent.appendChild(overviewCard);

    // Input / Error Card
    if (entry.input) {
      const inputCard = createSection('Input / Error', true);
      const code = document.createElement('code');
      code.className = 'log-code';
      code.textContent = entry.input;
      inputCard.querySelector('.log-section-body').appendChild(code);
      logContent.appendChild(inputCard);
    }

    // Model Request Card
    if (entry.model?.request_meta) {
      const requestCard = createSection('Model Request (Metadata)', false);
      const code = document.createElement('code');
      code.className = 'log-code';
      code.textContent = JSON.stringify(entry.model.request_meta, null, 2);
      requestCard.querySelector('.log-section-body').appendChild(code);
      logContent.appendChild(requestCard);
    }

    // Model Response Card (Primary, expanded by default)
    if (entry.model?.response_full) {
      const responseCard = createSection('Model Response', true);
      const body = responseCard.querySelector('.log-section-body');

      // Try to render as markdown
      const rendered = document.createElement('div');
      rendered.className = 'log-markdown';
      rendered.innerHTML = markdownToHtml(entry.model.response_full);
      body.appendChild(rendered);

      logContent.appendChild(responseCard);
    }

    // Stdout Card
    if (entry.stdout) {
      const stdoutCard = createSection('Stdout', false);
      const code = document.createElement('code');
      code.className = 'log-code';
      code.textContent = entry.stdout;
      stdoutCard.querySelector('.log-section-body').appendChild(code);
      logContent.appendChild(stdoutCard);
    }

    // Stderr Card
    if (entry.stderr) {
      const stderrCard = createSection('Stderr', false);
      const code = document.createElement('code');
      code.className = 'log-code';
      code.textContent = entry.stderr;
      stderrCard.querySelector('.log-section-body').appendChild(code);
      logContent.appendChild(stderrCard);
    }

    // Raw Entry Card
    if (entry) {
      const rawCard = createSection('Raw Entry (JSON)', false);
      const code = document.createElement('code');
      code.className = 'log-code';
      code.textContent = JSON.stringify(entry, null, 2);
      rawCard.querySelector('.log-section-body').appendChild(code);
      logContent.appendChild(rawCard);
    }

    // Attach collapsible handlers
    document.querySelectorAll('.log-section-header').forEach((header) => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('collapsed');
      });
    });
  }

  function createCard(className = '') {
    const card = document.createElement('div');
    card.className = 'log-card ' + className;
    return card;
  }

  function createSection(title, expanded = false) {
    const section = document.createElement('div');
    section.className = 'log-card log-section ' + (expanded ? 'default-expanded' : 'default-collapsed collapsed');

    const header = document.createElement('div');
    header.className = 'log-section-header';
    header.innerHTML = `
      <span class="log-section-toggle">▼</span>
      <span class="log-section-title">${escapeHtml(title)}</span>
    `;

    const body = document.createElement('div');
    body.className = 'log-section-body';

    section.appendChild(header);
    section.appendChild(body);

    return section;
  }

  function showEmpty() {
    logContent.innerHTML = `
      <div class="log-empty">
        <div class="log-empty-icon">📖</div>
        <div class="log-empty-text">No log entries found</div>
        <div class="log-empty-hint">Run ChatDBG to generate logs</div>
      </div>
    `;
  }

  function showError(error) {
    logContent.innerHTML = `
      <div class="log-empty">
        <div class="log-empty-icon">❌</div>
        <div class="log-empty-text">Error loading log</div>
        <div class="log-empty-hint">${escapeHtml(error)}</div>
      </div>
    `;
  }

  // ---- Event Handlers ----

  logPrevBtn.addEventListener('click', () => {
    if (currentIndex < allEntries.length - 1) {
      currentIndex++;
      updateUI();
    }
  });

  logNextBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
      currentIndex--;
      updateUI();
    }
  });

  logNavSelect.addEventListener('change', (e) => {
    currentIndex = parseInt(e.target.value, 10);
    updateUI();
  });

  logRefreshBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshLog' });
  });

  logRawBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'openRawLog' });
  });

  logCopyBtn.addEventListener('click', () => {
    if (currentIndex >= 0 && currentIndex < allEntries.length) {
      const entry = allEntries[currentIndex];
      const text = JSON.stringify(entry, null, 2);
      navigator.clipboard.writeText(text).then(() => {
        logCopyBtn.textContent = '✅ Copied';
        setTimeout(() => {
          logCopyBtn.textContent = '📋 Copy';
        }, 2000);
      });
    }
  });

  // ---- Utilities ----

  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Simple markdown to HTML converter
   * Handles: # headings, **bold**, *italic*, code blocks, lists, etc.
   */
  function markdownToHtml(markdown) {
    let html = escapeHtml(markdown);

    // Code blocks (triple backticks)
    html = html.replace(
      /```(.*?)\n([\s\S]*?)```/g,
      (match, lang, code) => `<pre><code>${code.trim()}</code></pre>`
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^\*]+)\*/g, '<em>$1</em>');

    // Headings
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

    // Unordered lists
    html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Line breaks
    html = html.replace(/\n\n+/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');

    return html;
  }

  // ---- Initialize ----
  // Request log entries from extension
  vscode.postMessage({ type: 'getLogEntries' });
})();
