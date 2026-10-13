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
});
