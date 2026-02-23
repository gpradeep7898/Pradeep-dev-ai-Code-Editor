/* ═══════════════════════════════════════════════════════════════════════════
   MyIDE v3 — app.js
   Monaco editor · file tree · tabs · terminal · AI chat
   ═══════════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  activeModel:  'ollama',
  ollamaModel:  'qwen2.5-coder:7b',
  tabs:         new Map(),   // path → { model, savedContent }
  activeTab:    null,
  chatHistory:  [],
  streaming:    false,
  wsFolder:     null,        // current workspace folder
};

let monacoEditor = null;
let termInstance = null, fitAddon = null, termWS = null;

// ── Language map ──────────────────────────────────────────────────────────────
const LANG = {
  js:'javascript', mjs:'javascript', cjs:'javascript',
  ts:'typescript', tsx:'typescript', jsx:'javascript',
  py:'python', rb:'ruby', go:'go', rs:'rust', java:'java',
  cpp:'cpp', cc:'cpp', c:'c', cs:'csharp', php:'php',
  html:'html', htm:'html', vue:'html', svelte:'html',
  css:'css', scss:'scss', less:'less',
  json:'json', jsonc:'json',
  md:'markdown', markdown:'markdown',
  sh:'shell', bash:'shell', zsh:'shell',
  yaml:'yaml', yml:'yaml', xml:'xml', sql:'sql',
  swift:'swift', kt:'kotlin', r:'r', lua:'lua',
  dockerfile:'dockerfile',
};
function getLang(ext) { return LANG[ext] || 'plaintext'; }

// ── Utility ───────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

let toastTimer;
function toast(msg, type = 'info', ms = 2200) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, ms);
}

function basename(p) { return p.split('/').pop(); }

// ── Monaco init ───────────────────────────────────────────────────────────────
function initMonaco() {
  return new Promise(resolve => {
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
    require(['vs/editor/editor.main'], () => {
      // Custom theme
      monaco.editor.defineTheme('myide-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '5a5a7a', fontStyle: 'italic' },
          { token: 'string',  foreground: 'a8d5a2' },
          { token: 'keyword', foreground: 'a89ef9' },
          { token: 'number',  foreground: 'f0db4f' },
        ],
        colors: {
          'editor.background':           '#0d0e11',
          'editor.foreground':           '#e4e4ef',
          'editor.lineHighlightBackground': '#1a1b22',
          'editorLineNumber.foreground': '#3a3a5a',
          'editorLineNumber.activeForeground': '#7c6ff7',
          'editor.selectionBackground':  '#3d387555',
          'editorCursor.foreground':     '#7c6ff7',
          'editorIndentGuide.background': '#22232e',
          'editorIndentGuide.activeBackground': '#3d3875',
        },
      });

      monacoEditor = monaco.editor.create($('monaco-editor'), {
        theme:              'myide-dark',
        fontSize:           14,
        fontFamily:         "'JetBrains Mono', 'Menlo', monospace",
        fontLigatures:      true,
        lineHeight:         22,
        minimap:            { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace:   'none',
        smoothScrolling:    true,
        cursorBlinking:     'phase',
        cursorSmoothCaretAnimation: 'on',
        padding:            { top: 12 },
        automaticLayout:    true,
        bracketPairColorization: { enabled: true },
        suggest:            { showWords: true },
      });

      // Cmd+S to save
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrentFile);

      // Track dirty state
      monacoEditor.onDidChangeModelContent(() => {
        if (!state.activeTab) return;
        const tab = state.tabs.get(state.activeTab);
        if (!tab) return;
        const isDirty = monacoEditor.getValue() !== tab.savedContent;
        const tabEl = document.querySelector(`.tab[data-path="${CSS.escape(state.activeTab)}"]`);
        if (tabEl) tabEl.classList.toggle('dirty', isDirty);
      });

      resolve();
    });
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function renderTabs() {
  const list = $('tab-list');
  list.innerHTML = '';
  for (const [p, tab] of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (p === state.activeTab ? ' active' : '');
    el.dataset.path = p;
    const isDirty = monacoEditor && tab.model === monacoEditor.getModel()
      ? monacoEditor.getValue() !== tab.savedContent
      : false;
    if (isDirty) el.classList.add('dirty');
    el.innerHTML = `<span class="tab-name">${basename(p)}</span><button class="tab-x" title="Close">✕</button>`;
    el.addEventListener('click', e => {
      if (!e.target.classList.contains('tab-x')) switchTab(p);
    });
    el.querySelector('.tab-x').addEventListener('click', e => { e.stopPropagation(); closeTab(p); });
    list.appendChild(el);
  }
  // Update filepath in titlebar
  $('active-file-path').textContent = state.activeTab || 'No file open';
}

async function openFile(filePath) {
  if (state.tabs.has(filePath)) { switchTab(filePath); return; }
  try {
    const r = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
    const data = await r.json();
    if (data.error) { toast(data.error, 'error'); return; }
    const ext   = filePath.split('.').pop().toLowerCase();
    const lang  = getLang(ext);
    const model = monaco.editor.createModel(data.content, lang, monaco.Uri.file(filePath));
    state.tabs.set(filePath, { model, savedContent: data.content });
    switchTab(filePath);
  } catch (e) { toast(`Cannot open file: ${e.message}`, 'error'); }
}

function switchTab(filePath) {
  state.activeTab = filePath;
  const tab = state.tabs.get(filePath);
  if (tab && monacoEditor) {
    monacoEditor.setModel(tab.model);
    monacoEditor.focus();
  }
  $('editor-placeholder').classList.add('hidden');
  renderTabs();
  // Sync tree selection
  document.querySelectorAll('.tree-item.sel').forEach(el => el.classList.remove('sel'));
  const treeEl = document.querySelector(`.tree-item[data-path="${CSS.escape(filePath)}"]`);
  if (treeEl) { treeEl.classList.add('sel'); treeEl.scrollIntoView({ block: 'nearest' }); }
}

function closeTab(filePath) {
  const tab = state.tabs.get(filePath);
  if (tab?.model) tab.model.dispose();
  state.tabs.delete(filePath);
  if (state.activeTab === filePath) {
    const remaining = [...state.tabs.keys()];
    state.activeTab = remaining[remaining.length - 1] ?? null;
    if (state.activeTab) {
      monacoEditor.setModel(state.tabs.get(state.activeTab).model);
    } else {
      monacoEditor.setModel(null);
      $('editor-placeholder').classList.remove('hidden');
    }
  }
  renderTabs();
}

async function saveCurrentFile() {
  if (!state.activeTab || !monacoEditor) return;
  const content = monacoEditor.getValue();
  try {
    const r = await fetch('/api/file', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ path: state.activeTab, content }),
    });
    const data = await r.json();
    if (data.ok) {
      state.tabs.get(state.activeTab).savedContent = content;
      renderTabs();
      toast('Saved', 'success');
    } else { toast(data.error, 'error'); }
  } catch (e) { toast(`Save failed: ${e.message}`, 'error'); }
}

// ── File Tree ─────────────────────────────────────────────────────────────────
async function loadTree(dirPath, container) {
  try {
    const r    = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}`);
    const data = await r.json();
    if (data.error) { container.innerHTML = `<div class="tree-empty">${data.error}</div>`; return; }

    container.innerHTML = '';
    for (const item of data.items) {
      const el = document.createElement('div');
      el.className = `tree-item ${item.isDirectory ? 'folder' : 'file'}`;
      el.dataset.path = item.path;
      if (item.ext) el.dataset.ext = item.ext;
      el.innerHTML = `<span class="tree-icon">${item.isDirectory ? '▶' : fileIcon(item.ext)}</span><span class="tree-name">${item.name}</span>`;

      if (item.isDirectory) {
        el.addEventListener('click', async e => {
          e.stopPropagation();
          const open = el.classList.toggle('open');
          el.querySelector('.tree-icon').textContent = open ? '▼' : '▶';
          let child = el.nextElementSibling;
          if (open) {
            if (!child || !child.classList.contains('tree-children')) {
              child = document.createElement('div');
              child.className = 'tree-children';
              el.after(child);
            }
            await loadTree(item.path, child);
          } else {
            if (child?.classList.contains('tree-children')) child.remove();
          }
        });
      } else {
        el.addEventListener('click', () => openFile(item.path));
      }
      container.appendChild(el);
    }
  } catch (e) { container.innerHTML = `<div class="tree-empty">Error: ${e.message}</div>`; }
}

function fileIcon(ext) {
  const icons = { js:'JS', ts:'TS', py:'PY', json:'{}', md:'MD', html:'HT', css:'CS',
                  sh:'SH', go:'GO', rs:'RS', cpp:'C+', java:'JV', kt:'KT', swift:'SW' };
  return icons[ext] || '·';
}

async function openFolder(folderPath) {
  folderPath = folderPath.replace(/^~/, () => { /* server handles ~ */ return '~'; });
  const treeEl   = $('file-tree');
  const wsPathEl = $('ws-path');
  treeEl.innerHTML = '<div class="tree-empty">Loading…</div>';
  state.wsFolder = folderPath;
  wsPathEl.textContent = folderPath;
  wsPathEl.title = folderPath;
  await loadTree(folderPath, treeEl);
  // Persist to localStorage
  localStorage.setItem('myide_workspace', folderPath);
}

// ── Terminal ──────────────────────────────────────────────────────────────────
function initTerminal() {
  if (termInstance) return;
  termInstance = new Terminal({
    fontFamily:   "'JetBrains Mono', 'Menlo', monospace",
    fontSize:     13,
    theme: {
      background:  '#0d0e11',
      foreground:  '#e4e4ef',
      cursor:      '#7c6ff7',
      black:       '#1a1b22',
      brightBlack: '#5a5a7a',
      blue:        '#7c6ff7',
      green:       '#4ade80',
      yellow:      '#facc15',
      red:         '#f87171',
      cyan:        '#79d4fd',
      white:       '#e4e4ef',
    },
    cursorBlink: true,
    allowTransparency: true,
    scrollback: 5000,
  });
  fitAddon = new FitAddon.FitAddon();
  termInstance.loadAddon(fitAddon);
  termInstance.open($('terminal-container'));
  fitAddon.fit();

  connectTermWS();

  termInstance.onData(data => {
    if (termWS?.readyState === WebSocket.OPEN) {
      termWS.send(JSON.stringify({ type: 'input', data }));
    }
  });

  window.addEventListener('resize', () => { if (fitAddon) fitAddon.fit(); });
}

function connectTermWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  termWS = new WebSocket(`${proto}://${location.host}/terminal`);
  termWS.onopen    = () => {
    const { cols, rows } = termInstance;
    termWS.send(JSON.stringify({ type: 'resize', cols, rows }));
  };
  termWS.onmessage = e => {
    try {
      const { type, data } = JSON.parse(e.data);
      if (type === 'output') termInstance.write(data);
    } catch { termInstance.write(e.data); }
  };
  termWS.onclose   = () => termInstance.writeln('\r\n\x1b[33m[connection closed]\x1b[0m');
  termWS.onerror   = () => termInstance.writeln('\r\n\x1b[31m[WebSocket error]\x1b[0m');

  // Send resize on terminal resize
  termInstance.onResize(({ cols, rows }) => {
    if (termWS?.readyState === WebSocket.OPEN) {
      termWS.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });
}

function showTerminal() {
  const panel  = $('terminal-panel');
  const area   = $('main-area');
  panel.classList.remove('term-collapsed');
  area.classList.remove('term-hidden');
  if (!termInstance) initTerminal();
  else { setTimeout(() => fitAddon?.fit(), 50); }
}

function hideTerminal() {
  $('terminal-panel').classList.add('term-collapsed');
  $('main-area').classList.add('term-hidden');
}

// ── Ollama status ─────────────────────────────────────────────────────────────
async function checkOllama() {
  const dot   = $('ollama-dot');
  const label = $('ollama-label');
  dot.className = 'status-dot loading';
  try {
    const r    = await fetch('/api/ollama/status');
    const data = await r.json();
    if (data.running) {
      dot.className   = 'status-dot online';
      label.textContent = 'Ollama ✓';
      // Populate model selector
      if (data.models.length > 0) {
        const sel = $('ollamaModelSel');
        const cur = sel.value;
        sel.innerHTML = '';
        data.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = opt.textContent = m;
          sel.appendChild(opt);
        });
        // Try to restore selection
        if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
        state.ollamaModel = sel.value;
        $('ollama-sub').textContent = sel.value;
      }
    } else {
      dot.className = 'status-dot offline';
      label.textContent = 'Ollama ✗';
    }
  } catch {
    dot.className = 'status-dot offline';
    label.textContent = 'Ollama ✗';
  }
}

// ── AI Chat ───────────────────────────────────────────────────────────────────
function addMsg(role, content, streaming = false) {
  const box  = $('chat-messages');
  const div  = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `<div class="msg-role">${role === 'user' ? 'You' : 'AI'}</div><div class="msg-body${streaming ? ' streaming' : ''}">${escapeHtml(content)}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div.querySelector('.msg-body');
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMarkdown(bodyEl, rawText) {
  bodyEl.classList.remove('streaming');
  // Parse code blocks
  const html = rawText
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')  // unescape first
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(code.trim(), { language: lang }).value
        : hljs.highlightAuto(code.trim()).value;
      return `<div class="code-block">
        <div class="code-hdr">
          <span class="code-lang">${lang || 'code'}</span>
          <div class="code-acts">
            <button onclick="codeAction(this,'copy')">Copy</button>
            <button onclick="codeAction(this,'insert')">Insert</button>
            <button onclick="codeAction(this,'save')">Save as file</button>
          </div>
        </div>
        <pre><code>${highlighted}</code></pre>
      </div>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#{1,3} (.+)$/gm, (_, t) => `<h3>${t}</h3>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  bodyEl.innerHTML = `<p>${html}</p>`;
}

function getCodeFromEl(btn) {
  const pre  = btn.closest('.code-block').querySelector('pre code');
  return pre ? pre.textContent : '';
}

window.codeAction = function(btn, action) {
  const code = getCodeFromEl(btn);
  if (action === 'copy') {
    navigator.clipboard.writeText(code).then(() => toast('Copied!', 'success'));
  } else if (action === 'insert') {
    if (monacoEditor) {
      const pos = monacoEditor.getPosition();
      monacoEditor.executeEdits('', [{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: code }]);
      monacoEditor.focus();
      toast('Inserted into editor', 'success');
    } else { toast('No file open', 'error'); }
  } else if (action === 'save') {
    const name = prompt('Save as file (path):', (state.wsFolder || '/tmp') + '/snippet.txt');
    if (!name) return;
    fetch('/api/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: name, content: code }) })
      .then(r => r.json()).then(d => d.ok ? toast('Saved: ' + name, 'success') : toast(d.error, 'error'));
  }
};

async function sendChat(text) {
  if (!text.trim() || state.streaming) return;
  text = text.trim();

  // Append user message
  state.chatHistory.push({ role: 'user', content: text });
  addMsg('user', text);

  // File context
  let fileContext = null, filePath = null;
  if ($('chkSendFile').checked && state.activeTab && monacoEditor) {
    fileContext = monacoEditor.getValue();
    filePath    = state.activeTab;
  }

  // Thinking indicator
  const thinkEl = document.createElement('div');
  thinkEl.className = 'thinking';
  thinkEl.textContent = 'Thinking…';
  $('chat-messages').appendChild(thinkEl);
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;

  state.streaming = true;
  $('btn-send').disabled = true;

  try {
    const resp = await fetch('/api/ai/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages:    state.chatHistory.slice(-20).filter(m => m.role !== 'system'),
        model:       state.activeModel,
        ollamaModel: state.ollamaModel,
        fileContext,
        filePath,
      }),
    });

    thinkEl.remove();
    const bodyEl = addMsg('ai', '', true);
    let raw = '';

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.token) { raw += d.token; bodyEl.textContent = raw; $('chat-messages').scrollTop = $('chat-messages').scrollHeight; }
          if (d.error) { bodyEl.textContent = '⚠ ' + d.error; bodyEl.classList.add('msg-error'); }
          if (d.done)  { renderMarkdown(bodyEl, raw); state.chatHistory.push({ role: 'assistant', content: raw }); }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    thinkEl.remove();
    addMsg('ai', '⚠ ' + e.message);
  }

  state.streaming = false;
  $('btn-send').disabled = false;
  $('chat-input').focus();
}

// ── Resizers (drag to resize panels) ─────────────────────────────────────────
function makeVResizer(resizerId, getLeft, setLeft) {
  const el = $(resizerId);
  let startX, startW;
  el.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = getLeft();
    el.classList.add('drag');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = e2 => {
      const delta = e2.clientX - startX;
      setLeft(Math.max(120, startW + delta));
    };
    const onUp = () => {
      el.classList.remove('drag');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function makeHResizer(resizerId, getBottom, setBottom) {
  const el = $(resizerId);
  let startY, startH;
  el.addEventListener('mousedown', e => {
    startY = e.clientY;
    startH = getBottom();
    el.classList.add('drag');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = e2 => {
      const delta = startY - e2.clientY;
      setBottom(Math.max(80, Math.min(600, startH + delta)));
    };
    const onUp = () => {
      el.classList.remove('drag');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      fitAddon?.fit();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function initResizers() {
  const ws = $('workspace');

  // Left resizer (sidebar width)
  makeVResizer('res1',
    () => parseInt(getComputedStyle(ws).getPropertyValue('--swid') || '240'),
    w  => { ws.style.setProperty('--swid', w + 'px'); }
  );

  // Right resizer (chat width)
  makeVResizer('res2',
    () => parseInt(getComputedStyle(ws).getPropertyValue('--cwid') || '340'),
    w  => { ws.style.setProperty('--cwid', w + 'px'); }
  );

  // Terminal height resizer
  makeHResizer('res-term',
    () => {
      const style = getComputedStyle($('workspace'));
      return parseInt(style.getPropertyValue('--termh') || '220');
    },
    h => {
      $('workspace').style.setProperty('--termh', h + 'px');
      fitAddon?.fit();
    }
  );
}

// ── Modal helper ──────────────────────────────────────────────────────────────
function openModal(title, placeholder, defaultVal = '') {
  return new Promise(resolve => {
    $('modal-title').textContent = title;
    $('modal-input').placeholder = placeholder;
    $('modal-input').value = defaultVal;
    $('modal-overlay').classList.remove('hidden');
    $('modal-input').focus();
    const confirm = async () => {
      const val = $('modal-input').value.trim();
      cleanup();
      resolve(val || null);
    };
    const cancel = () => { cleanup(); resolve(null); };
    const cleanup = () => {
      $('modal-overlay').classList.add('hidden');
      $('modal-confirm').removeEventListener('click', confirm);
      $('modal-cancel').removeEventListener('click', cancel);
      $('modal-input').removeEventListener('keydown', onKey);
    };
    const onKey = e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') cancel(); };
    $('modal-confirm').addEventListener('click', confirm);
    $('modal-cancel').addEventListener('click', cancel);
    $('modal-input').addEventListener('keydown', onKey);
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
  if (cmd && e.key === 'n') { e.preventDefault(); newFile(); }
  if (cmd && e.key === 'o') { e.preventDefault(); openFolderDialog(); }
  if (e.key === '`' && e.ctrlKey) { e.preventDefault(); toggleTerminal(); }
  if (cmd && e.key === 'w') { e.preventDefault(); if (state.activeTab) closeTab(state.activeTab); }
});

function toggleTerminal() {
  const panel = $('terminal-panel');
  if (panel.classList.contains('term-collapsed')) showTerminal();
  else hideTerminal();
}

async function newFile() {
  const name = await openModal('New File', 'e.g. src/hello.js', (state.wsFolder || '') + '/');
  if (!name) return;
  await fetch('/api/file/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: name }) });
  // Refresh tree then open
  if (state.wsFolder) loadTree(state.wsFolder, $('file-tree'));
  openFile(name);
}

async function openFolderDialog() {
  const folder = await openModal('Open Folder', '/Users/you/myproject', localStorage.getItem('myide_workspace') || '');
  if (folder) openFolder(folder);
}

// ── Wire up buttons ───────────────────────────────────────────────────────────
function initButtons() {
  $('btnOpenFolder').onclick   = openFolderDialog;
  $('btnNewFile').onclick      = newFile;
  $('btnSave').onclick         = saveCurrentFile;
  $('btnRefreshTree').onclick  = () => { if (state.wsFolder) loadTree(state.wsFolder, $('file-tree')); };
  $('btnToggleTerm').onclick   = toggleTerminal;
  $('btnNewTerm').onclick      = () => { if (termInstance) termInstance.focus(); else initTerminal(); };
  $('btnHideTerm').onclick     = hideTerminal;
  $('btnClearChat').onclick    = () => {
    $('chat-messages').innerHTML = '<div class="chat-welcome"><div class="wl-logo">✦</div><p>Chat cleared.</p></div>';
    state.chatHistory = [];
  };

  // Model switcher
  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeModel = btn.dataset.model;
      // Show/hide ollama model row
      $('ollama-model-row').classList.toggle('hidden', state.activeModel !== 'ollama');
      // Update footer label
      const icons = { ollama: '⚡ Ollama', claude: '◆ Claude', gpt: '⬡ GPT-4o' };
      $('active-model-lbl').textContent = icons[state.activeModel] || state.activeModel;
    });
  });

  // Ollama model selector
  $('ollamaModelSel').addEventListener('change', e => {
    state.ollamaModel = e.target.value;
    $('ollama-sub').textContent = e.target.value;
  });

  // Chat send
  $('btn-send').onclick = () => {
    const val = $('chat-input').value;
    $('chat-input').value = '';
    autoResizeTextarea($('chat-input'));
    sendChat(val);
  };

  $('chat-input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      const val = $('chat-input').value;
      $('chat-input').value = '';
      autoResizeTextarea($('chat-input'));
      sendChat(val);
    }
    // Shift+Enter = newline (default)
  });

  $('chat-input').addEventListener('input', () => autoResizeTextarea($('chat-input')));
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ── Electron IPC (if running inside Electron) ─────────────────────────────────
function initElectronIPC() {
  if (!window.electronAPI) return;
  // Handle folder dropped on dock icon or opened via IPC
  window.electronAPI.onOpenFolder(folder => openFolder(folder));
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  await initMonaco();
  initButtons();
  initResizers();
  initElectronIPC();

  // Restore last workspace
  const lastWs = localStorage.getItem('myide_workspace');
  if (lastWs) openFolder(lastWs);

  // Poll Ollama status every 8 seconds
  checkOllama();
  setInterval(checkOllama, 8000);

  // Auto-grow chat input
  autoResizeTextarea($('chat-input'));

  $('main-area').classList.add('term-hidden');
}

init();
