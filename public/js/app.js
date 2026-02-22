// ─── MyIDE Frontend App ───────────────────────────────────────────────────────

const API = '';
let editor = null;
let activeModel = 'claude';
let chatHistory = [];
let openTabs = []; // [{path, name, unsaved}]
let activeTabPath = null;
let terminal = null;
let ws = null;
let isAISending = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMonaco();
  initWebSocket();
  initModelSwitcher();
  initChatInput();
  initToolbarButtons();
  initResizeHandles();
  loadWorkspace();
  // Init features after a short tick so features.js is fully parsed
  setTimeout(() => { if (typeof featuresInit === 'function') featuresInit(); }, 100);
});

// ─── MONACO EDITOR ────────────────────────────────────────────────────────────
function initMonaco() {
  require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
  require(['vs/editor/editor.main'], () => {
    // Dark theme matching our IDE
    monaco.editor.defineTheme('myide-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '4a5068', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7c6ff7' },
        { token: 'string', foreground: '98c379' },
        { token: 'number', foreground: 'e87c5a' },
        { token: 'type', foreground: '61afef' },
        { token: 'function', foreground: 'd4b4ff' },
      ],
      colors: {
        'editor.background': '#0d0e11',
        'editor.foreground': '#e8eaf0',
        'editorLineNumber.foreground': '#2d3344',
        'editorLineNumber.activeForeground': '#7c6ff7',
        'editor.selectionBackground': '#252a38',
        'editor.lineHighlightBackground': '#13151a',
        'editorCursor.foreground': '#7c6ff7',
        'editor.findMatchBackground': '#7c6ff730',
        'editorGutter.background': '#0d0e11',
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': '#21252e80',
        'scrollbarSlider.hoverBackground': '#2d334480',
      }
    });

    editor = monaco.editor.create(document.getElementById('monacoEditor'), {
      theme: 'myide-dark',
      language: 'plaintext',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontLigatures: true,
      lineHeight: 22,
      letterSpacing: 0.3,
      minimap: { enabled: true, scale: 1 },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      smoothScrolling: true,
      padding: { top: 16 },
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'off',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      suggest: { showStatusBar: true },
    });

    // Mark file as unsaved on change
    editor.onDidChangeModelContent(() => {
      if (activeTabPath) markTabUnsaved(activeTabPath);
    });

    // Save on Cmd+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrentFile);
  });
}

function getLanguage(ext) {
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', html: 'html', css: 'css', scss: 'scss',
    json: 'json', md: 'markdown', sh: 'shell', bash: 'shell',
    yaml: 'yaml', yml: 'yaml', xml: 'xml', sql: 'sql',
    rs: 'rust', go: 'go', rb: 'ruby', php: 'php', java: 'java',
    c: 'c', cpp: 'cpp', cs: 'csharp', swift: 'swift', kt: 'kotlin',
    vue: 'html', svelte: 'html', env: 'plaintext', gitignore: 'plaintext',
  };
  return map[ext] || 'plaintext';
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function openFileInEditor(filePath) {
  fetch(`${API}/api/file?path=${encodeURIComponent(filePath)}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) { notify(data.error, 'error'); return; }

      const name = filePath.split('/').pop();
      const ext = name.includes('.') ? name.split('.').pop() : '';

      // Add tab if not already open
      if (!openTabs.find(t => t.path === filePath)) {
        openTabs.push({ path: filePath, name, unsaved: false });
      }

      // Switch to this tab
      setActiveTab(filePath);

      // Set editor content
      const model = monaco.editor.createModel(data.content, getLanguage(ext));
      editor.setModel(model);

      // Update filepath in topbar
      document.getElementById('currentFilePath').textContent = filePath;

      // Highlight in tree
      document.querySelectorAll('.tree-item').forEach(el => {
        el.classList.toggle('active', el.dataset.path === filePath);
      });

      renderTabs();
    });
}

function setActiveTab(filePath) {
  activeTabPath = filePath;
  renderTabs();
}

function renderTabs() {
  const bar = document.getElementById('tabBar');
  if (openTabs.length === 0) {
    bar.innerHTML = '<div class="no-tabs">Open a file to start editing</div>';
    return;
  }

  bar.innerHTML = openTabs.map(tab => `
    <div class="tab ${tab.path === activeTabPath ? 'active' : ''} ${tab.unsaved ? 'unsaved' : ''}" 
         data-path="${tab.path}" onclick="switchTab('${tab.path}')">
      <span>${tab.name}</span>
      <span class="tab-close" onclick="closeTab(event, '${tab.path}')">×</span>
    </div>
  `).join('');
}

window.switchTab = function(filePath) {
  openFileInEditor(filePath);
};

window.closeTab = function(e, filePath) {
  e.stopPropagation();
  openTabs = openTabs.filter(t => t.path !== filePath);
  if (activeTabPath === filePath) {
    activeTabPath = openTabs[openTabs.length - 1]?.path || null;
    if (activeTabPath) openFileInEditor(activeTabPath);
    else {
      editor?.setModel(monaco.editor.createModel('', 'plaintext'));
      document.getElementById('currentFilePath').textContent = 'No file open';
    }
  }
  renderTabs();
};

function markTabUnsaved(filePath) {
  const tab = openTabs.find(t => t.path === filePath);
  if (tab && !tab.unsaved) {
    tab.unsaved = true;
    renderTabs();
  }
}

function markTabSaved(filePath) {
  const tab = openTabs.find(t => t.path === filePath);
  if (tab) {
    tab.unsaved = false;
    renderTabs();
  }
}

// ─── SAVE ─────────────────────────────────────────────────────────────────────
function saveCurrentFile() {
  if (!activeTabPath || !editor) return;
  const content = editor.getValue();
  fetch(`${API}/api/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: activeTabPath, content })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      markTabSaved(activeTabPath);
      notify('Saved ✓', 'success');
    }
  });
}

// ─── FILE TREE ────────────────────────────────────────────────────────────────
let fileTree = [];

function loadWorkspace(dirPath) {
  const url = dirPath ? `${API}/api/files?path=${encodeURIComponent(dirPath)}` : `${API}/api/files`;
  fetch(url).then(r => r.json()).then(data => {
    fileTree = data.tree;
    document.getElementById('workspaceLabel').textContent = data.path;
    renderFileTree(data.tree, document.getElementById('fileTree'), 0);
  });
}

function renderFileTree(items, container, depth) {
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state">Empty folder</div>';
    return;
  }

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.dataset.path = item.path;
    el.style.paddingLeft = `${depth * 12 + 8}px`;

    const icon = item.type === 'directory' ? '📁' : getFileIcon(item.ext);
    el.innerHTML = `<span class="icon">${icon}</span><span class="name">${item.name}</span>`;

    if (item.type === 'directory') {
      let expanded = false;
      let childContainer = null;
      el.onclick = () => {
        expanded = !expanded;
        el.querySelector('.icon').textContent = expanded ? '📂' : '📁';
        if (expanded) {
          childContainer = document.createElement('div');
          renderFileTree(item.children || [], childContainer, depth + 1);
          el.insertAdjacentElement('afterend', childContainer);
        } else {
          childContainer?.remove();
          childContainer = null;
        }
      };
    } else {
      el.onclick = () => openFileInEditor(item.path);
    }

    container.appendChild(el);
  });
}

function getFileIcon(ext) {
  const icons = {
    js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️',
    py: '🐍', html: '🌐', css: '🎨', scss: '🎨',
    json: '📋', md: '📝', sh: '💻', yaml: '⚙️', yml: '⚙️',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🎭',
    pdf: '📄', zip: '📦', env: '🔐', gitignore: '🚫',
    rs: '🦀', go: '🐹', rb: '💎', php: '🐘',
  };
  return icons[ext] || '📄';
}

// ─── WEBSOCKET + TERMINAL ─────────────────────────────────────────────────────
function initWebSocket() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => {
    document.getElementById('statusDot').className = 'status-dot';
    // Start file watcher
    ws.send(JSON.stringify({ type: 'watch:start' }));
    // Init terminal
    initTerminal();
  };
  ws.onclose = () => {
    document.getElementById('statusDot').className = 'status-dot error';
  };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'terminal:data' && terminal) {
      terminal.write(msg.data);
    }
    if (msg.type === 'watch:change') {
      // Refresh file tree on changes
      loadWorkspace();
    }
  };
}

function initTerminal() {
  if (typeof Terminal === 'undefined') return;

  terminal = new Terminal({
    theme: {
      background: '#0d0e11',
      foreground: '#e8eaf0',
      cursor: '#7c6ff7',
      selection: '#252a38',
      black: '#21252e',
      brightBlack: '#4a5068',
      red: '#e85a5a',
      green: '#4fa87c',
      yellow: '#e8c35a',
      blue: '#7c6ff7',
      magenta: '#c47cf7',
      cyan: '#5ac4e8',
      white: '#e8eaf0',
    },
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'bar',
  });

  terminal.open(document.getElementById('terminalContainer'));

  ws.send(JSON.stringify({ type: 'terminal:start', cols: terminal.cols, rows: terminal.rows }));

  terminal.onData(data => {
    ws.send(JSON.stringify({ type: 'terminal:input', data }));
  });

  new ResizeObserver(() => {
    terminal.fit && terminal.fit();
  }).observe(document.getElementById('terminalContainer'));
}

// ─── AI CHAT ──────────────────────────────────────────────────────────────────
function initChatInput() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('btnSend');

  const send = () => {
    if (isAISending) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    sendMessage(text);
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
}

async function sendMessage(text) {
  isAISending = true;
  document.getElementById('btnSend').disabled = true;

  // Add user message
  chatHistory.push({ role: 'user', content: text });
  appendMessage('user', text);

  // Get file context if checked
  let fileContext = null;
  if (document.getElementById('chkSendFile').checked && activeTabPath && editor) {
    fileContext = `// File: ${activeTabPath}\n${editor.getValue()}`;
    if (fileContext.length > 12000) fileContext = fileContext.slice(0, 12000) + '\n... (truncated)';
  }

  // Show typing indicator
  const typingEl = appendTyping();

  try {
    const flags = typeof featuresGetFlags === 'function' ? featuresGetFlags() : {};

    const response = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory,
        model: activeModel,
        fileContext,
        useRag: flags.useRag || false,
        useResearch: flags.useResearch || false,
      })
    });

    typingEl.remove();

    let fullText = '';
    const msgEl = appendMessage('assistant', '');
    const contentEl = msgEl.querySelector('.message-content');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }

        if (data.type === 'text' || data.text) {
          const txt = data.text || data.text;
          fullText += txt;
          contentEl.innerHTML = renderMarkdown(fullText);
          addCodeActions(contentEl);
          scrollChatToBottom();
        }
        if (data.type === 'status' && typeof featuresShowStatus === 'function') {
          featuresShowStatus(data.message);
        }
        if (data.type === 'rag' && typeof featuresShowRag === 'function') {
          featuresShowRag(data.files);
        }
        if (data.type === 'error' || data.error) {
          contentEl.innerHTML = `<span style="color:#e85a5a">Error: ${data.error}</span>`;
        }
      }
    }
    if (typeof featuresShowStatus === 'function') featuresShowStatus('');

    chatHistory.push({ role: 'assistant', content: fullText });

  } catch (e) {
    typingEl.remove();
    appendMessage('assistant', `Error: ${e.message}`);
  }

  isAISending = false;
  document.getElementById('btnSend').disabled = false;
  document.getElementById('chatInput').focus();
}

function appendMessage(role, text) {
  const msgs = document.getElementById('chatMessages');
  const label = role === 'user' ? 'YOU' : activeModel === 'claude' ? '◆ CLAUDE' : '⬡ GPT-4O';
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `
    <div class="message-role">${label}</div>
    <div class="message-content">${role === 'user' ? escapeHtml(text) : renderMarkdown(text)}</div>
  `;
  msgs.appendChild(div);
  scrollChatToBottom();
  return div;
}

function appendTyping() {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `
    <div class="message-role">${activeModel === 'claude' ? '◆ CLAUDE' : '⬡ GPT-4O'}</div>
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  msgs.appendChild(div);
  scrollChatToBottom();
  return div;
}

function scrollChatToBottom() {
  const msgs = document.getElementById('chatMessages');
  msgs.scrollTop = msgs.scrollHeight;
}

function addCodeActions(contentEl) {
  contentEl.querySelectorAll('pre:not([data-actions])').forEach(pre => {
    pre.dataset.actions = '1';
    const code = pre.querySelector('code');
    if (!code) return;

    const actions = document.createElement('div');
    actions.className = 'code-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-action-btn';
    copyBtn.textContent = '📋 Copy';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(code.textContent);
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => copyBtn.textContent = '📋 Copy', 1500);
    };

    const insertBtn = document.createElement('button');
    insertBtn.className = 'code-action-btn';
    insertBtn.textContent = '⬇ Insert into editor';
    insertBtn.onclick = () => {
      if (editor) {
        const selection = editor.getSelection();
        editor.executeEdits('ai-insert', [{
          range: selection,
          text: code.textContent
        }]);
        notify('Code inserted!', 'success');
      }
    };

    const newFileBtn = document.createElement('button');
    newFileBtn.className = 'code-action-btn';
    newFileBtn.textContent = '📄 New file';
    newFileBtn.onclick = () => createNewFileWithContent(code.textContent);

    actions.append(copyBtn, insertBtn, newFileBtn);
    pre.insertAdjacentElement('afterend', actions);
  });
}

// ─── MARKDOWN RENDERER ───────────────────────────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="language-${lang || ''}">${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hup]|<li|<pre)(.+)$/gm, '$1')
    .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── MODEL SWITCHER ───────────────────────────────────────────────────────────
function initModelSwitcher() {
  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeModel = btn.dataset.model;
      document.getElementById('activeModelLabel').textContent =
        activeModel === 'claude' ? '◆ Claude' : '⬡ GPT-4o';
    });
  });
}

// ─── TOOLBAR BUTTONS ──────────────────────────────────────────────────────────
function initToolbarButtons() {
  document.getElementById('btnSave').addEventListener('click', saveCurrentFile);
  document.getElementById('btnRefreshTree').addEventListener('click', () => loadWorkspace());
  document.getElementById('btnClearChat').addEventListener('click', () => {
    chatHistory = [];
    document.getElementById('chatMessages').innerHTML = '';
  });

  document.getElementById('btnToggleTerminal').addEventListener('click', () => {
    document.getElementById('terminalPanel').classList.toggle('collapsed');
  });

  document.getElementById('btnNewTerminal').addEventListener('click', () => {
    if (ws) ws.send(JSON.stringify({ type: 'terminal:start', cols: 80, rows: 24 }));
  });

  // Open folder
  document.getElementById('btnOpenFolder').addEventListener('click', () => {
    openModal('Open Folder', '~/projects', (val) => {
      fetch(`${API}/api/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: val })
      }).then(r => r.json()).then(d => {
        if (d.ok) loadWorkspace(d.path);
        else notify(d.error, 'error');
      });
    });
  });

  // New file
  document.getElementById('btnNewFile').addEventListener('click', () => {
    openModal('New File', 'path/to/newfile.js', (val) => {
      fetch(`${API}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: val, content: '' })
      }).then(() => {
        loadWorkspace();
        openFileInEditor(val);
      });
    });
  });
}

function createNewFileWithContent(content) {
  openModal('Save as new file', 'path/to/filename.js', (val) => {
    fetch(`${API}/api/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: val, content })
    }).then(() => {
      loadWorkspace();
      openFileInEditor(val);
      notify('File created!', 'success');
    });
  });
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
let modalCallback = null;
function openModal(title, placeholder, callback) {
  modalCallback = callback;
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalInput').placeholder = placeholder;
  document.getElementById('modalInput').value = '';
  document.getElementById('modalOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('modalInput').focus(), 50);
}

document.getElementById('modalCancel').addEventListener('click', () => {
  document.getElementById('modalOverlay').style.display = 'none';
});

document.getElementById('modalConfirm').addEventListener('click', () => {
  const val = document.getElementById('modalInput').value.trim();
  if (val && modalCallback) modalCallback(val);
  document.getElementById('modalOverlay').style.display = 'none';
});

document.getElementById('modalInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('modalConfirm').click();
  if (e.key === 'Escape') document.getElementById('modalCancel').click();
});

document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalOverlay'))
    document.getElementById('modalCancel').click();
});

// ─── RESIZE HANDLES ───────────────────────────────────────────────────────────
function initResizeHandles() {
  // Sidebar resize
  setupResize('sidebarResize', 'sidebar', 'width', 140, 500);
  // Chat panel resize
  setupResize('chatResize', 'chatPanel', 'width', 240, 600, true);
}

function setupResize(handleId, targetId, prop, min, max, reverse = false) {
  const handle = document.getElementById(handleId);
  const target = document.getElementById(targetId);
  let startX, startSize;

  handle.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startSize = parseInt(getComputedStyle(target)[prop]);
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (e) => {
      const delta = reverse ? startX - e.clientX : e.clientX - startX;
      const newSize = Math.min(max, Math.max(min, startSize + delta));
      target.style[prop] = newSize + 'px';
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
function notify(msg, type = '') {
  const el = document.getElementById('notification');
  el.textContent = msg;
  el.className = `notification show ${type}`;
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ─── INITIAL WORKSPACE LOAD ───────────────────────────────────────────────────
function loadWorkspace(path) {
  const url = path ? `${API}/api/files?path=${encodeURIComponent(path)}` : `${API}/api/files`;
  fetch(url).then(r => r.json()).then(data => {
    document.getElementById('workspaceLabel').textContent = data.path.replace(
      /^\/Users\/[^/]+/, '~'
    );
    renderFileTree(data.tree, document.getElementById('fileTree'), 0);
  });
}
