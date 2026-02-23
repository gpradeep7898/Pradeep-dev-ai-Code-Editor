# ✦ MyIDE v3 — Fast Local AI Code Editor

A browser-based + native Mac IDE with Ollama as primary AI (free, local, instant).

## Quick start

```bash
bash setup.sh       # install deps, pull Ollama model
npm start           # open http://localhost:3000
```

## Electron (native Mac app)

```bash
npm run electron    # dev mode — opens native window
npm run build       # build MyIDE.app + MyIDE.dmg → dist/
```

## AI Priority
1. **Ollama** (free, local) — `qwen2.5-coder:7b`
2. **Claude** — add `ANTHROPIC_API_KEY` to `.env`
3. **GPT-4o** — add `OPENAI_API_KEY` to `.env`

## Features
- Monaco Editor (VS Code engine)
- File tree — browse any folder on your Mac
- Multi-tab editor with ⌘S save
- Real terminal (node-pty + xterm.js)
- Streaming AI chat with code actions (Copy / Insert / Save)
- Model switcher in UI
- Resizable panels
- Dark theme with purple accent
