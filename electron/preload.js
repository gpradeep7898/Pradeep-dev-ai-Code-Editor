const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Receive "open this folder" from main (dock drag-drop, open-file event)
  onOpenFolder: (cb) => ipcRenderer.on('open-folder', (_, folder) => cb(folder)),
  // Send native notification from renderer
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  // Platform
  platform: process.platform,
});
