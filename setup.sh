#!/bin/bash
set -e

echo ""
echo "✦ MyIDE v3 — Setup"
echo "══════════════════════════════════════════"

# Node check
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org (v18+)"
  exit 1
fi
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v)"
  exit 1
fi
echo "✓ Node.js $(node -v)"

# Install deps
echo ""
echo "→ Installing npm dependencies (node-pty will compile ~30s)..."
npm install
echo "✓ Dependencies installed"

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ Created .env"
else
  echo "✓ .env exists"
fi

# Ollama
echo ""
echo "→ Checking Ollama..."
if ! command -v ollama &>/dev/null; then
  if [[ "$OSTYPE" == "darwin"* ]] && command -v brew &>/dev/null; then
    brew install ollama
  else
    echo "  Install Ollama from https://ollama.com then run: ollama pull qwen2.5-coder:7b"
  fi
else
  echo "✓ Ollama found"
fi

if command -v ollama &>/dev/null; then
  if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
    echo "→ Starting Ollama..."
    ollama serve &>/dev/null & sleep 3
  fi
  MODEL="${OLLAMA_MODEL:-qwen2.5-coder:7b}"
  if ollama list 2>/dev/null | grep -q "qwen2.5-coder"; then
    echo "✓ Model already pulled"
  else
    echo "→ Pulling $MODEL (~4.7GB)..."
    ollama pull "$MODEL"
    echo "✓ Model ready"
  fi
fi

echo ""
echo "══════════════════════════════════════════"
echo "✦ Setup complete!"
echo ""
echo "  Browser mode:  npm start → http://localhost:3000"
echo "  Electron mode: npm run electron"
echo "  Build .app:    npm run build"
echo "══════════════════════════════════════════"
echo ""
