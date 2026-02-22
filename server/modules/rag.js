/**
 * RAG Module — Codebase Indexing & Semantic Search
 * 
 * How it works:
 * 1. Walk the workspace, chunk every code file into ~60-line pieces
 * 2. Embed each chunk with OpenAI text-embedding-3-small (cheap & fast)
 * 3. Store chunks + vectors in a flat JSON file (no external DB needed)
 * 4. At query time: embed the query, cosine-similarity search, return top-k chunks
 * 5. Inject those chunks as context into the AI chat
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const INDEX_FILE = path.join(os.homedir(), '.myide_rag_index.json');
const CHUNK_SIZE = 60;   // lines per chunk
const CHUNK_OVERLAP = 10; // lines of overlap between chunks

// File extensions we'll index
const INDEXABLE_EXTS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'html', 'css', 'scss',
  'json', 'md', 'sh', 'yaml', 'yml', 'env', 'sql',
  'rs', 'go', 'rb', 'php', 'java', 'c', 'cpp', 'cs',
  'swift', 'kt', 'vue', 'svelte', 'graphql', 'prisma'
]);

// Dirs/files to skip
const SKIP_PATTERNS = [
  'node_modules', '.git', '__pycache__', '.next', 'dist',
  'build', '.cache', 'coverage', '.nyc_output', 'venv',
  '.env', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
];

let ragIndex = { workspace: '', chunks: [], embeddings: [], indexedAt: null };
let openaiClient = null;
let isIndexing = false;
let indexingProgress = { total: 0, done: 0, status: 'idle' };

function init(openai) {
  openaiClient = openai;
  loadIndex();
}

function loadIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      ragIndex = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      console.log(`[RAG] Loaded index: ${ragIndex.chunks.length} chunks from ${ragIndex.workspace}`);
    }
  } catch (e) {
    console.log('[RAG] No existing index found, starting fresh');
  }
}

function saveIndex() {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(ragIndex), 'utf8');
}

// Walk workspace and collect all indexable files
function collectFiles(dirPath, files = []) {
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      if (SKIP_PATTERNS.some(p => item.name === p || item.name.startsWith('.'))) continue;
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        collectFiles(fullPath, files);
      } else {
        const ext = path.extname(item.name).slice(1).toLowerCase();
        if (INDEXABLE_EXTS.has(ext)) {
          const stat = fs.statSync(fullPath);
          if (stat.size < 500 * 1024) { // skip files > 500KB
            files.push(fullPath);
          }
        }
      }
    }
  } catch {}
  return files;
}

// Split file content into overlapping chunks
function chunkFile(filePath, content) {
  const lines = content.split('\n');
  const chunks = [];
  
  for (let i = 0; i < lines.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
    const chunkLines = lines.slice(i, i + CHUNK_SIZE);
    const chunkText = chunkLines.join('\n');
    if (chunkText.trim().length < 20) continue; // skip nearly-empty chunks
    
    chunks.push({
      id: `${filePath}:${i}`,
      filePath,
      startLine: i + 1,
      endLine: Math.min(i + CHUNK_SIZE, lines.length),
      text: `// File: ${filePath} (lines ${i + 1}-${Math.min(i + CHUNK_SIZE, lines.length)})\n${chunkText}`,
      rawText: chunkText,
    });
    
    if (i + CHUNK_SIZE >= lines.length) break;
  }
  
  return chunks;
}

// Cosine similarity between two vectors
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

// Embed a batch of texts (OpenAI allows up to 2048 inputs per call)
async function embedBatch(texts) {
  const response = await openaiClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data.map(d => d.embedding);
}

// Main indexing function
async function indexWorkspace(workspacePath, onProgress) {
  if (isIndexing) return { error: 'Already indexing' };
  if (!openaiClient) return { error: 'OpenAI client not initialized' };
  
  isIndexing = true;
  indexingProgress = { total: 0, done: 0, status: 'scanning' };
  
  try {
    // Collect files
    onProgress?.({ status: 'scanning', message: 'Scanning workspace files...' });
    const files = collectFiles(workspacePath);
    indexingProgress.total = files.length;
    
    onProgress?.({ status: 'scanning', message: `Found ${files.length} files to index` });

    // Build chunks
    const allChunks = [];
    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        allChunks.push(...chunkFile(filePath, content));
      } catch {}
    }

    onProgress?.({ status: 'embedding', message: `Embedding ${allChunks.length} code chunks...`, total: allChunks.length, done: 0 });

    // Embed in batches of 100
    const BATCH_SIZE = 100;
    const allEmbeddings = [];
    
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => c.text.slice(0, 8000)); // truncate to token limit
      const embeddings = await embedBatch(texts);
      allEmbeddings.push(...embeddings);
      
      indexingProgress.done = Math.min(i + BATCH_SIZE, allChunks.length);
      onProgress?.({
        status: 'embedding',
        message: `Embedded ${indexingProgress.done}/${allChunks.length} chunks`,
        total: allChunks.length,
        done: indexingProgress.done
      });
    }

    // Save index
    ragIndex = {
      workspace: workspacePath,
      chunks: allChunks,
      embeddings: allEmbeddings,
      indexedAt: new Date().toISOString(),
    };
    saveIndex();

    isIndexing = false;
    indexingProgress.status = 'done';
    onProgress?.({ status: 'done', message: `✓ Indexed ${allChunks.length} chunks from ${files.length} files` });
    
    return { ok: true, chunks: allChunks.length, files: files.length };
    
  } catch (e) {
    isIndexing = false;
    indexingProgress.status = 'error';
    onProgress?.({ status: 'error', message: e.message });
    return { error: e.message };
  }
}

// Search the index — returns top-k most relevant chunks
async function search(query, topK = 5) {
  if (!openaiClient) return [];
  if (ragIndex.chunks.length === 0) return [];
  
  try {
    const [queryEmbedding] = await embedBatch([query]);
    
    const scores = ragIndex.embeddings.map((emb, i) => ({
      chunk: ragIndex.chunks[i],
      score: cosineSimilarity(queryEmbedding, emb)
    }));
    
    scores.sort((a, b) => b.score - a.score);
    
    // Deduplicate by file — don't return 5 chunks from the same file
    const seen = new Set();
    const results = [];
    for (const r of scores) {
      const key = r.chunk.filePath;
      if (!seen.has(key) || results.length < 2) {
        seen.add(key);
        results.push(r);
        if (results.length >= topK) break;
      }
    }
    
    return results.filter(r => r.score > 0.3); // minimum relevance threshold
    
  } catch (e) {
    console.error('[RAG] Search error:', e.message);
    return [];
  }
}

// Format search results as context string for AI
function formatContext(results) {
  if (results.length === 0) return '';
  
  const parts = results.map(r => 
    `### ${r.chunk.filePath} (lines ${r.chunk.startLine}-${r.chunk.endLine}, relevance: ${(r.score * 100).toFixed(0)}%)\n\`\`\`\n${r.chunk.rawText}\n\`\`\``
  );
  
  return `## Relevant code from your codebase:\n\n${parts.join('\n\n')}`;
}

function getStatus() {
  return {
    indexed: ragIndex.chunks.length > 0,
    chunks: ragIndex.chunks.length,
    workspace: ragIndex.workspace,
    indexedAt: ragIndex.indexedAt,
    isIndexing,
    progress: indexingProgress,
  };
}

module.exports = { init, indexWorkspace, search, formatContext, getStatus };
