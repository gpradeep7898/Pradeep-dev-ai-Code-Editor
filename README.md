# MyIDE v2 ✦ AI-Powered Code Editor

A fully-featured, browser-based AI code editor powered by Claude (Anthropic) and OpenAI, with RAG, persistent memory, multi-agent workflows, and live research capabilities.

## Features

- **AI Chat** — Claude-powered code assistant with file context
- **RAG (Retrieval-Augmented Generation)** — Index your codebase for semantic search
- **Persistent Memory** — Remembers context across sessions
- **Multi-Agent Workflows** — Specialized agents for different tasks
- **Research Mode** — Live web research integrated into your editor
- **File Explorer** — Browse, create, edit, and delete files
- **Terminal** — Run commands directly in the browser
- **Real-time sync** — File watcher via WebSocket

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/gpradeep7898/Pradeep-dev-ai-Code-Editor.git
cd Pradeep-dev-ai-Code-Editor

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 4. Start the server
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Yes |
| `OPENAI_API_KEY` | Your OpenAI API key (for embeddings) | Yes |
| `PORT` | Server port (default: 3000) | No |
| `DEFAULT_WORKSPACE` | Default workspace path | No |

## Project Structure

```
myide/
├── server/
│   ├── index.js          # Express server + WebSocket
│   └── modules/
│       ├── rag.js        # RAG / vector search
│       ├── memory.js     # Persistent memory
│       ├── agents.js     # Multi-agent workflows
│       └── research.js   # Live research
├── public/
│   ├── index.html        # Main UI
│   ├── css/style.css     # Styles
│   └── js/
│       ├── app.js        # Core app logic
│       └── features.js   # Feature modules
├── package.json
└── .env.example
```

## License

MIT
