/**
 * Memory Module — Persistent AI Memory Across Sessions
 * 
 * Inspired by mem0 pattern from awesome-llm-apps.
 * 
 * How it works:
 * 1. After each AI response, extract any learnable facts (preferences, patterns, project info)
 * 2. Store them as structured memories in a JSON file
 * 3. On each new chat, inject relevant memories as context
 * 4. Periodically consolidate/deduplicate memories so they don't bloat
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_FILE = path.join(os.homedir(), '.myide_memory.json');
const MAX_MEMORIES = 100; // cap to keep things manageable

let memories = [];
let anthropicClient = null;

function init(anthropic) {
  anthropicClient = anthropic;
  load();
}

function load() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      memories = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      console.log(`[Memory] Loaded ${memories.length} memories`);
    }
  } catch {
    memories = [];
  }
}

function save() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), 'utf8');
}

// Extract new memories from a conversation turn
async function extractMemories(userMessage, assistantResponse) {
  if (!anthropicClient) return;
  
  const prompt = `You are analyzing a coding assistant conversation to extract useful memories about the user's preferences, project details, and coding patterns.

User said: "${userMessage.slice(0, 500)}"
Assistant responded with: "${assistantResponse.slice(0, 800)}"

Extract 0-3 SHORT, specific, factual memories worth remembering for future conversations.
Focus on:
- Tech stack preferences (e.g., "prefers TypeScript over JavaScript")
- Project-specific facts (e.g., "uses Express.js backend on port 3001")
- Coding style preferences (e.g., "prefers functional components over class components")
- Patterns they keep asking about (e.g., "frequently needs help with async/await patterns")
- Things to avoid (e.g., "doesn't want to use Redux")

Return ONLY a JSON array of strings. Empty array if nothing worth remembering.
Example: ["prefers TypeScript", "main project uses PostgreSQL", "always uses Tailwind CSS"]

Return [] if the conversation doesn't reveal anything memorable.`;

  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });
    
    const text = response.content[0].text.trim();
    const extracted = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
    
    if (extracted.length > 0) {
      addMemories(extracted);
    }
  } catch (e) {
    // Silently fail — memory extraction is non-critical
  }
}

function addMemories(newFacts) {
  const now = new Date().toISOString();
  
  for (const fact of newFacts) {
    if (!fact || typeof fact !== 'string' || fact.length < 5) continue;
    
    // Check for duplicates (simple fuzzy match)
    const isDuplicate = memories.some(m => 
      m.fact.toLowerCase().includes(fact.toLowerCase().slice(0, 20)) ||
      fact.toLowerCase().includes(m.fact.toLowerCase().slice(0, 20))
    );
    
    if (!isDuplicate) {
      memories.push({ fact, addedAt: now, useCount: 0 });
    }
  }
  
  // Trim if over limit (remove oldest, least-used)
  if (memories.length > MAX_MEMORIES) {
    memories.sort((a, b) => b.useCount - a.useCount || new Date(b.addedAt) - new Date(a.addedAt));
    memories = memories.slice(0, MAX_MEMORIES);
  }
  
  save();
}

// Get all memories formatted as a system prompt addition
function getMemoryContext() {
  if (memories.length === 0) return '';
  
  // Mark all as used
  memories.forEach(m => m.useCount++);
  save();
  
  const facts = memories.map(m => `- ${m.fact}`).join('\n');
  return `## What you know about this developer:\n${facts}`;
}

// Add a manual memory
function addManual(fact) {
  addMemories([fact]);
  return { ok: true, total: memories.length };
}

// Delete a memory by index
function deleteMemory(index) {
  memories.splice(index, 1);
  save();
  return { ok: true };
}

// Clear all memories
function clearAll() {
  memories = [];
  save();
  return { ok: true };
}

function getAll() {
  return memories;
}

module.exports = { init, extractMemories, getMemoryContext, addManual, deleteMemory, clearAll, getAll };
