/**
 * Runs JavaScript or Python on the phone inside a hidden WebView (see CodeRunnerHost).
 * Python uses Pyodide, downloaded from a CDN on first use.
 * Code can send files to the user with saveFile(name, data, mimeType) (JS) / save_file(...) (Python).
 */

export type RunLanguage = 'javascript' | 'python';

/** A file code saved with saveFile() / save_file(), base64-encoded. */
export interface RunnerFile {
  name: string;
  mimeType: string;
  base64: string;
}

export interface RunResult {
  output: string;
  files: RunnerFile[];
}

type Executor = (language: RunLanguage, code: string, timeoutMs: number) => Promise<RunResult>;

let executor: Executor | null = null;

export function registerExecutor(fn: Executor | null) {
  executor = fn;
}

export const canRunCode = () => executor !== null;

export function normalizeLanguage(lang: string): RunLanguage | null {
  const l = lang.toLowerCase();
  if (['js', 'javascript', 'node', 'mjs'].includes(l)) return 'javascript';
  if (['py', 'python', 'python3'].includes(l)) return 'python';
  return null;
}

/** Runs code and returns what it printed plus any files it saved with saveFile(). */
export async function runCodeWithFiles(language: RunLanguage, code: string): Promise<RunResult> {
  if (!executor) throw new Error('Code execution is only available in the iOS/Android app.');
  // Python's first run downloads Pyodide (~10 MB), so give it longer.
  const r = await executor(language, code, language === 'python' ? 120_000 : 30_000);
  return { output: r.output, files: Array.isArray(r.files) ? r.files : [] };
}

export async function runCode(language: RunLanguage, code: string): Promise<string> {
  return (await runCodeWithFiles(language, code)).output;
}

/** Per-run limit for saveFile (matches MAX_FILE_BYTES in fileKinds). */
const MAX_SAVE_BYTES = 25 * 1024 * 1024;

/** Python helpers loaded once into Pyodide: save_file() / saveFile() and the matplotlib hook. */
const PY_HELPERS = [
  'import os as _os, warnings as _warnings',
  "_os.environ['MPLBACKEND'] = 'AGG'",
  "_warnings.filterwarnings('ignore', message='.*non-interactive.*')",
  '',
  'def save_file(name, data, mime_type=None):',
  '    """Send a file to the user: str, bytes, a matplotlib Figure or a pandas DataFrame (CSV, or Excel for .xlsx)."""',
  '    import js, io',
  "    if hasattr(data, 'savefig'):",
  "        fmt = name.rsplit('.', 1)[-1].lower() if '.' in name else 'png'",
  "        if fmt not in ('png', 'jpg', 'jpeg', 'svg', 'pdf'):",
  "            fmt = 'png'",
  '        buf = io.BytesIO()',
  "        data.savefig(buf, format=fmt, bbox_inches='tight', dpi=150)",
  '        data = buf.getvalue()',
  "    elif hasattr(data, 'to_csv') and not isinstance(data, (str, bytes)):",
  "        if name.lower().endswith('.xlsx'):",
  '            buf = io.BytesIO()',
  '            data.to_excel(buf, index=False)',
  '            data = buf.getvalue()',
  '        else:',
  '            data = data.to_csv(index=False)',
  '    if isinstance(data, (bytearray, memoryview)):',
  '        data = bytes(data)',
  "    return js.saveFile(name, data, mime_type or '')",
  '',
  'saveFile = save_file',
  '',
  'def _trychat_after_run(saved):',
  '    import sys',
  "    plt = sys.modules.get('matplotlib.pyplot')",
  '    if plt is None:',
  '        return',
  '    nums = plt.get_fignums()',
  '    if not saved:',
  '        for i, n in enumerate(nums):',
  "            save_file('chart.png' if len(nums) == 1 else 'chart-%d.png' % (i + 1), plt.figure(n))",
  "    plt.close('all')",
].join('\n');

/** The page loaded into the hidden runner WebView. */
export const RUNNER_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
const fmt = (v) => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } })();
const MAX_FILE_BYTES = ${MAX_SAVE_BYTES};
const MAX_FILES = 10;
const PY_HELPERS = ${JSON.stringify(PY_HELPERS).replace(/</g, '\\u003c')};
let pyodidePromise = null;
function loadPyodideOnce() {
  if (!pyodidePromise) pyodidePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
    s.onload = () => loadPyodide().then((py) => { py.runPython(PY_HELPERS); return py; }).then(resolve, reject);
    s.onerror = () => { pyodidePromise = null; reject(new Error('Could not download Python (Pyodide). Check your internet connection.')); };
    document.head.appendChild(s);
  });
  return pyodidePromise;
}
const bytesToB64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const extOf = (name) => ((String(name).match(/[.]([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
// saveFile(name, data, mimeType?) for one run: text, bytes, Blob, canvas, <svg>, data: URL, or any JSON value.
function makeSaver(files) {
  const pending = [];
  let total = 0;
  const encode = async (name, data, mime) => {
    if (data && typeof data.getBuffer === 'function') { // Pyodide bytes
      const buf = data.getBuffer('u8');
      try { data = buf.data.slice(); } finally { buf.release(); }
    } else if (data && typeof data.toJs === 'function') data = data.toJs({ dict_converter: Object.fromEntries });
    if (data === undefined || data === null) throw new Error('saveFile(name, data): data is empty');
    const isCanvas = (typeof HTMLCanvasElement !== 'undefined' && data instanceof HTMLCanvasElement) ||
      (typeof OffscreenCanvas !== 'undefined' && data instanceof OffscreenCanvas);
    if (isCanvas) {
      const type = mime && mime.startsWith('image/') ? mime : IMAGE_TYPES[extOf(name)] || 'image/png';
      if (data.toDataURL) return { mime: type, b64: data.toDataURL(type, 0.92).split(',')[1] };
      data = await data.convertToBlob({ type, quality: 0.92 });
    }
    if (typeof SVGElement !== 'undefined' && data instanceof SVGElement) {
      data = new XMLSerializer().serializeToString(data);
      mime = mime || 'image/svg+xml';
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      mime = mime || data.type;
      data = new Uint8Array(await data.arrayBuffer());
    }
    if (data instanceof ArrayBuffer) data = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof Uint8Array) return { mime, b64: bytesToB64(data) };
    if (typeof data === 'string') {
      const m = data.match(/^data:([^;,]*)(;[^,]*)?;base64,/);
      if (m) return { mime: mime || m[1], b64: data.slice(m[0].length) };
      return { mime: mime || (extOf(name) ? '' : 'text/plain'), b64: bytesToB64(new TextEncoder().encode(data)) };
    }
    return { mime: mime || 'application/json', b64: bytesToB64(new TextEncoder().encode(JSON.stringify(data, null, 2))) };
  };
  const saveFile = (name, data, mimeType) => {
    const p = (async () => {
      if (pending.length >= MAX_FILES) throw new Error('saveFile: at most ' + MAX_FILES + ' files per run');
      const fileName = String(name || 'file').trim() || 'file';
      const { mime, b64 } = await encode(fileName, data, mimeType ? String(mimeType) : '');
      const size = Math.floor(b64.length * 3 / 4);
      total += size;
      if (total > MAX_FILE_BYTES) throw new Error('saveFile: ' + fileName + ' is too big (limit ' + (MAX_FILE_BYTES / 1048576) + ' MB per run)');
      files.push({ name: fileName, mimeType: mime || '', base64: b64 });
      return { name: fileName, size };
    })();
    pending.push(p);
    return p;
  };
  return { saveFile, settle: () => Promise.allSettled(pending.slice()) };
}
window.__run = async ({ id, language, code }) => {
  const out = [];
  const files = [];
  const saver = makeSaver(files);
  const finish = async () => {
    for (const r of await saver.settle()) if (r.status === 'rejected') out.push('saveFile error: ' + String(r.reason && r.reason.message || r.reason));
  };
  try {
    if (language === 'python') {
      const py = await loadPyodideOnce();
      py.setStdout({ batched: (s) => out.push(s) });
      py.setStderr({ batched: (s) => out.push(s) });
      try { await py.loadPackagesFromImports(code); } catch (e) {}
      window.saveFile = saver.saveFile; // reached from Python through the js module (save_file)
      try {
        const result = await py.runPythonAsync(code);
        if (result !== undefined && result !== null) out.push(String(result));
        await saver.settle();
        // Charts drawn with matplotlib but never saved are sent as PNGs; open figures are always closed.
        try { py.globals.get('_trychat_after_run')(files.length); } catch (e) { out.push(String(e && e.message || e)); }
      } finally {
        delete window.saveFile;
      }
    } else {
      const log = (...a) => out.push(a.map(fmt).join(' '));
      const sandboxConsole = { log, info: log, warn: log, error: log, debug: log, table: log };
      const fn = new Function('console', 'saveFile', '"use strict"; return (async () => {\\n' + code + '\\n})()');
      const result = await fn(sandboxConsole, saver.saveFile);
      if (result !== undefined) out.push('=> ' + fmt(result));
    }
    await finish();
    post({ id, ok: true, output: out.join('\\n'), files });
  } catch (e) {
    await finish();
    post({ id, ok: false, output: out.join('\\n'), error: String(e && e.message || e) });
  }
};
post({ ready: true });
</script></body></html>`;
