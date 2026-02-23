require('dotenv').config();

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ noServer: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ── helpers ──────────────────────────────────────────────────────────────────
function sse(res, data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }
function sseInit(res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
}

// ── file system ───────────────────────────────────────────────────────────────
app.get('/api/files', (req, res) => {
  const dir = req.query.path || os.homedir();
  try {
    const skip = new Set(['node_modules', '__pycache__', '.git', '.DS_Store']);
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .filter(i => !i.name.startsWith('.') && !skip.has(i.name))
      .map(i => ({
        name: i.name,
        path: path.join(dir, i.name),
        isDirectory: i.isDirectory(),
        ext:  i.isDirectory() ? null : path.extname(i.name).slice(1).toLowerCase(),
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ path: dir, items });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/file', (req, res) => {
  const { path: fp } = req.query;
  if (!fp) return res.status(400).json({ error: 'path required' });
  try {
    res.json({ content: fs.readFileSync(fp, 'utf8'), path: fp });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/file', (req, res) => {
  const { path: fp, content } = req.body;
  if (!fp) return res.status(400).json({ error: 'path required' });
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/file/new', (req, res) => {
  const { path: fp } = req.body;
  if (!fp) return res.status(400).json({ error: 'path required' });
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, '', 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/file', (req, res) => {
  const { path: fp } = req.query;
  if (!fp) return res.status(400).json({ error: 'path required' });
  try {
    const stat = fs.statSync(fp);
    if (stat.isDirectory()) fs.rmSync(fp, { recursive: true });
    else fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── ollama status ─────────────────────────────────────────────────────────────
app.get('/api/ollama/status', async (req, res) => {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  try {
    const r = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const data = await r.json();
      res.json({ running: true, models: (data.models || []).map(m => m.name) });
    } else {
      res.json({ running: false, models: [] });
    }
  } catch { res.json({ running: false, models: [] }); }
});

// ── AI chat — SSE streaming ───────────────────────────────────────────────────
app.post('/api/ai/chat', async (req, res) => {
  const {
    messages,
    model       = 'ollama',
    ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
    fileContext,
    filePath,
  } = req.body;

  sseInit(res);

  const system = [
    'You are an expert AI coding assistant inside MyIDE.',
    'Write clean, idiomatic code. Always use markdown code fences with language tags.',
    fileContext
      ? `## Current file: ${filePath || 'untitled'}\n\`\`\`\n${fileContext.slice(0, 8000)}\n\`\`\``
      : '',
  ].filter(Boolean).join('\n\n');

  const full = [{ role: 'system', content: system }, ...messages];

  try {
    if      (model === 'ollama') await streamOllama(full, ollamaModel, res);
    else if (model === 'claude') await streamClaude(full, res);
    else if (model === 'gpt')    await streamGPT(full, res);
    else sse(res, { error: `Unknown model: ${model}` });
  } catch (e) { sse(res, { error: e.message }); }

  sse(res, { done: true });
  res.end();
});

async function streamOllama(messages, model, res) {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const r = await fetch(`${host}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model, messages, stream: true }),
    signal:  AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n').filter(Boolean)) {
      try {
        const j = JSON.parse(line);
        if (j.message?.content) sse(res, { token: j.message.content });
      } catch { /* skip */ }
    }
  }
}

async function streamClaude(messages, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'your_anthropic_api_key_here')
    throw new Error('ANTHROPIC_API_KEY not set in .env');
  const { default: Anthropic } = require('@anthropic-ai/sdk');
  const client  = new Anthropic({ apiKey: key });
  const sysMsg  = messages.find(m => m.role === 'system')?.content || '';
  const chat    = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
  const stream  = client.messages.stream({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    max_tokens: 4096,
    system:     sysMsg,
    messages:   chat,
  });
  stream.on('text', t => sse(res, { token: t }));
  await stream.finalMessage();
}

async function streamGPT(messages, res) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set in .env');
  const { default: OpenAI } = require('openai');
  const client = new OpenAI({ apiKey: key });
  const stream = await client.chat.completions.create({
    model:    'gpt-4o',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream:   true,
  });
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content;
    if (t) sse(res, { token: t });
  }
}

// ── WebSocket: upgrade routing ────────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, `http://${req.headers.host}`).pathname === '/terminal') {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  } else {
    socket.destroy();
  }
});

// ── WebSocket: real terminal via node-pty ─────────────────────────────────────
wss.on('connection', (ws) => {
  let pty = null;
  try {
    const nodePty = require('node-pty');
    pty = nodePty.spawn(process.env.SHELL || '/bin/zsh', [], {
      name: 'xterm-256color',
      cols: 80, rows: 24,
      cwd:  os.homedir(),
      env:  { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    pty.onData(d => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'output', data: d })));
    pty.onExit(({ exitCode }) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'exit', code: exitCode })));
  } catch (e) {
    ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({
      type: 'output',
      data: `\r\n\x1b[33m⚠ Terminal unavailable: ${e.message}\x1b[0m\r\nRun: npm install\r\n`,
    }));
  }

  ws.on('message', raw => {
    try {
      const { type, data, cols, rows } = JSON.parse(raw.toString());
      if (!pty) return;
      if (type === 'input')  pty.write(data);
      if (type === 'resize') pty.resize(Math.max(1, cols), Math.max(1, rows));
    } catch { /* ignore */ }
  });

  ws.on('close', () => { try { pty?.kill(); } catch { /* dead */ } });
});

// ── start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const hasClaude = !!(process.env.ANTHROPIC_API_KEY?.length > 10 && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here');
  const hasGPT    = !!(process.env.OPENAI_API_KEY?.length > 10);
  console.log(`\n✦ MyIDE v3  →  \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  console.log(`  AI primary : \x1b[32mOllama\x1b[0m (${process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b'})`);
  console.log(`  Claude     : ${hasClaude ? '\x1b[32m✓\x1b[0m' : '✗ (add ANTHROPIC_API_KEY to .env)'}`);
  console.log(`  GPT-4o     : ${hasGPT    ? '\x1b[32m✓\x1b[0m' : '✗ (add OPENAI_API_KEY to .env)'}`);
  console.log(`\n  Press Ctrl+C to stop.\n`);
});

module.exports = { server, PORT };
