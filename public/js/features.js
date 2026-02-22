// ─── MyIDE v2 Features — RAG, Memory, Agents, Research ───────────────────────
// This file handles all the UI for the 4 new features.
// It's loaded after app.js and hooks into the existing chat/editor system.

// ─── STATE ────────────────────────────────────────────────────────────────────
let useRag = false;
let useResearch = false;
let agentMode = false;
let ragStatus = { indexed: false, chunks: 0 };

// ─── FEATURE BAR INIT ─────────────────────────────────────────────────────────
function initFeatures() {
  renderFeatureBar();
  loadRagStatus();
  loadMemories();
  renderAgentPanel();
}

// ─── FEATURE TOOLBAR ──────────────────────────────────────────────────────────
function renderFeatureBar() {
  const bar = document.getElementById('featureBar');
  if (!bar) return;
  bar.innerHTML = `
    <button class="feat-btn ${useRag ? 'active' : ''}" id="btnToggleRag" title="Search your whole codebase with AI">
      <span class="feat-icon">📚</span> Codebase RAG
      <span class="feat-badge" id="ragBadge">${ragStatus.indexed ? ragStatus.chunks + ' chunks' : 'not indexed'}</span>
    </button>
    <button class="feat-btn ${useResearch ? 'active' : ''}" id="btnToggleResearch" title="AI will search the web for relevant info">
      <span class="feat-icon">🌐</span> Web Research
    </button>
    <button class="feat-btn ${agentMode ? 'active agent-active' : ''}" id="btnToggleAgents" title="Use Planner + Coder + Reviewer pipeline">
      <span class="feat-icon">🤖</span> Agent Team
    </button>
    <button class="feat-btn" id="btnIndexWorkspace" title="Index your codebase for RAG">
      <span class="feat-icon">⚡</span> Index
    </button>
    <button class="feat-btn" id="btnOpenMemory" title="View and manage AI memories">
      <span class="feat-icon">🧠</span> Memory
    </button>
  `;

  document.getElementById('btnToggleRag').onclick = () => {
    useRag = !useRag;
    renderFeatureBar();
    notify(useRag ? '📚 RAG enabled — AI will search your codebase' : 'RAG off', useRag ? 'success' : '');
  };

  document.getElementById('btnToggleResearch').onclick = () => {
    useResearch = !useResearch;
    renderFeatureBar();
    notify(useResearch ? '🌐 Web research enabled' : 'Web research off', useResearch ? 'success' : '');
  };

  document.getElementById('btnToggleAgents').onclick = () => {
    agentMode = !agentMode;
    renderFeatureBar();
    document.getElementById('agentPanel')?.classList.toggle('hidden', !agentMode);
    document.getElementById('chatPanel')?.classList.toggle('hidden', agentMode);
    notify(agentMode ? '🤖 Agent Team mode on — Planner + Coder + Reviewer' : 'Back to standard chat', agentMode ? 'success' : '');
  };

  document.getElementById('btnIndexWorkspace').onclick = startIndexing;
  document.getElementById('btnOpenMemory').onclick = () => openPanel('memory');
}

// ─── RAG INDEXING ─────────────────────────────────────────────────────────────
async function loadRagStatus() {
  try {
    const r = await fetch('/api/rag/status');
    ragStatus = await r.json();
    renderFeatureBar();
  } catch {}
}

function startIndexing() {
  openPanel('indexing');
  const logEl = document.getElementById('indexLog');
  if (logEl) logEl.innerHTML = '';

  const progressEl = document.getElementById('indexProgress');
  const statusEl = document.getElementById('indexStatus');

  fetch('/api/rag/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    .then(res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) {
            loadRagStatus();
            if (statusEl) statusEl.textContent = '✓ Indexing complete!';
            return;
          }
          const lines = decoder.decode(value).split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));
            if (logEl) {
              const entry = document.createElement('div');
              entry.textContent = data.message || data.status;
              entry.className = 'index-log-entry';
              logEl.appendChild(entry);
              logEl.scrollTop = logEl.scrollHeight;
            }
            if (progressEl && data.total && data.done) {
              const pct = Math.round((data.done / data.total) * 100);
              progressEl.style.width = pct + '%';
              progressEl.textContent = pct + '%';
            }
            if (data.status === 'complete' && statusEl) {
              statusEl.textContent = '✓ Done!';
              loadRagStatus();
            }
          }
          read();
        });
      }
      read();
    })
    .catch(e => { if (statusEl) statusEl.textContent = 'Error: ' + e.message; });
}

// ─── MEMORY PANEL ─────────────────────────────────────────────────────────────
let memories = [];

async function loadMemories() {
  try {
    const r = await fetch('/api/memory');
    const data = await r.json();
    memories = data.memories || [];
  } catch {}
}

function renderMemoryPanel() {
  const panel = document.getElementById('memoryContent');
  if (!panel) return;

  if (memories.length === 0) {
    panel.innerHTML = `<div class="panel-empty">No memories yet. The AI will learn your preferences as you chat.</div>`;
    return;
  }

  panel.innerHTML = `
    <div class="memory-list">
      ${memories.map((m, i) => `
        <div class="memory-item">
          <span class="memory-fact">${escapeHtml(m.fact)}</span>
          <div class="memory-meta">
            <span>Used ${m.useCount}× · ${new Date(m.addedAt).toLocaleDateString()}</span>
            <button class="icon-btn memory-delete" data-index="${i}" title="Delete">✕</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="memory-actions">
      <input id="newMemoryInput" class="modal-input" placeholder="Add a memory manually..." style="flex:1">
      <button class="btn-primary" id="btnAddMemory">Add</button>
      <button class="btn-ghost" id="btnClearMemory" style="color:#e85a5a">Clear All</button>
    </div>
  `;

  panel.querySelectorAll('.memory-delete').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`/api/memory/${btn.dataset.index}`, { method: 'DELETE' });
      await loadMemories();
      renderMemoryPanel();
    };
  });

  document.getElementById('btnAddMemory').onclick = async () => {
    const val = document.getElementById('newMemoryInput').value.trim();
    if (!val) return;
    await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fact: val }) });
    await loadMemories();
    renderMemoryPanel();
    notify('Memory added!', 'success');
  };

  document.getElementById('btnClearMemory').onclick = async () => {
    if (!confirm('Clear ALL memories? This cannot be undone.')) return;
    await fetch('/api/memory', { method: 'DELETE' });
    memories = [];
    renderMemoryPanel();
    notify('All memories cleared');
  };
}

// ─── AGENT PANEL ─────────────────────────────────────────────────────────────
function renderAgentPanel() {
  const panel = document.getElementById('agentPanel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="agent-header">
      <div class="agent-title-row">
        <span class="chat-title">🤖 AGENT TEAM</span>
        <span class="agent-subtitle">Planner → Coder → Reviewer</span>
      </div>
    </div>
    <div class="agent-info">
      <div class="agent-card" data-agent="planner">
        <span class="agent-badge">🗺️</span>
        <div><strong>Planner</strong><br><small>Analyzes & plans</small></div>
        <div class="agent-status-dot idle"></div>
      </div>
      <div class="agent-arrow">→</div>
      <div class="agent-card" data-agent="coder">
        <span class="agent-badge">💻</span>
        <div><strong>Coder</strong><br><small>Writes the code</small></div>
        <div class="agent-status-dot idle"></div>
      </div>
      <div class="agent-arrow">→</div>
      <div class="agent-card" data-agent="reviewer">
        <span class="agent-badge">🔍</span>
        <div><strong>Reviewer</strong><br><small>Reviews & fixes</small></div>
        <div class="agent-status-dot idle"></div>
      </div>
    </div>
    <div class="agent-output" id="agentOutput">
      <div class="panel-empty">Describe what you want to build and the agent team will plan, code, and review it.</div>
    </div>
    <div class="chat-input-area">
      <div class="chat-input-wrapper">
        <textarea id="agentInput" placeholder="e.g. Add user authentication with JWT to the Express server..." rows="2"></textarea>
        <button id="btnRunAgents" class="send-btn" style="background:var(--accent-claude)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21L23 12 2 3v7l15 2-15 2v7z"/></svg>
        </button>
      </div>
      <div class="chat-hints"><span>Agent team uses 3× more API tokens than standard chat</span></div>
    </div>
  `;

  document.getElementById('btnRunAgents').onclick = runAgentTeam;
  document.getElementById('agentInput').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runAgentTeam(); }
  });
}

async function runAgentTeam() {
  const input = document.getElementById('agentInput');
  const request = input.value.trim();
  if (!request) return;

  input.value = '';
  const output = document.getElementById('agentOutput');
  output.innerHTML = '';

  // Reset agent status dots
  document.querySelectorAll('.agent-status-dot').forEach(d => { d.className = 'agent-status-dot idle'; });

  const fileContext = (typeof activeTabPath !== 'undefined' && activeTabPath && typeof editor !== 'undefined' && editor)
    ? `// File: ${activeTabPath}\n${editor.getValue().slice(0, 8000)}`
    : '';

  let currentAgent = null;
  let currentEl = null;
  let currentContentEl = null;

  const agentColors = { planner: '#7c6ff7', coder: '#4fa87c', reviewer: '#e87c5a' };

  fetch('/api/agents/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: request, model: typeof activeModel !== 'undefined' ? activeModel : 'claude', fileContext })
  }).then(res => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) return;

        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          if (data.type === 'agent:start') {
            currentAgent = data.agent;

            // Activate status dot
            const dot = document.querySelector(`.agent-card[data-agent="${data.agent}"] .agent-status-dot`);
            if (dot) dot.className = 'agent-status-dot active';

            // Create agent section
            currentEl = document.createElement('div');
            currentEl.className = 'agent-section';
            currentEl.innerHTML = `
              <div class="agent-section-header" style="color:${agentColors[data.agent] || '#fff'}">
                ${data.label} <span class="agent-thinking">thinking...</span>
              </div>
              <div class="agent-section-content"></div>
            `;
            output.appendChild(currentEl);
            currentContentEl = currentEl.querySelector('.agent-section-content');
            output.scrollTop = output.scrollHeight;
          }

          if (data.type === 'agent:chunk' && currentContentEl) {
            currentContentEl.innerHTML = renderMarkdown(
              currentContentEl.dataset.raw = (currentContentEl.dataset.raw || '') + data.text
            );
            // Remove "thinking..." label once content starts
            const thinkingEl = currentEl?.querySelector('.agent-thinking');
            if (thinkingEl) thinkingEl.remove();
            addCodeActionsToEl(currentContentEl);
            output.scrollTop = output.scrollHeight;
          }

          if (data.type === 'agent:done') {
            const dot = document.querySelector(`.agent-card[data-agent="${currentAgent}"] .agent-status-dot`);
            if (dot) dot.className = 'agent-status-dot done';
          }

          if (data.type === 'team:done') {
            document.querySelectorAll('.agent-status-dot').forEach(d => { d.className = 'agent-status-dot idle'; });
            notify('✓ Agent team done!', 'success');
          }

          if (data.type === 'error') {
            output.innerHTML += `<div style="color:#e85a5a;padding:10px">Error: ${data.error}</div>`;
          }
        }

        read();
      });
    }
    read();
  });
}

// ─── PANEL SYSTEM ─────────────────────────────────────────────────────────────
function openPanel(panelName) {
  const overlay = document.getElementById('panelOverlay');
  const content = document.getElementById('panelContent');
  overlay.style.display = 'flex';

  if (panelName === 'memory') {
    loadMemories().then(() => {
      content.innerHTML = `
        <div class="panel-header">
          <span class="panel-title">🧠 AI Memory</span>
          <button class="icon-btn" id="closePanel">✕</button>
        </div>
        <div class="panel-body" id="memoryContent"></div>
      `;
      document.getElementById('closePanel').onclick = closePanel;
      renderMemoryPanel();
    });
  }

  if (panelName === 'indexing') {
    content.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">⚡ Indexing Codebase</span>
        <button class="icon-btn" id="closePanel">✕</button>
      </div>
      <div class="panel-body">
        <div id="indexStatus" style="color:var(--accent);margin-bottom:10px">Starting...</div>
        <div class="progress-bar-wrap"><div class="progress-bar" id="indexProgress">0%</div></div>
        <div id="indexLog" class="index-log"></div>
      </div>
    `;
    document.getElementById('closePanel').onclick = closePanel;
  }
}

function closePanel() {
  document.getElementById('panelOverlay').style.display = 'none';
}

// ─── STATUS MESSAGES IN CHAT ──────────────────────────────────────────────────
function showChatStatus(message) {
  let statusEl = document.getElementById('chatStatus');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'chatStatus';
    statusEl.className = 'chat-status';
    document.getElementById('chatMessages')?.appendChild(statusEl);
  }
  statusEl.textContent = message;
  statusEl.style.display = message ? 'flex' : 'none';
}

// ─── RAG CONTEXT DISPLAY ──────────────────────────────────────────────────────
function showRagContext(files) {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const el = document.createElement('div');
  el.className = 'rag-context-pill';
  el.innerHTML = `📚 Searching ${files.length} file${files.length !== 1 ? 's' : ''}:
    ${files.slice(0, 3).map(f => `<span class="rag-file">${f.path.split('/').slice(-2).join('/')}</span>`).join(' ')}
    ${files.length > 3 ? `<span class="rag-file">+${files.length - 3} more</span>` : ''}`;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  setTimeout(() => el.remove(), 8000);
}

// ─── CODE ACTIONS HELPER ─────────────────────────────────────────────────────
function addCodeActionsToEl(contentEl) {
  if (typeof addCodeActions === 'function') addCodeActions(contentEl);
}

// ─── escapeHtml helper (if not already defined) ───────────────────────────────
if (typeof escapeHtml === 'undefined') {
  window.escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Export for app.js to use ─────────────────────────────────────────────────
window.featuresGetFlags = () => ({ useRag, useResearch });
window.featuresShowStatus = showChatStatus;
window.featuresShowRag = showRagContext;
window.featuresInit = initFeatures;
