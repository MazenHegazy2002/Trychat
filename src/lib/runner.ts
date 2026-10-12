/**
 * Runs JavaScript or Python on the phone inside a hidden WebView (see CodeRunnerHost).
 * Python uses Pyodide, downloaded from a CDN on first use.
 */

export type RunLanguage = 'javascript' | 'python';

type Executor = (language: RunLanguage, code: string, timeoutMs: number) => Promise<string>;

let executor: Executor | null = null;

export function registerExecutor(fn: Executor | null) {
  executor = fn;
}

export function normalizeLanguage(lang: string): RunLanguage | null {
  const l = lang.toLowerCase();
  if (['js', 'javascript', 'node', 'mjs'].includes(l)) return 'javascript';
  if (['py', 'python', 'python3'].includes(l)) return 'python';
  return null;
}

export async function runCode(language: RunLanguage, code: string): Promise<string> {
  if (!executor) throw new Error('Code execution is only available in the iOS/Android app.');
  // Python's first run downloads Pyodide (~10 MB), so give it longer.
  return executor(language, code, language === 'python' ? 120_000 : 30_000);
}

/** The page loaded into the hidden runner WebView. */
export const RUNNER_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
const fmt = (v) => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } })();
let pyodidePromise = null;
function loadPyodideOnce() {
  if (!pyodidePromise) pyodidePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
    s.onload = () => loadPyodide().then(resolve, reject);
    s.onerror = () => reject(new Error('Could not download Python (Pyodide). Check your internet connection.'));
    document.head.appendChild(s);
  });
  return pyodidePromise;
}
window.__run = async ({ id, language, code }) => {
  const out = [];
  try {
    if (language === 'python') {
      const py = await loadPyodideOnce();
      py.setStdout({ batched: (s) => out.push(s) });
      py.setStderr({ batched: (s) => out.push(s) });
      try { await py.loadPackagesFromImports(code); } catch (e) {}
      const result = await py.runPythonAsync(code);
      if (result !== undefined && result !== null) out.push(String(result));
    } else {
      const log = (...a) => out.push(a.map(fmt).join(' '));
      const sandboxConsole = { log, info: log, warn: log, error: log, debug: log, table: log };
      const fn = new Function('console', '"use strict"; return (async () => {\\n' + code + '\\n})()');
      const result = await fn(sandboxConsole);
      if (result !== undefined) out.push('=> ' + fmt(result));
    }
    post({ id, ok: true, output: out.join('\\n') });
  } catch (e) {
    post({ id, ok: false, output: out.join('\\n'), error: String(e && e.message || e) });
  }
};
post({ ready: true });
</script></body></html>`;
