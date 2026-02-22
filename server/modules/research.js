/**
 * Web Research Module
 * Inspired by AI Deep Research Agent from awesome-llm-apps
 * 
 * How it works:
 * 1. Detect if the query needs web research (new lib, error message, "how to", etc.)
 * 2. Generate smart search queries from the coding question
 * 3. Use DuckDuckGo Instant Answer API (free, no key needed!) + fetch for results
 * 4. Summarize findings and inject as context into the AI response
 */

const https = require('https');
const http = require('http');

// Terms that suggest the user wants/needs current web info
const RESEARCH_TRIGGERS = [
  'how to', 'how do i', 'what is', 'install', 'npm install', 'pip install',
  'error:', 'exception:', 'cannot find', "doesn't work", 'not working',
  'latest version', 'best way', 'best practice', 'tutorial', 'example',
  'documentation', 'docs', 'api', 'library', 'package', 'framework',
  'vs ', ' vs ', 'compare', 'difference between', 'alternatives to',
  'deprecated', 'vulnerability', 'cve-', 'breaking change'
];

function shouldResearch(query) {
  const lower = query.toLowerCase();
  return RESEARCH_TRIGGERS.some(t => lower.includes(t));
}

// Fetch a URL with timeout
function fetchUrl(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'MyIDE/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// DuckDuckGo Instant Answer API (free, no key)
async function ddgSearch(query) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
    const raw = await fetchUrl(url);
    const data = JSON.parse(raw);
    
    const results = [];
    
    // Abstract (main answer)
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        snippet: data.AbstractText,
        url: data.AbstractURL || ''
      });
    }
    
    // Related topics
    for (const topic of (data.RelatedTopics || []).slice(0, 4)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0],
          snippet: topic.Text,
          url: topic.FirstURL
        });
      }
    }
    
    return results;
  } catch {
    return [];
  }
}

// npm registry lookup for package info
async function npmLookup(packageName) {
  try {
    const raw = await fetchUrl(`https://registry.npmjs.org/${packageName}/latest`);
    const pkg = JSON.parse(raw);
    return {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      homepage: pkg.homepage || `https://npmjs.com/package/${packageName}`,
      keywords: (pkg.keywords || []).slice(0, 8).join(', ')
    };
  } catch {
    return null;
  }
}

// PyPI lookup for Python packages
async function pypiLookup(packageName) {
  try {
    const raw = await fetchUrl(`https://pypi.org/pypi/${packageName}/json`);
    const data = JSON.parse(raw);
    const info = data.info;
    return {
      name: info.name,
      version: info.version,
      description: info.summary,
      homepage: info.home_page || `https://pypi.org/project/${packageName}`,
    };
  } catch {
    return null;
  }
}

// Extract package names from a query
function extractPackageNames(query) {
  const npmPattern = /(?:npm install|install|import|require)\s+([a-z@][a-z0-9\-@/.]*)/gi;
  const pipPattern = /(?:pip install|import)\s+([a-z][a-z0-9\-_]*)/gi;
  
  const packages = [];
  let match;
  while ((match = npmPattern.exec(query)) !== null) packages.push({ name: match[1], type: 'npm' });
  while ((match = pipPattern.exec(query)) !== null) packages.push({ name: match[1], type: 'pypi' });
  return packages;
}

// Generate smart search queries from a coding question
function generateSearchQueries(userQuery) {
  const queries = [userQuery];
  
  // Add more specific queries based on patterns
  if (userQuery.match(/error:|Error:|exception/i)) {
    queries.push(`fix: ${userQuery.slice(0, 100)}`);
    queries.push(`stackoverflow: ${userQuery.slice(0, 80)}`);
  }
  
  if (userQuery.match(/how to|how do/i)) {
    queries.push(`${userQuery} tutorial`);
    queries.push(`${userQuery} example code`);
  }
  
  return queries.slice(0, 2); // max 2 searches to keep things fast
}

// Main research function
async function research(query, onProgress) {
  const results = {
    webResults: [],
    packageInfo: [],
    summary: ''
  };
  
  try {
    onProgress?.({ status: 'searching', message: '🔍 Searching the web...' });
    
    // Web search
    const queries = generateSearchQueries(query);
    for (const q of queries) {
      const found = await ddgSearch(q);
      results.webResults.push(...found);
    }
    
    // Deduplicate by URL
    const seen = new Set();
    results.webResults = results.webResults.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    }).slice(0, 6);
    
    // Package lookups
    const packages = extractPackageNames(query);
    for (const pkg of packages.slice(0, 2)) {
      onProgress?.({ status: 'searching', message: `📦 Looking up ${pkg.name}...` });
      const info = pkg.type === 'npm' ? await npmLookup(pkg.name) : await pypiLookup(pkg.name);
      if (info) results.packageInfo.push({ ...info, type: pkg.type });
    }
    
  } catch (e) {
    console.error('[Research] Error:', e.message);
  }
  
  return results;
}

// Format research results as context for AI
function formatResearchContext(results) {
  const parts = [];
  
  if (results.packageInfo.length > 0) {
    parts.push('## 📦 Package Info');
    for (const pkg of results.packageInfo) {
      parts.push(`**${pkg.name}** v${pkg.version} (${pkg.type})\n${pkg.description}\nDocs: ${pkg.homepage}`);
    }
  }
  
  if (results.webResults.length > 0) {
    parts.push('## 🌐 Web Research');
    for (const r of results.webResults.slice(0, 4)) {
      if (r.snippet) {
        parts.push(`**${r.title}**\n${r.snippet}${r.url ? `\n_Source: ${r.url}_` : ''}`);
      }
    }
  }
  
  return parts.length > 0 ? parts.join('\n\n') : '';
}

module.exports = { research, formatResearchContext, shouldResearch };
