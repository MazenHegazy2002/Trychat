// TryChat for Mac: the Expo web build (desktop/web, from `npm run web`) in an Electron window.
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell, systemPreferences } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGIN = 'app://trychat';
const WEB_DIR = path.join(__dirname, 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.map': 'application/json', '.wasm': 'application/wasm',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

const isAppUrl = (url) => typeof url === 'string' && url.startsWith(ORIGIN + '/');
const fromApp = (event) => isAppUrl(event.senderFrame && event.senderFrame.url);

function serve(request) {
  const { pathname } = new URL(request.url);
  let file = path.normalize(path.join(WEB_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(WEB_DIR)) return new Response('Forbidden', { status: 403 });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = fs.existsSync(file + '.html') ? file + '.html' : path.join(WEB_DIR, 'index.html'); // client-side routes
  }
  let body = fs.readFileSync(file);
  if (file.endsWith('.html')) {
    // The fetch proxy must be installed before the bundle captures window.fetch.
    body = body.toString('utf8').replace('<head>', '<head><script src="/__desktop/renderer-shim.js"></script>');
  }
  return new Response(body, { headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' } });
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'TryChat',
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    backgroundColor: '#0A0A0B',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());

  // Links leave the app: open them in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  });

  win.loadURL(ORIGIN + '/');
  return win;
}

// ---- fetch proxy (renderer-shim.js) ----
const inflight = new Map();
const FORBIDDEN = new Set(['host', 'content-length', 'connection', 'origin', 'referer', 'cookie', 'accept-encoding']);

ipcMain.handle('net:request', async (event, id, req) => {
  if (!fromApp(event)) throw new Error('Not allowed');
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) requests are proxied');
  const controller = new AbortController();
  inflight.set(id, controller);
  const headers = (req.headers || []).filter(([k]) => !FORBIDDEN.has(String(k).toLowerCase()));
  let res;
  try {
    res = await net.fetch(url.href, {
      method: req.method,
      headers,
      body: req.body ? Buffer.from(req.body) : undefined,
      redirect: req.redirect === 'manual' ? 'manual' : req.redirect === 'error' ? 'error' : 'follow',
      signal: controller.signal,
      credentials: 'omit',
    });
  } catch (e) {
    inflight.delete(id);
    throw e;
  }
  const send = (type, payload) => !event.sender.isDestroyed() && event.sender.send('net:event', id, type, payload);
  (async () => {
    try {
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          send('chunk', value);
        }
      }
      send('end');
    } catch (e) {
      send('error', e && e.message ? e.message : String(e));
    } finally {
      inflight.delete(id);
    }
  })();
  return { status: res.status, statusText: res.statusText, headers: [...res.headers], url: res.url || url.href, redirected: res.redirected };
});

ipcMain.on('net:abort', (event, id) => {
  if (!fromApp(event)) return;
  inflight.get(id)?.abort();
  inflight.delete(id);
});

// ---- files & PDFs ----
const safeName = (name) => String(name || 'file').replace(/[/\\:\0]/g, '_').slice(0, 200);

ipcMain.handle('pdf:fromHtml', async (event, html, { width, height, margin }) => {
  if (!fromApp(event)) throw new Error('Not allowed');
  const tmp = path.join(os.tmpdir(), `trychat-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({
      pageSize: { width, height },
      margins: { top: margin, bottom: margin, left: margin, right: margin },
      printBackground: true,
    });
    return new Uint8Array(pdf);
  } finally {
    win.destroy();
    fs.rm(tmp, () => {});
  }
});

ipcMain.handle('file:open', async (event, name, bytes) => {
  if (!fromApp(event)) throw new Error('Not allowed');
  const dir = path.join(app.getPath('temp'), 'TryChat');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safeName(name));
  fs.writeFileSync(file, Buffer.from(bytes));
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
});

ipcMain.handle('file:save', async (event, name, bytes) => {
  if (!fromApp(event)) throw new Error('Not allowed');
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), safeName(name)) });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return filePath;
});

// ---- folders on this computer (workspaces) ----
// The app can only touch folders the user picked in the "Open a folder" dialog; the list is kept in
// userData/folders.json. Every path is resolved inside one of those folders, and symlinks that lead
// outside are refused.
const fsp = fs.promises;
const FOLDERS_FILE = () => path.join(app.getPath('userData'), 'folders.json');
const SKIP_DIRS = /^(\.git|node_modules|dist|build|\.expo|\.next|__pycache__|\.venv|venv)$/;

function approvedFolders() {
  try {
    const list = JSON.parse(fs.readFileSync(FOLDERS_FILE(), 'utf8'));
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function setApprovedFolders(list) {
  fs.mkdirSync(path.dirname(FOLDERS_FILE()), { recursive: true });
  fs.writeFileSync(FOLDERS_FILE(), JSON.stringify([...new Set(list)], null, 2));
}

const outside = (base, target) => {
  const rel = path.relative(base, target);
  return rel.startsWith('..') || path.isAbsolute(rel);
};

/** The absolute path of `rel` inside the approved folder `root`. */
async function inside(root, rel) {
  const base = path.resolve(String(root || ''));
  if (!approvedFolders().includes(base)) throw new Error('That folder isn’t open in TryChat. Open it again from Workspaces.');
  const target = path.resolve(base, String(rel || '').replace(/^[\\/]+/, ''));
  if (outside(base, target)) throw new Error('That path is outside the folder.');
  // The nearest existing part of the path must really be inside the folder (no symlink escapes).
  const realBase = await fsp.realpath(base);
  for (let probe = target; ; probe = path.dirname(probe)) {
    try {
      if (outside(realBase, await fsp.realpath(probe))) throw new Error('That path is outside the folder.');
      break;
    } catch (e) {
      if (e.code !== 'ENOENT' || path.dirname(probe) === probe) throw e;
    }
  }
  return target;
}

const handleFs = (channel, fn) =>
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error('Not allowed');
    return fn(event, ...args);
  });

handleFs('fs:pickFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Open a folder', properties: ['openDirectory', 'createDirectory'] });
  if (canceled || !filePaths[0]) return null;
  const dir = path.resolve(filePaths[0]);
  setApprovedFolders([...approvedFolders(), dir]);
  return { path: dir, name: path.basename(dir) || dir };
});

handleFs('fs:forget', async (_event, root) => {
  const base = path.resolve(String(root || ''));
  setApprovedFolders(approvedFolders().filter((p) => p !== base));
});

handleFs('fs:list', async (_event, root, rel) => {
  const dir = await inside(root, rel);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = await Promise.all(
    entries.map(async (e) => {
      try {
        const st = await fsp.stat(path.join(dir, e.name));
        return { name: e.name, isDir: st.isDirectory(), size: st.isDirectory() ? undefined : st.size };
      } catch {
        return null; // a broken link
      }
    }),
  );
  return out.filter(Boolean);
});

handleFs('fs:read', async (_event, root, rel) => {
  const file = await inside(root, rel);
  const st = await fsp.stat(file);
  if (st.isDirectory()) throw new Error(`${rel} is a folder.`);
  if (st.size > 2 * 1024 * 1024) return { tooBig: true, size: st.size };
  const buf = await fsp.readFile(file);
  if (buf.includes(0)) return { binary: true, size: st.size };
  return { content: buf.toString('utf8'), size: st.size };
});

handleFs('fs:write', async (_event, root, rel, content) => {
  const file = await inside(root, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const data = Buffer.from(String(content ?? ''), 'utf8');
  await fsp.writeFile(file, data);
  return { bytes: data.length };
});

handleFs('fs:delete', async (_event, root, rel) => {
  const target = await inside(root, rel);
  if (target === path.resolve(String(root))) throw new Error('The folder itself can’t be deleted from here.');
  await fsp.rm(target, { recursive: true });
});

handleFs('fs:rename', async (_event, root, from, to) => {
  const a = await inside(root, from);
  const b = await inside(root, to);
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.rename(a, b);
});

handleFs('fs:mkdir', async (_event, root, rel) => {
  await fsp.mkdir(await inside(root, rel), { recursive: true });
});

handleFs('fs:search', async (_event, root, query) => {
  const base = await inside(root, '');
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const out = [];
  let seen = 0;
  async function walk(dir) {
    if (out.length >= 120 || seen > 5000) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= 120 || seen > 5000) return;
      seen++;
      if (SKIP_DIRS.test(e.name) || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(base, abs).split(path.sep).join('/');
      if (e.name.toLowerCase().includes(q)) out.push(rel + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) await walk(abs);
      else {
        try {
          const st = await fsp.stat(abs);
          if (st.size >= 300000) continue;
          const text = await fsp.readFile(abs, 'utf8');
          if (text.includes('\u0000')) continue;
          text.split('\n').forEach((line, i) => {
            if (out.length < 120 && line.toLowerCase().includes(q)) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
          });
        } catch {
          // unreadable file
        }
      }
    }
  }
  await walk(base);
  return out;
});

handleFs('fs:reveal', async (_event, root, rel) => {
  shell.showItemInFolder(await inside(root, rel));
});

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/__desktop/renderer-shim.js') {
        return new Response(fs.readFileSync(path.join(__dirname, 'renderer-shim.js')), { headers: { 'Content-Type': 'text/javascript' } });
      }
      return serve(request);
    });

    // Microphone (voice messages), clipboard and notifications for the app's own pages only.
    const ALLOWED = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
      if (!ALLOWED.has(permission) || !isAppUrl(details.requestingUrl || wc.getURL())) return callback(false);
      if (permission === 'media' && process.platform === 'darwin') {
        const wantsVideo = (details.mediaTypes || []).includes('video');
        const ok = await systemPreferences.askForMediaAccess('microphone');
        const okVideo = wantsVideo ? await systemPreferences.askForMediaAccess('camera') : true;
        return callback(ok && okVideo);
      }
      callback(true);
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED.has(permission) && String(origin).startsWith(ORIGIN));

    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
