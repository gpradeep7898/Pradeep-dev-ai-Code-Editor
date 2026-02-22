require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const chokidar = require('chokidar');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const rag = require('./modules/rag');
const memory = require('./modules/memory');
const agents = require('./modules/agents');
const research = require('./modules/research');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

rag.init(openai);
memory.init(anthropic);

let currentWorkspace = process.env.DEFAULT_WORKSPACE
  ? process.env.DEFAULT_WORKSPACE.replace('~', os.homedir())
  : os.homedir();

function buildFileTree(dirPath, depth = 0) {
  if (depth > 5) return [];
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    return items
      .filter(item => !item.name.startsWith('.') && item.name !== 'node_modules' && item.name !== '__pycache__')
      .map(item => {
        const fullPath = path.join(dirPath, item.name);
        const isDir = item.isDirectory();
        return { name: item.name, path: fullPath, type: isDir ? 'directory' : 'file', ext: isDir ? null : path.extname(item.name).slice(1), children: isDir ? buildFileTree(fullPath, depth + 1) : null };
      })
      .sort((a, b) => { if (a.type !== b.type) return a.type === 'directory' ? -1 : 1; return a.name.localeCompare(b.name); });
  } catch { return []; }
}

app.get('/api/files', (req, res) => { const dirPath = req.query.path || currentWorkspace; res.json({ path: dirPath, tree: buildFileTree(dirPath) }); });
app.get('/api/file', (req, res) => { try { res.json({ content: fs.readFileSync(req.query.path, 'utf8') }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/file', (req, res) => { try { const { path: fp, content } = req.body; fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, content, 'utf8'); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.delete('/api/file', (req, res) => { try { const fp = req.query.path; const s = fs.statSync(fp); if (s.isDirectory()) fs.rmSync(fp, { recursive: true }); else fs.unlinkSync(fp); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/workspace', (req, res) => { const expanded = req.body.path.replace('~', os.homedir()); if (fs.existsSync(expanded)) { currentWorkspace = expanded; res.json({ ok: true, path: currentWorkspace }); } else { res.status(400).json({ error: 'Path does not exist' }); } });
app.get('/api/workspace', (req, res) => res.json({ path: currentWorkspace }));
app.post('/api/run', (req, res) => { exec(req.body.command, { cwd: req.body.cwd || currentWorkspace, timeout: 30000 }, (err, stdout, stderr) => res.json({ stdout, stderr, error: err?.message })); });

// ─── Standard AI Chat with all features ──────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, model, fileContext, useRag, useResearch } = req.body;
  const lastUserMessage = messages[messages.length - 1]?.content || '';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    let ragContext = '';
    if (useRag && rag.getStatus().indexed) {
      send({ type: 'status', message: '🔍 Searching your codebase...' });
      const results = await rag.search(lastUserMessage, 5);
      ragContext = rag.formatContext(results);
      if (results.length > 0) send({ type: 'rag', files: results.map(r => ({ path: r.chunk.filePath, score: r.score })) });
    }

    let webContext = '';
    if (useResearch && research.shouldResearch(lastUserMessage)) {
      send({ type: 'status', message: '🌐 Researching the web...' });
      const results = await research.research(lastUserMessage, (p) => send({ type: 'status', message: p.message }));
      webContext = research.formatResearchContext(results);
      if (webContext) send({ type: 'research', found: true });
    }

    const memoryContext = memory.getMemoryContext();

    const systemPrompt = [
      'You are an expert AI coding assistant built into MyIDE. You help write, debug, refactor, and understand code.',
      memoryContext,
      ragContext,
      webContext,
      fileContext ? `## Currently open file:\n\`\`\`\n${fileContext}\n\`\`\`` : '',
      'When writing code: use proper markdown fences with language tags. For new files, start with FILE: path/to/file.ext'
    ].filter(Boolean).join('\n\n');

    send({ type: 'status', message: '' });
    let fullResponse = '';

    if (model === 'claude') {
      const stream = anthropic.messages.stream({ model: 'claude-opus-4-6', max_tokens: 4096, system: systemPrompt, messages: messages.map(m => ({ role: m.role, content: m.content })) });
      stream.on('text', (text) => { fullResponse += text; send({ type: 'text', text }); });
      await stream.finalMessage();
    } else {
      const stream = await openai.chat.completions.create({ model: 'gpt-4o', stream: true, messages: [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))] });
      for await (const chunk of stream) { const text = chunk.choices[0]?.delta?.content || ''; if (text) { fullResponse += text; send({ type: 'text', text }); } }
    }

    send({ type: 'done' });
    res.end();
    memory.extractMemories(lastUserMessage, fullResponse).catch(() => {});
  } catch (e) { send({ type: 'error', error: e.message }); res.end(); }
});

// ─── Multi-Agent Team ─────────────────────────────────────────────────────────
app.post('/api/agents/run', async (req, res) => {
  const { userRequest, model, fileContext } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const memoryContext = memory.getMemoryContext();
    let ragContext = '';
    if (rag.getStatus().indexed) {
      send({ type: 'status', message: '🔍 Searching codebase for context...' });
      const results = await rag.search(userRequest, 4);
      ragContext = rag.formatContext(results);
    }
    await agents.runTeam({ anthropicClient: anthropic, openaiClient: openai, model: model || 'claude', userRequest, fileContext, ragContext, memoryContext, onEvent: send });
    memory.extractMemories(userRequest, '').catch(() => {});
  } catch (e) { send({ type: 'error', error: e.message }); res.end(); }
});

// ─── RAG API ──────────────────────────────────────────────────────────────────
app.post('/api/rag/index', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  await rag.indexWorkspace(req.body.workspace || currentWorkspace, (p) => res.write(`data: ${JSON.stringify(p)}\n\n`));
  res.write(`data: ${JSON.stringify({ status: 'complete' })}\n\n`);
  res.end();
});
app.get('/api/rag/status', (req, res) => res.json(rag.getStatus()));
app.post('/api/rag/search', async (req, res) => { const results = await rag.search(req.body.query, req.body.topK || 5); res.json({ results: results.map(r => ({ ...r.chunk, score: r.score })) }); });

// ─── Memory API ───────────────────────────────────────────────────────────────
app.get('/api/memory', (req, res) => res.json({ memories: memory.getAll() }));
app.post('/api/memory', (req, res) => res.json(memory.addManual(req.body.fact)));
app.delete('/api/memory/:index', (req, res) => res.json(memory.deleteMemory(parseInt(req.params.index))));
app.delete('/api/memory', (req, res) => res.json(memory.clearAll()));

// ─── WebSocket Terminal ───────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let ptyProcess = null;
  let watcher = null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'terminal:start') {
      try {
        const pty = require('node-pty');
        ptyProcess = pty.spawn(process.env.SHELL || '/bin/zsh', [], { name: 'xterm-256color', cols: msg.cols || 80, rows: msg.rows || 24, cwd: currentWorkspace, env: process.env });
        ptyProcess.onData((data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'terminal:data', data })); });
        ptyProcess.onExit(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'terminal:exit' })); });
      } catch (e) { ws.send(JSON.stringify({ type: 'terminal:error', error: 'node-pty not available' })); }
    }
    if (msg.type === 'terminal:input' && ptyProcess) ptyProcess.write(msg.data);
    if (msg.type === 'terminal:resize' && ptyProcess) ptyProcess.resize(msg.cols, msg.rows);
    if (msg.type === 'watch:start') {
      watcher = chokidar.watch(msg.path || currentWorkspace, { ignored: /(node_modules|\.git|__pycache__)/, persistent: true, depth: 5 });
      const notify = (ev, fp) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'watch:change', event: ev, path: fp })); };
      watcher.on('add', p => notify('add', p)); watcher.on('unlink', p => notify('unlink', p));
      watcher.on('addDir', p => notify('addDir', p)); watcher.on('unlinkDir', p => notify('unlinkDir', p));
    }
  });
  ws.on('close', () => { if (ptyProcess) ptyProcess.kill(); if (watcher) watcher.close(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✦ MyIDE v2 running at http://localhost:${PORT}`);
  console.log(`📁 Workspace: ${currentWorkspace}`);
  console.log(`🧠 Memory: ${memory.getAll().length} memories loaded`);
  console.log(`📚 RAG: ${rag.getStatus().indexed ? rag.getStatus().chunks + ' chunks indexed' : 'not indexed yet'}`);
  console.log(`\nPress Ctrl+C to stop.\n`);
});
