const { app, BrowserWindow, Notification, ipcMain, shell } = require('electron');
const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');
const http       = require('http');

// ── Preferences (last workspace) ─────────────────────────────────────────────
const PREFS_FILE = path.join(require('os').homedir(), '.myide_prefs.json');
function loadPrefs() { try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch { return {}; } }
function savePrefs(p) { try { fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2)); } catch {} }

// ── Config ────────────────────────────────────────────────────────────────────
const PORT       = 3000;
const SERVER_URL = `http://localhost:${PORT}`;
const MAX_WAIT   = 15_000;  // ms to wait for server before giving up

let mainWin    = null;
let loadingWin = null;
let serverProc = null;
let pendingFolder = null;

// ── Start Express server as child process ─────────────────────────────────────
function startServer() {
  const serverEntry = path.join(__dirname, '../server/index.js');
  // Use the bundled node, or system node
  const nodeExe = process.execPath.includes('Electron') ? 'node' : process.execPath;

  // Load .env path
  const envPath = path.join(__dirname, '../.env');
  const env     = { ...process.env };
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const [k, ...v] = line.split('=');
      if (k && !k.startsWith('#') && v.length) env[k.trim()] = v.join('=').trim();
    });
  }

  serverProc = spawn('node', [serverEntry], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: 'pipe',
  });

  serverProc.stdout.on('data', d => process.stdout.write(d));
  serverProc.stderr.on('data', d => process.stderr.write(d));
  serverProc.on('exit', code => {
    console.log(`[Electron] Server exited with code ${code}`);
  });
}

// ── Wait for server to be ready ───────────────────────────────────────────────
function waitForServer(timeout) {
  return new Promise((resolve, reject) => {
    const start    = Date.now();
    const interval = 400;
    function check() {
      http.get(SERVER_URL, res => {
        if (res.statusCode < 500) resolve();
        else retry();
      }).on('error', retry);
    }
    function retry() {
      if (Date.now() - start > timeout) return reject(new Error(`Server did not start within ${timeout / 1000}s`));
      setTimeout(check, interval);
    }
    check();
  });
}

// ── Create windows ────────────────────────────────────────────────────────────
function createLoadingWindow() {
  loadingWin = new BrowserWindow({
    width: 420, height: 320,
    frame:           false,
    resizable:       false,
    center:          true,
    backgroundColor: '#0d0e11',
    webPreferences:  { nodeIntegration: true, contextIsolation: false },
  });
  loadingWin.loadFile(path.join(__dirname, 'loading.html'));
}

function createMainWindow() {
  const prefs = loadPrefs();
  mainWin = new BrowserWindow({
    width:     prefs.width   || 1400,
    height:    prefs.height  || 900,
    minWidth:  900,
    minHeight: 600,
    x: prefs.x, y: prefs.y,
    show:            false,
    title:           'MyIDE',
    backgroundColor: '#0d0e11',
    titleBarStyle:   'hiddenInset',
    vibrancy:        'under-window',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  // Remove default menu
  mainWin.setMenu(null);

  mainWin.loadURL(SERVER_URL);

  mainWin.once('ready-to-show', () => {
    loadingWin?.close();
    loadingWin = null;
    mainWin.show();
    mainWin.focus();

    // Send any pending folder (from dock drop before window ready)
    if (pendingFolder) {
      mainWin.webContents.send('open-folder', pendingFolder);
      pendingFolder = null;
    } else if (prefs.lastWorkspace) {
      // Restore last workspace
      setTimeout(() => mainWin.webContents.send('open-folder', prefs.lastWorkspace), 500);
    }
  });

  // Save window state on close
  mainWin.on('close', () => {
    const b = mainWin.getBounds();
    const p = loadPrefs();
    savePrefs({ ...p, width: b.width, height: b.height, x: b.x, y: b.y });
  });

  mainWin.on('closed', () => { mainWin = null; });

  // Check Ollama and notify if not running
  checkOllamaAndNotify();
}

// ── Ollama check ──────────────────────────────────────────────────────────────
function checkOllamaAndNotify() {
  setTimeout(() => {
    http.get('http://localhost:11434/api/tags', res => {
      // Ollama is running — great
    }).on('error', () => {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Ollama not detected',
          body:  'Start Ollama for free local AI, or use Claude/GPT-4o via API keys.',
          silent: true,
        }).show();
      }
    });
  }, 3000);
}

// ── Dock drag & drop (open folder) ───────────────────────────────────────────
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  // Check if it's a directory
  const st = fs.statSync(filePath);
  const folder = st.isDirectory() ? filePath : path.dirname(filePath);
  if (mainWin?.webContents) {
    mainWin.webContents.send('open-folder', folder);
  } else {
    pendingFolder = folder;
  }
});

// ── IPC: native notifications ─────────────────────────────────────────────────
ipcMain.on('notify', (_, { title, body }) => {
  if (!mainWin || mainWin.isFocused()) return; // only notify when unfocused
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createLoadingWindow();

  // Send status updates to loading screen
  function status(msg) {
    loadingWin?.webContents?.send('loading-status', msg);
  }

  status('Starting Express server…');
  startServer();

  try {
    status('Waiting for server to be ready…');
    await waitForServer(MAX_WAIT);
    status('Opening IDE…');
    createMainWindow();
  } catch (err) {
    status(`Error: ${err.message}`);
    console.error('[Electron] Failed to start server:', err.message);
    setTimeout(() => app.quit(), 4000);
  }
});

app.on('window-all-closed', () => {
  if (serverProc) serverProc.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWin) createMainWindow();
});

app.on('will-quit', () => {
  if (serverProc) { try { serverProc.kill(); } catch {} }
});
