// Runs isolated from the page (contextIsolation on, no Node in the page). Exposes a small bridge.
const { contextBridge, ipcRenderer } = require('electron');

const handlers = new Map();
ipcRenderer.on('net:event', (_e, id, type, payload) => {
  const h = handlers.get(id);
  if (!h) return;
  if (type === 'end' || type === 'error') handlers.delete(id);
  h(type, payload);
});

contextBridge.exposeInMainWorld('trychatDesktopNet', {
  request(id, req, onEvent) {
    handlers.set(id, onEvent);
    return ipcRenderer.invoke('net:request', id, req).catch((e) => {
      handlers.delete(id);
      throw e;
    });
  },
  abort(id) {
    handlers.delete(id);
    ipcRenderer.send('net:abort', id);
  },
});

contextBridge.exposeInMainWorld('trychatDesktop', {
  platform: process.platform,
  htmlToPdf: (html, options) => ipcRenderer.invoke('pdf:fromHtml', html, options),
  openFile: (name, bytes) => ipcRenderer.invoke('file:open', name, bytes),
  saveFile: (name, bytes) => ipcRenderer.invoke('file:save', name, bytes),
  // Folders on this computer that the user opened in TryChat (see main.js: only those are reachable).
  fs: {
    pickFolder: () => ipcRenderer.invoke('fs:pickFolder'),
    forget: (root) => ipcRenderer.invoke('fs:forget', root),
    list: (root, rel) => ipcRenderer.invoke('fs:list', root, rel),
    read: (root, rel) => ipcRenderer.invoke('fs:read', root, rel),
    write: (root, rel, content) => ipcRenderer.invoke('fs:write', root, rel, content),
    remove: (root, rel) => ipcRenderer.invoke('fs:delete', root, rel),
    rename: (root, from, to) => ipcRenderer.invoke('fs:rename', root, from, to),
    mkdir: (root, rel) => ipcRenderer.invoke('fs:mkdir', root, rel),
    search: (root, query) => ipcRenderer.invoke('fs:search', root, query),
    reveal: (root, rel) => ipcRenderer.invoke('fs:reveal', root, rel),
  },
});
