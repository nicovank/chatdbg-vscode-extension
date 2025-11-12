
// // export function deactivate() {}
// import * as vscode from 'vscode';
// import { spawn } from 'child_process';
// import * as path from 'path';

// let lastRunCmd: string | null = null;


// const DIAG_COLLECTION = vscode.languages.createDiagnosticCollection('chatdbg');
// const STORAGE_LAST_CMD = 'chatdbg.lastCommand';
// const STORAGE_LAST_FILE = 'chatdbg.lastFile';
// const STORAGE_LAST_ARGS  = 'chatdbg.lastArgs';   // NEW
// const STORAGE_LAST_STDIN = 'chatdbg.lastStdin';  // NEW


// function shQuote(s: string): string {
//   return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
// }
// function joinArgs(args: string[]) {
//   return args.map(a => (/\s/.test(a) ? shQuote(a) : a)).join(' ');
// }

// function getConfiguredPython(): string {
//   const fromPyExt = vscode.workspace.getConfiguration('python').get<string>('defaultInterpreterPath');
//   const fallback = vscode.workspace.getConfiguration('chatdbg').get<string>('pythonPath')
//     || '/opt/miniconda3/envs/chatdbg/bin/python';
//   return (fromPyExt && fromPyExt.trim()) ? fromPyExt : fallback;
// }
// function getActivationCommand(): string {
//   return vscode.workspace.getConfiguration('chatdbg').get<string>('activationCommand')
//     || 'source /opt/miniconda3/bin/activate chatdbg';
// }
// function getOrCreateTerminal(): vscode.Terminal {
//   return vscode.window.terminals.find(t => t.name === 'ChatDBG') || vscode.window.createTerminal('ChatDBG');
// }
// function getModelFormatFlags(): string[] {
//   const cfg = vscode.workspace.getConfiguration('chatdbg');
//   const model  = (cfg.get<string>('model')  || '').trim();
//   const format = (cfg.get<string>('format') || '').trim();
//   const flags: string[] = [];
//   if (model)  flags.push('--model', model);
//   if (format) flags.push('--format', format);
//   return flags;
// }
// function getUnsafeFlag(): string[] {
//   const cfg = vscode.workspace.getConfiguration('chatdbg');
//   return cfg.get<boolean>('unsafe') ? ['--unsafe'] : [];
// }
// // For diagnostics: remove any user-provided --format/VAL so we can force "text"
// function stripFormatFlag(flags: string[]): string[] {
//   const out: string[] = [];
//   for (let i = 0; i < flags.length; i++) {
//     if (flags[i] === '--format') { i++; continue; }
//     out.push(flags[i]);
//   }
//   return out;
// }

// let costItem: vscode.StatusBarItem | null = null;
// function setCostUI(text?: string) {
//   if (!costItem) {
//     costItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
//     costItem.tooltip = 'Last ChatDBG run cost (approx.)';
//   }
//   if (text) {
//     costItem.text = `$(meter) ${text}`;
//     costItem.show();
//   } else {
//     costItem.hide();
//   }
// }
// const COST_RE = /\[Cost:\s*~\$(.+?)\s*USD]/i;

// let resolvedLogFlag: '--log' | '--logfile' | null = null;

// async function detectLogFlag(python: string): Promise<'--log' | '--logfile'> {
//   if (resolvedLogFlag) return resolvedLogFlag;
//   const helpCmd = `${shQuote(python)} -m chatdbg --help`;
//   const out = await new Promise<string>((resolve) => {
//     const child = spawn(helpCmd, { shell: true });
//     let outBuf = '';
//     const append = (d: Buffer) => {
//       const t = d.toString();
//       outBuf += t;
//     };
//     child.stdout.on('data', append);
//     child.stderr.on('data', append);


//     child.on('close', async () => {
//       const plain = stripAnsi(outBuf);
    
//       // Gather frames from pdb pointer and traceback
//       const frames: Array<{ file: string; line: number }> = [];
//       const pdbLineRe = />\s+(.+?\.py)\((\d+)\)/g;
//       for (let m; (m = pdbLineRe.exec(plain)); ) {
//         frames.push({ file: m[1], line: parseInt(m[2], 10) });
//       }
//       const tbRe = /File "([^"]+\.py)", line (\d+)/g;
//       for (let t; (t = tbRe.exec(plain)); ) {
//         frames.push({ file: t[1], line: parseInt(t[2], 10) });
//       }
    
//       let target: { file: string; line: number } | undefined = frames.length ? frames[frames.length - 1] : undefined;
    
//       // If AssertionError, try to snap to the nearest 'assert' around the target line
//       if (target && /AssertionError\b/.test(plain)) {
//         try {
//           const uri = vscode.Uri.file(target.file);
//           const doc = await vscode.workspace.openTextDocument(uri);
//           const lines = doc.getText().split(/\r?\n/);
//           const idx = Math.max(0, Math.min(lines.length - 1, target.line - 1));
//           let snapped = idx;
//           for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
//             const i = idx + delta;
//             if (i >= 0 && i < lines.length && /\bassert\b/.test(lines[i])) { snapped = i; break; }
//           }
//           target.line = snapped + 1; // convert back to 1-based
//         } catch {
//           /* best-effort snap only */
//         }
//       }
    
//       // Build message
//       let message = 'ChatDBG run failed';
//       const msgMatch = plain.match(/^(?:.*\n)?([A-Za-z_]*Error|Exception):\s*(.+)$/m);
//       if (msgMatch) message = `${msgMatch[1]}: ${msgMatch[2].trim()}`;
    
//       DIAG_COLLECTION.clear();
    
//       if (target && Number.isFinite(target.line)) {
//         const uri = vscode.Uri.file(target.file);
//         const line0 = Math.max(0, target.line - 1); // VS Code expects 0-based
//         const range = new vscode.Range(line0, 0, line0, 1000);
//         const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
//         diag.source = 'ChatDBG';
//         DIAG_COLLECTION.set(uri, [diag]);
    
//         vscode.workspace.openTextDocument(uri).then(doc => {
//           vscode.window.showTextDocument(doc, { preview: false }).then(() => {
//             vscode.commands.executeCommand('workbench.actions.view.problems');
//           });
//         });
//       } else {
//         vscode.window.showInformationMessage('ChatDBG finished, but no precise error location was parsed. See the ChatDBG output channel.');
//       }
//     });
    
//   });
//   resolvedLogFlag = /--logfile\b/.test(out) ? '--logfile' : '--log';
//   return resolvedLogFlag;
// }

// async function getLogArgs(python: string, logPath: string): Promise<string[]> {
//   const flag = await detectLogFlag(python);
//   return [flag, logPath];
// }


// async function ensureOpenAIKeyInteractive(context: vscode.ExtensionContext, onReRun?: () => void) {
//   const cfgKey = (vscode.workspace.getConfiguration('chatdbg').get<string>('openaiKey') || '').trim();
//   const envKey = (process.env.OPENAI_API_KEY || '').trim();

//   if (cfgKey || envKey) return true;

//   const choice = await vscode.window.showWarningMessage(
//     'OpenAI API key not set for ChatDBG.',
//     'Enter key & re-run',
//     'Skip'
//   );
//   if (choice !== 'Enter key & re-run') return false;

//   const entered = await vscode.window.showInputBox({
//     title: 'Enter OpenAI API key',
//     password: true,
//     ignoreFocusOut: true,
//     placeHolder: 'sk-...'
//   });
//   if (!entered || !entered.trim()) return false;

//   await vscode.workspace.getConfiguration('chatdbg').update('openaiKey', entered.trim(), true);
//   vscode.window.showInformationMessage('Saved to Settings → chatdbg.openaiKey');

//   if (onReRun) onReRun();
//   return true;
// }


// async function promptArgsAndStdin(context: vscode.ExtensionContext) {
//   const prevArgs  = context.workspaceState.get<string>(STORAGE_LAST_ARGS)  || '';
//   const prevStdin = context.workspaceState.get<string>(STORAGE_LAST_STDIN) || '';

//   const args = await vscode.window.showInputBox({
//     title: 'Program arguments (space-separated)',
//     value: prevArgs,
//     placeHolder: 'e.g., --flag 123 input.txt'
//   });
//   if (args === undefined) return; // cancelled

//   const stdin = await vscode.window.showInputBox({
//     title: 'stdin (press Enter for empty; use ⇧Enter for newline)',
//     value: prevStdin,
//     prompt: 'Multiline supported',
//     ignoreFocusOut: true
//   });
//   if (stdin === undefined) return; // cancelled

//   await context.workspaceState.update(STORAGE_LAST_ARGS, args);
//   await context.workspaceState.update(STORAGE_LAST_STDIN, stdin);
// }

// function hasText(s?: string | null) { return !!s && s.trim().length > 0; }

// async function runWithArgs(context: vscode.ExtensionContext) {
//   const editor = vscode.window.activeTextEditor;
//   if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }
//   const file = editor.document.fileName;
//   if (!file.toLowerCase().endsWith('.py')) {
//     vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
//     return;
//   }

//   const logPath = path.join(path.dirname(file), 'log.yaml');
//   await promptArgsAndStdin(context);

//   const userArgs  = context.workspaceState.get<string>(STORAGE_LAST_ARGS)  || '';
//   const userStdin = context.workspaceState.get<string>(STORAGE_LAST_STDIN) || '';

//   const python        = getConfiguredPython();
//   const activationCmd = getActivationCommand();

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

//   await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

//   const logArgs = await getLogArgs(python, logPath);
//   const args = ['-m', 'chatdbg', ...getUnsafeFlag(), ...getModelFormatFlags(), ...logArgs, '-c', 'continue', file];
//   const pyQuoted = /\s/.test(python) ? shQuote(python) : python;

//   const withUserArgs = userArgs.trim().length ? ` ${userArgs}` : '';
//   const stdinBlock = hasText(userStdin)
//     ? ` <<'__CHATDBG_STDIN__'\n${userStdin}\n__CHATDBG_STDIN__`
//     : '';

//   const cmd =
//     `${activationCmd} && echo Using Python: ${shQuote(python)} && ` +
//     `${pyQuoted} ${joinArgs(args)}${withUserArgs}${stdinBlock}`;
//   lastRunCmd = cmd;

//   await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

//   const term = getOrCreateTerminal();
//   term.show(true);
//   exportKeyIfConfigured(term);
//   term.sendText(cmd);

//   await saveLastRun(context, cmd, file);
// }


// async function clearSavedArgs(context: vscode.ExtensionContext) {
//   await context.workspaceState.update(STORAGE_LAST_ARGS, '');
//   await context.workspaceState.update(STORAGE_LAST_STDIN, '');
//   vscode.window.showInformationMessage('ChatDBG: cleared saved args/stdin.');
// }

// // --- Guardrail: detect chatdbg is importable with given python ---
// async function ensureChatdbgInstalled(python: string): Promise<boolean> {
//   return await new Promise<boolean>((resolve) => {
//     const cmd = `${shQuote(python)} -m chatdbg --version`;
//     const child = spawn(cmd, { shell: true });
//     let ok = true;
//     child.on('error', () => { ok = false; });
//     child.on('close', (code) => resolve(code === 0 && ok));
//   });
// }
// async function openLog(context: vscode.ExtensionContext) {
//   const lastFile = context.workspaceState.get<string>(STORAGE_LAST_FILE);
//   const candidates: vscode.Uri[] = [];

//   // 1) Try alongside last run file
//   if (lastFile) {
//     const dir = path.dirname(lastFile);
//     try {
//       const hit = vscode.Uri.file(path.join(dir, 'log.yaml'));
//       await vscode.workspace.fs.stat(hit);
//       candidates.push(hit);
//     } catch {}
//   }

//   // 2) Search workspace for log.yaml (fallback)
//   if (!candidates.length && vscode.workspace.workspaceFolders?.length) {
//     const found = await vscode.workspace.findFiles('**/log.yaml', '**/node_modules/**', 25);
//     for (const f of found) candidates.push(f);
//   }

//   if (!candidates.length) {
//     vscode.window.showInformationMessage('No log.yaml found yet. Run ChatDBG to generate one.');
//     return;
//   }

//   let pick = candidates[0];
//   if (candidates.length > 1) {
//     const items = candidates.map(u => ({ label: path.basename(u.fsPath), description: u.fsPath, uri: u }));
//     const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Select a log.yaml to open' });
//     if (!choice) return;
//     pick = choice.uri;
//   }

//   const doc = await vscode.workspace.openTextDocument(pick);
//   await vscode.window.showTextDocument(doc, { preview: false });
// }


// // --- Common: export key in terminal if provided in settings ---
// function exportKeyIfConfigured(term: vscode.Terminal) {
//   const openaiKey = vscode.workspace.getConfiguration('chatdbg').get<string>('openaiKey') || '';
//   if (openaiKey.trim()) {
//     term.sendText(`export OPENAI_API_KEY=${shQuote(openaiKey.trim())}`);
//   } else if (!process.env.OPENAI_API_KEY) {
//     term.sendText('# Tip: export OPENAI_API_KEY=your_key   (or set chatdbg.openaiKey in Settings)');
//   }
// }



// // --- Save and rerun support ---
// async function saveLastRun(context: vscode.ExtensionContext, cmd: string, file: string) {
//   await context.workspaceState.update(STORAGE_LAST_CMD, cmd);
//   await context.workspaceState.update(STORAGE_LAST_FILE, file);
// }
// async function getLastRun(context: vscode.ExtensionContext) {
//   const cmd = context.workspaceState.get<string>(STORAGE_LAST_CMD);
//   const file = context.workspaceState.get<string>(STORAGE_LAST_FILE);
//   return { cmd, file };
// }

// // ---------- Run current file in a terminal ----------
// async function runCurrentFile(context: vscode.ExtensionContext) {
//   const editor = vscode.window.activeTextEditor;
//   if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }

//   const file = editor.document.fileName;
//   if (!file.toLowerCase().endsWith('.py')) {
//     vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
//     return;
//   }
//   const logPath = path.join(path.dirname(file), 'log.yaml');
//   const python = getConfiguredPython();
//   const activationCmd = getActivationCommand();

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
//   const logArgs = await getLogArgs(python, logPath);
//   const args = ['-m', 'chatdbg', ...getUnsafeFlag(), ...getModelFormatFlags(), ...logArgs, '-c', 'continue', file];


//   const pyQuoted = /\s/.test(python) ? shQuote(python) : python;
//   const cmd = `${activationCmd} && echo Using Python: ${shQuote(python)} && ${pyQuoted} ${joinArgs(args)}`;
//   lastRunCmd = cmd; // so rerunLast() knows what to re-run

//   // Ask for API key (after building cmd, so re-run uses same command)
//   await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

//   const term = getOrCreateTerminal();
//   term.show(true);
//   exportKeyIfConfigured(term);
//   term.sendText(cmd);
//   term.sendText('chat Why did this fail?');
//   await saveLastRun(context, cmd, file);
// }



// // ---------- Explain last error (send a chat message into the terminal) ----------
// async function explainLastError() {
//   const term = vscode.window.terminals.find(t => t.name === 'ChatDBG');
//   if (!term) {
//     vscode.window.showWarningMessage('No ChatDBG session found. Run “ChatDBG: Run Current File” first.');
//     return;
//   }
//   term.show(true);
//   term.sendText('chat Why did this fail?');
// }

// // ---------- Run & Explain (one click) ----------
// async function runAndExplain(context: vscode.ExtensionContext) {
//   const editor = vscode.window.activeTextEditor;
//   if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }
//   const file = editor.document.fileName;
//   if (!file.toLowerCase().endsWith('.py')) {
//     vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
//     return;
//   }

//   const logPath = path.join(path.dirname(file), 'log.yaml');
//   const python = getConfiguredPython();
//   const activationCmd = getActivationCommand();

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

//   const logArgs = await getLogArgs(python, logPath);
//   const args = ['-m', 'chatdbg', ...getUnsafeFlag(), ...getModelFormatFlags(), ...logArgs, '-c', 'continue', file];
//   const pyQuoted = /\s/.test(python) ? shQuote(python) : python;
//   const cmd = `${activationCmd} && echo Using Python: ${shQuote(python)} && ${pyQuoted} ${joinArgs(args)}`;
//   lastRunCmd = cmd;

//   await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

//   const term = getOrCreateTerminal();
//   term.show(true);
//   exportKeyIfConfigured(term);
//   term.sendText(cmd);
//   term.sendText('chat Why did this fail?');
//   await saveLastRun(context, cmd, file);
// }


// // ---------- Rerun Last ----------
// async function rerunLast(context: vscode.ExtensionContext) {
//   if (!lastRunCmd) {
//     lastRunCmd = context.workspaceState.get<string>(STORAGE_LAST_CMD) || null;
//   }
//   if (!lastRunCmd) {
//     vscode.window.showInformationMessage('ChatDBG: nothing to rerun yet. Run a file first.');
//     return;
//   }
//   const term = getOrCreateTerminal();
//   term.show(true);
//   exportKeyIfConfigured(term);
//   term.sendText(lastRunCmd);
// }




// // ---------- Run & Collect Diagnostics (populates Problems) ----------
// async function runWithDiagnostics() {
//   const editor = vscode.window.activeTextEditor;
//   if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }

//   const file = editor.document.fileName;
//   if (!file.toLowerCase().endsWith('.py')) {
//     vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
//     return;
//   }

//   const stripAnsi = (s: string) =>
//     s.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

//   const python = getConfiguredPython();
//   const activationCmd = getActivationCommand();
//   const openaiKey = vscode.workspace.getConfiguration('chatdbg').get<string>('openaiKey') || '';

//   const out = vscode.window.createOutputChannel('ChatDBG');
//   out.clear();
//   out.show(true);

//   const mfFlags = stripFormatFlag(getModelFormatFlags());
//   const unsafeFlags = getUnsafeFlag();
//   const args = [
//     '-m', 'chatdbg',
//     ...unsafeFlags,
//     ...mfFlags,
//     '--format', 'text',
//     '-c', 'continue; q',
//     file
//   ];
//   const runCmd = `${activationCmd} && ${shQuote(python)} ${joinArgs(args)} 2>&1`;

//   const child = spawn(runCmd, {
//     shell: true,
//     cwd: path.dirname(file),
//     env: {
//       ...process.env,
//       ...(openaiKey ? { OPENAI_API_KEY: openaiKey } : {}),
//       CHATDBG_NO_COLOR: '1',
//       PYTHONUNBUFFERED: '1'
//     }
//   });

//   let buffer = '';
//   const append = (d: Buffer) => { const t = d.toString(); buffer += t; out.append(t); };
//   child.stdout.on('data', append);
//   child.stderr.on('data', append);

//   // Watchdog: ensures ipdb exits even when not in a terminal
//   const politeQuit = setTimeout(() => {
//     try { child.stdin?.write('q\n'); } catch {}
//   }, 1500);
//   const hardKill = setTimeout(() => {
//     try { child.kill('SIGTERM'); } catch {}
//   }, 3000);

//   child.on('error', (e) => {
//     clearTimeout(politeQuit); clearTimeout(hardKill);
//     vscode.window.showErrorMessage(`ChatDBG: failed to start (${e.message})`);
//   });

//   child.on('close', async () => {
//     clearTimeout(politeQuit); clearTimeout(hardKill);

//     const plain = stripAnsi(buffer);

//     // Collect frames from pdb pointers and traceback lines
//     const frames: Array<{ file: string; line: number }> = [];
//     const pdbLineRe = />\s+(.+?\.py)\((\d+)\)/g;
//     for (let m; (m = pdbLineRe.exec(plain)); ) {
//       frames.push({ file: m[1], line: parseInt(m[2], 10) });
//     }
//     const tbRe = /File "([^"]+\.py)", line (\d+)/g;
//     for (let t; (t = tbRe.exec(plain)); ) {
//       frames.push({ file: t[1], line: parseInt(t[2], 10) });
//     }

//     let target: { file: string; line: number } | undefined = frames.length ? frames[frames.length - 1] : undefined;

//     // If it's an AssertionError, try snapping to the nearest assert line
//     if (target && /AssertionError\b/.test(plain)) {
//       try {
//         const uri = vscode.Uri.file(target.file);
//         const doc = await vscode.workspace.openTextDocument(uri);
//         const lines = doc.getText().split(/\r?\n/);
//         const idx = Math.max(0, Math.min(lines.length - 1, target.line - 1));
//         let snapped = idx;
//         for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
//           const i = idx + delta;
//           if (i >= 0 && i < lines.length && /\bassert\b/.test(lines[i])) { snapped = i; break; }
//         }
//         target.line = snapped + 1;
//       } catch {
//         // best-effort only
//       }
//     }

//     // Extract readable message
//     let message = 'ChatDBG run failed';
//     const msgMatch = plain.match(/^(?:.*\n)?([A-Za-z_]*Error|Exception):\s*(.+)$/m);
//     if (msgMatch) message = `${msgMatch[1]}: ${msgMatch[2].trim()}`;

//     DIAG_COLLECTION.clear();

//     if (target && Number.isFinite(target.line)) {
//       const uri = vscode.Uri.file(target.file);
//       const line0 = Math.max(0, target.line - 1);
//       const range = new vscode.Range(line0, 0, line0, 1000);
//       const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
//       diag.source = 'ChatDBG';
//       DIAG_COLLECTION.set(uri, [diag]);

//       vscode.workspace.openTextDocument(uri).then(doc => {
//         vscode.window.showTextDocument(doc, { preview: false }).then(() => {
//           vscode.commands.executeCommand('workbench.actions.view.problems');
//         });
//       });
//     } else {
//       vscode.window.showInformationMessage('ChatDBG finished, but no precise error location was parsed. See the ChatDBG output channel.');
//     }
//   });
// }



// export function activate(context: vscode.ExtensionContext) {
//   lastRunCmd = context.workspaceState.get<string>(STORAGE_LAST_CMD) || null;
//   context.subscriptions.push(
//     vscode.commands.registerCommand('chatdbg.runCurrentFile', () => runCurrentFile(context)),
//     vscode.commands.registerCommand('chatdbg.explainLastError', explainLastError),
//     vscode.commands.registerCommand('chatdbg.runAndExplain', () => runAndExplain(context)),
//     vscode.commands.registerCommand('chatdbg.runWithDiagnostics', runWithDiagnostics),
//     vscode.commands.registerCommand('chatdbg.rerunLast', () => rerunLast(context)),
//     vscode.commands.registerCommand('chatdbg.openLog', () => openLog(context)),
//     vscode.commands.registerCommand('chatdbg.runWithArgs', () => runWithArgs(context)), // NEW
//     vscode.commands.registerCommand('chatdbg.clearArgs', () => clearSavedArgs(context)), // NEW

    
//     DIAG_COLLECTION
//   );

//   // Status bar: Run button (Python files)
//   const runItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
//   runItem.text = '$(debug-start) ChatDBG';
//   runItem.command = 'chatdbg.runCurrentFile';
//   runItem.tooltip = 'Run current Python file with ChatDBG';
//   context.subscriptions.push(runItem);

//   // Status bar: “Why?” button (only when a ChatDBG terminal exists)
//   const whyItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
//   whyItem.text = '$(question) Why?';
//   whyItem.command = 'chatdbg.explainLastError';
//   whyItem.tooltip = 'Ask ChatDBG: Why did this fail?';
//   context.subscriptions.push(whyItem);

//   const refreshStatus = () => {
//     const lang = vscode.window.activeTextEditor?.document.languageId;
//     if (lang === 'python') runItem.show(); else runItem.hide();

//     const hasChatdbgTerm = vscode.window.terminals.some(t => t.name === 'ChatDBG');
//     if (hasChatdbgTerm) whyItem.show(); else whyItem.hide();
//   };

//   context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(refreshStatus));
//   context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refreshStatus));
//   context.subscriptions.push(vscode.window.onDidOpenTerminal(refreshStatus));
//   context.subscriptions.push(vscode.window.onDidCloseTerminal(refreshStatus));
//   refreshStatus();
// }

// export function deactivate() {}

// function stripAnsi(outBuf: string): string {
//   return outBuf.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
// }

// src/extension.ts

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

let lastRunCmd: string | null = null;

const DIAG_COLLECTION = vscode.languages.createDiagnosticCollection('chatdbg');
const STORAGE_LAST_CMD   = 'chatdbg.lastCommand';
const STORAGE_LAST_FILE  = 'chatdbg.lastFile';
const STORAGE_LAST_ARGS  = 'chatdbg.lastArgs';
const STORAGE_LAST_STDIN = 'chatdbg.lastStdin';

function shQuote(s: string): string {
  return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}
function joinArgs(args: string[]) {
  return args.map(a => (/\s/.test(a) ? shQuote(a) : a)).join(' ');
}
function stripAnsi(s: string): string {
  return s.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function getConfiguredPython(): string {
  const fromPyExt = vscode.workspace.getConfiguration('python').get<string>('defaultInterpreterPath');
  const fallback = vscode.workspace.getConfiguration('chatdbg').get<string>('pythonPath')
    || '/opt/miniconda3/envs/chatdbg/bin/python';
  return (fromPyExt && fromPyExt.trim()) ? fromPyExt : fallback;
}
function getActivationCommand(): string {
  return vscode.workspace.getConfiguration('chatdbg').get<string>('activationCommand')
    || 'source /opt/miniconda3/bin/activate chatdbg';
}
function getOrCreateTerminal(): vscode.Terminal {
  return vscode.window.terminals.find(t => t.name === 'ChatDBG') || vscode.window.createTerminal('ChatDBG');
}
function getModelFormatFlags(): string[] {
  const cfg = vscode.workspace.getConfiguration('chatdbg');
  const model  = (cfg.get<string>('model')  || '').trim();
  const format = (cfg.get<string>('format') || '').trim();
  const flags: string[] = [];
  if (model)  flags.push('--model', model);
  if (format) flags.push('--format', format);
  return flags;
}
function getUnsafeFlag(): string[] {
  const cfg = vscode.workspace.getConfiguration('chatdbg');
  return cfg.get<boolean>('unsafe') ? ['--unsafe'] : [];
}
// For diagnostics: remove any user-provided --format/VAL so we can force "text"
function stripFormatFlag(flags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--format') { i++; continue; }
    out.push(flags[i]);
  }
  return out;
}

/* =========================
   Cost badge (status bar)
   ========================= */
let costItem: vscode.StatusBarItem | null = null;
const COST_RE = /\[Cost:\s*~\$(.+?)\s*USD]/i;

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

/* =========================
   --log vs --logfile helper
   ========================= */
let resolvedLogFlag: '--log' | '--logfile' | null = null;

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

async function getLogArgs(python: string, logPath: string): Promise<string[]> {
  const flag = await detectLogFlag(python);
  return [flag, logPath];
}

/* =========================
   OPENAI key prompt
   ========================= */
async function ensureOpenAIKeyInteractive(context: vscode.ExtensionContext, onReRun?: () => void) {
  const cfgKey = (vscode.workspace.getConfiguration('chatdbg').get<string>('openaiKey') || '').trim();
  const envKey = (process.env.OPENAI_API_KEY || '').trim();

  if (cfgKey || envKey) return true;

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

  await vscode.workspace.getConfiguration('chatdbg').update('openaiKey', entered.trim(), true);
  vscode.window.showInformationMessage('Saved to Settings → chatdbg.openaiKey');

  if (onReRun) onReRun();
  return true;
}

/* =========================
   Args / stdin prompt
   ========================= */
async function promptArgsAndStdin(context: vscode.ExtensionContext) {
  const prevArgs  = context.workspaceState.get<string>(STORAGE_LAST_ARGS)  || '';
  const prevStdin = context.workspaceState.get<string>(STORAGE_LAST_STDIN) || '';

  const args = await vscode.window.showInputBox({
    title: 'Program arguments (space-separated)',
    value: prevArgs,
    placeHolder: 'e.g., --flag 123 input.txt'
  });
  if (args === undefined) return; // cancelled

  const stdin = await vscode.window.showInputBox({
    title: 'stdin (press Enter for empty; use ⇧Enter for newline)',
    value: prevStdin,
    prompt: 'Multiline supported',
    ignoreFocusOut: true
  });
  if (stdin === undefined) return; // cancelled

  await context.workspaceState.update(STORAGE_LAST_ARGS, args);
  await context.workspaceState.update(STORAGE_LAST_STDIN, stdin);
}
function hasText(s?: string | null) { return !!s && s.trim().length > 0; }

/* =========================
   Run with args/stdin
   ========================= */
async function runWithArgs(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }
  const file = editor.document.fileName;
  if (!file.toLowerCase().endsWith('.py')) {
    vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
    return;
  }

  const logPath = path.join(path.dirname(file), 'log.yaml');
  await promptArgsAndStdin(context);

  const userArgs  = context.workspaceState.get<string>(STORAGE_LAST_ARGS)  || '';
  const userStdin = context.workspaceState.get<string>(STORAGE_LAST_STDIN) || '';

  const python        = getConfiguredPython();
  const activationCmd = getActivationCommand();

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

/* =========================
   Clear saved args/stdin
   ========================= */
async function clearSavedArgs(context: vscode.ExtensionContext) {
  await context.workspaceState.update(STORAGE_LAST_ARGS, '');
  await context.workspaceState.update(STORAGE_LAST_STDIN, '');
  vscode.window.showInformationMessage('ChatDBG: cleared saved args/stdin.');
}

/* =========================
   Ensure chatdbg exists
   ========================= */
async function ensureChatdbgInstalled(python: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const cmd = `${shQuote(python)} -m chatdbg --version`;
    const child = spawn(cmd, { shell: true });
    let ok = true;
    child.on('error', () => { ok = false; });
    child.on('close', (code) => resolve(code === 0 && ok));
  });
}

/* =========================
   Open log.yaml (and read cost)
   ========================= */
async function openLog(context: vscode.ExtensionContext) {
  const lastFile = context.workspaceState.get<string>(STORAGE_LAST_FILE);
  const candidates: vscode.Uri[] = [];

  if (lastFile) {
    const dir = path.dirname(lastFile);
    try {
      const hit = vscode.Uri.file(path.join(dir, 'log.yaml'));
      await vscode.workspace.fs.stat(hit);
      candidates.push(hit);
    } catch {}
  }

  if (!candidates.length && vscode.workspace.workspaceFolders?.length) {
    const found = await vscode.workspace.findFiles('**/log.yaml', '**/node_modules/**', 25);
    for (const f of found) candidates.push(f);
  }

  if (!candidates.length) {
    vscode.window.showInformationMessage('No log.yaml found yet. Run ChatDBG to generate one.');
    return;
  }

  let pick = candidates[0];
  if (candidates.length > 1) {
    const items = candidates.map(u => ({ label: path.basename(u.fsPath), description: u.fsPath, uri: u }));
    const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Select a log.yaml to open' });
    if (!choice) return;
    pick = choice.uri;
  }

  // Try to parse cost from the file
  try {
    const bytes = await vscode.workspace.fs.readFile(pick);
    const txt = Buffer.from(bytes).toString('utf8');
    const m = txt.match(COST_RE);
    if (m) setCostUI(`$${m[1].trim()}`);
  } catch {}

  const doc = await vscode.workspace.openTextDocument(pick);
  await vscode.window.showTextDocument(doc, { preview: false });
}

/* =========================
   Export OPENAI key into terminal
   ========================= */
function exportKeyIfConfigured(term: vscode.Terminal) {
  const openaiKey = vscode.workspace.getConfiguration('chatdbg').get<string>('openaiKey') || '';
  if (openaiKey.trim()) {
    term.sendText(`export OPENAI_API_KEY=${shQuote(openaiKey.trim())}`);
  } else if (!process.env.OPENAI_API_KEY) {
    term.sendText('# Tip: export OPENAI_API_KEY=your_key   (or set chatdbg.openaiKey in Settings)');
  }
}

/* =========================
   Save / load last run
   ========================= */
async function saveLastRun(context: vscode.ExtensionContext, cmd: string, file: string) {
  await context.workspaceState.update(STORAGE_LAST_CMD, cmd);
  await context.workspaceState.update(STORAGE_LAST_FILE, file);
}
async function getLastRun(context: vscode.ExtensionContext) {
  const cmd = context.workspaceState.get<string>(STORAGE_LAST_CMD);
  const file = context.workspaceState.get<string>(STORAGE_LAST_FILE);
  return { cmd, file };
}

/* =========================
   Run current file
   ========================= */
async function runCurrentFile(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }

  const file = editor.document.fileName;
  if (!file.toLowerCase().endsWith('.py')) {
    vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
    return;
  }

  const logPath = path.join(path.dirname(file), 'log.yaml');
  const python = getConfiguredPython();
  const activationCmd = getActivationCommand();

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

  const logArgs = await getLogArgs(python, logPath);
  const args = ['-m', 'chatdbg', ...getUnsafeFlag(), ...getModelFormatFlags(), ...logArgs, '-c', 'continue', file];

  const pyQuoted = /\s/.test(python) ? shQuote(python) : python;
  const cmd = `${activationCmd} && echo Using Python: ${shQuote(python)} && ${pyQuoted} ${joinArgs(args)}`;
  lastRunCmd = cmd;

  await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

  const term = getOrCreateTerminal();
  term.show(true);
  exportKeyIfConfigured(term);
  term.sendText(cmd);
  term.sendText('chat Why did this fail?');
  await saveLastRun(context, cmd, file);
}

/* =========================
   Explain last error (terminal)
   ========================= */
async function explainLastError() {
  const term = vscode.window.terminals.find(t => t.name === 'ChatDBG');
  if (!term) {
    vscode.window.showWarningMessage('No ChatDBG session found. Run “ChatDBG: Run Current File” first.');
    return;
  }
  term.show(true);
  term.sendText('chat Why did this fail?');
}

/* =========================
   Run & Explain
   ========================= */
async function runAndExplain(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }
  const file = editor.document.fileName;
  if (!file.toLowerCase().endsWith('.py')) {
    vscode.window.showErrorMessage('Open a Python file to run with ChatDBG.');
    return;
  }

  const logPath = path.join(path.dirname(file), 'log.yaml');
  const python = getConfiguredPython();
  const activationCmd = getActivationCommand();

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

  const logArgs = await getLogArgs(python, logPath);
  const args = ['-m', 'chatdbg', ...getUnsafeFlag(), ...getModelFormatFlags(), ...logArgs, '-c', 'continue', file];

  const pyQuoted = /\s/.test(python) ? shQuote(python) : python;
  const cmd = `${activationCmd} && echo Using Python: ${shQuote(python)} && ${pyQuoted} ${joinArgs(args)}`;
  lastRunCmd = cmd;

  await ensureOpenAIKeyInteractive(context, () => rerunLast(context));

  const term = getOrCreateTerminal();
  term.show(true);
  exportKeyIfConfigured(term);
  term.sendText(cmd);
  term.sendText('chat Why did this fail?');
  await saveLastRun(context, cmd, file);
}

/* =========================
   Rerun last
   ========================= */
async function rerunLast(context: vscode.ExtensionContext) {
  if (!lastRunCmd) {
    lastRunCmd = context.workspaceState.get<string>(STORAGE_LAST_CMD) || null;
  }
  if (!lastRunCmd) {
    vscode.window.showInformationMessage('ChatDBG: nothing to rerun yet. Run a file first.');
    return;
  }
  const term = getOrCreateTerminal();
  term.show(true);
  exportKeyIfConfigured(term);
  term.sendText(lastRunCmd);
}

/* =========================
   Run & Collect Diagnostics
   ========================= */
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

  const out = vscode.window.createOutputChannel('ChatDBG');
  out.clear();
  out.show(true);

  const mfFlags = stripFormatFlag(getModelFormatFlags());
  const unsafeFlags = getUnsafeFlag();
  const args = [
    '-m', 'chatdbg',
    ...unsafeFlags,
    ...mfFlags,
    '--format', 'text',
    '-c', 'continue; q',
    file
  ];
  const runCmd = `${activationCmd} && ${shQuote(python)} ${joinArgs(args)} 2>&1`;

  const child = spawn(runCmd, {
    shell: true,
    cwd: path.dirname(file),
    env: {
      ...process.env,
      ...(openaiKey ? { OPENAI_API_KEY: openaiKey } : {}),
      CHATDBG_NO_COLOR: '1',
      PYTHONUNBUFFERED: '1'
    }
  });

  let buffer = '';
  const append = (d: Buffer) => { const t = d.toString(); buffer += t; out.append(t); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);

  // Watchdog: ensures ipdb exits even when not in a terminal
  const politeQuit = setTimeout(() => { try { child.stdin?.write('q\n'); } catch {} }, 1500);
  const hardKill  = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 3000);

  child.on('error', (e) => {
    clearTimeout(politeQuit); clearTimeout(hardKill);
    vscode.window.showErrorMessage(`ChatDBG: failed to start (${e.message})`);
  });

  child.on('close', async () => {
    clearTimeout(politeQuit); clearTimeout(hardKill);

    const plain = stripAnsi(buffer);

    // Surface approximate cost if present
    const costMatch = plain.match(COST_RE);
    if (costMatch) {
      const cost = costMatch[1].trim();
      setCostUI(`$${cost}`);
      vscode.window.setStatusBarMessage(`ChatDBG cost ~ $${cost}`, 5000);
    }

    // Parse frames (pdb pointer + traceback)
    const frames: Array<{ file: string; line: number }> = [];
    const pdbLineRe = />\s+(.+?\.py)\((\d+)\)/g;
    for (let m; (m = pdbLineRe.exec(plain)); ) {
      frames.push({ file: m[1], line: parseInt(m[2], 10) });
    }
    const tbRe = /File "([^"]+\.py)", line (\d+)/g;
    for (let t; (t = tbRe.exec(plain)); ) {
      frames.push({ file: t[1], line: parseInt(t[2], 10) });
    }

    let target: { file: string; line: number } | undefined = frames.length ? frames[frames.length - 1] : undefined;

    // If AssertionError, try to snap to nearest assert
    if (target && /AssertionError\b/.test(plain)) {
      try {
        const uri = vscode.Uri.file(target.file);
        const doc = await vscode.workspace.openTextDocument(uri);
        const lines = doc.getText().split(/\r?\n/);
        const idx = Math.max(0, Math.min(lines.length - 1, target.line - 1));
        let snapped = idx;
        for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
          const i = idx + delta;
          if (i >= 0 && i < lines.length && /\bassert\b/.test(lines[i])) { snapped = i; break; }
        }
        target.line = snapped + 1;
      } catch { /* best-effort */ }
    }

    // Extract readable message
    let message = 'ChatDBG run failed';
    const msgMatch = plain.match(/^(?:.*\n)?([A-Za-z_]*Error|Exception):\s*(.+)$/m);
    if (msgMatch) message = `${msgMatch[1]}: ${msgMatch[2].trim()}`;

    DIAG_COLLECTION.clear();

    if (target && Number.isFinite(target.line)) {
      const uri = vscode.Uri.file(target.file);
      const line0 = Math.max(0, target.line - 1);
      const range = new vscode.Range(line0, 0, line0, 1000);
      const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
      diag.source = 'ChatDBG';
      DIAG_COLLECTION.set(uri, [diag]);

      vscode.workspace.openTextDocument(uri).then(doc => {
        vscode.window.showTextDocument(doc, { preview: false }).then(() => {
          vscode.commands.executeCommand('workbench.actions.view.problems');
        });
      });
    } else {
      vscode.window.showInformationMessage('ChatDBG finished, but no precise error location was parsed. See the ChatDBG output channel.');
    }
  });
}

/* =========================
   Activate / Deactivate
   ========================= */
export function activate(context: vscode.ExtensionContext) {
  lastRunCmd = context.workspaceState.get<string>(STORAGE_LAST_CMD) || null;
  setCostUI(); // create hidden cost badge

  context.subscriptions.push(
    vscode.commands.registerCommand('chatdbg.runCurrentFile', () => runCurrentFile(context)),
    vscode.commands.registerCommand('chatdbg.explainLastError', explainLastError),
    vscode.commands.registerCommand('chatdbg.runAndExplain', () => runAndExplain(context)),
    vscode.commands.registerCommand('chatdbg.runWithDiagnostics', runWithDiagnostics),
    vscode.commands.registerCommand('chatdbg.rerunLast', () => rerunLast(context)),
    vscode.commands.registerCommand('chatdbg.openLog', () => openLog(context)),
    vscode.commands.registerCommand('chatdbg.runWithArgs', () => runWithArgs(context)),
    vscode.commands.registerCommand('chatdbg.clearArgs', () => clearSavedArgs(context)),
    DIAG_COLLECTION
  );

  // Status bar buttons
  const runItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  runItem.text = '$(debug-start) ChatDBG';
  runItem.command = 'chatdbg.runCurrentFile';
  runItem.tooltip = 'Run current Python file with ChatDBG';
  context.subscriptions.push(runItem);

  const whyItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  whyItem.text = '$(question) Why?';
  whyItem.command = 'chatdbg.explainLastError';
  whyItem.tooltip = 'Ask ChatDBG: Why did this fail?';
  context.subscriptions.push(whyItem);

  const refreshStatus = () => {
    const lang = vscode.window.activeTextEditor?.document.languageId;
    if (lang === 'python') runItem.show(); else runItem.hide();

    const hasChatdbgTerm = vscode.window.terminals.some(t => t.name === 'ChatDBG');
    if (hasChatdbgTerm) whyItem.show(); else whyItem.hide();
  };

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(refreshStatus));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refreshStatus));
  context.subscriptions.push(vscode.window.onDidOpenTerminal(refreshStatus));
  context.subscriptions.push(vscode.window.onDidCloseTerminal(refreshStatus));
  refreshStatus();
}

export function deactivate() {}

