#!/bin/bash
set -e

echo "✦ MyIDE v2 Setup"
echo "────────────────"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Please install Node.js 18+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v)"
  exit 1
fi

echo "✓ Node.js $(node -v)"

# Install dependencies
echo "→ Installing dependencies..."
npm install

# Set up .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ Created .env from .env.example"
  echo "⚠️  Edit .env and add your API keys before starting."
else
  echo "✓ .env already exists"
fi

echo ""
echo "Done! Run 'npm start' to launch MyIDE."
echo "Then open http://localhost:3000 in your browser."
