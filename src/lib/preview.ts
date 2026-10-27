// Holds the code for the preview screen; too large to pass as a route param.
let current = { code: '', lang: 'html' };

export function setPreview(code: string, lang: string) {
  current = { code, lang };
}

export function getPreview() {
  return current;
}

type Kind = 'html' | 'svg' | 'javascript' | 'python' | 'react' | 'markdown' | 'mermaid';

function kindOf(lang: string): Kind | null {
  const l = lang.toLowerCase();
  if (['html', 'htm', 'xml'].includes(l)) return 'html';
  if (l === 'svg') return 'svg';
  if (['js', 'javascript', 'mjs'].includes(l)) return 'javascript';
  if (['py', 'python', 'python3'].includes(l)) return 'python';
  if (['jsx', 'tsx', 'react'].includes(l)) return 'react';
  if (['md', 'markdown'].includes(l)) return 'markdown';
  if (l === 'mermaid') return 'mermaid';
  return null;
}

export function isPreviewable(lang: string): boolean {
  return kindOf(lang) !== null;
}

/** Things you look at (pages, apps, games, SVG, diagrams): these run by themselves in the chat. */
export function isVisual(lang: string): boolean {
  const k = kindOf(lang);
  return k === 'html' || k === 'svg' || k === 'react' || k === 'mermaid';
}

/** "Run" for code that prints output, "Preview" for things you look at. */
export function previewVerb(lang: string): string {
  const k = kindOf(lang);
  return k === 'python' || k === 'javascript' ? 'Run' : 'Preview';
}

const HEAD = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
const BASE_STYLE =
  '<style>body{font-family:-apple-system,system-ui,sans-serif;margin:16px;color:#141413;background:#fff}pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,monospace}.err{color:#b3261e}</style>';

const escapeForScript = (s: string) => s.replace(/<\/script/gi, '<\\/script');

const CONSOLE_CAPTURE = `<pre id="out"></pre><script>
const out=document.getElementById('out');
const log=(...a)=>{out.textContent+=a.map(x=>typeof x==='object'?JSON.stringify(x,null,2):String(x)).join(' ')+'\\n'};
console.log=log;console.info=log;console.warn=log;console.error=log;
window.onerror=(m)=>{const s=document.createElement('div');s.className='err';s.textContent='Error: '+m;document.body.appendChild(s)};
</script>`;

export function toHtmlDocument(code: string, lang: string): string {
  switch (kindOf(lang)) {
    case 'javascript':
      return `<!doctype html><html><head>${HEAD}${BASE_STYLE}</head><body>${CONSOLE_CAPTURE}<script>(async()=>{${escapeForScript(code)}\n})().catch(e=>console.error(e.message))</script></body></html>`;

    case 'python':
      return `<!doctype html><html><head>${HEAD}${BASE_STYLE}</head><body>
<pre id="out">Starting Python…</pre>
<script src="https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js"></script>
<script>
const out=document.getElementById('out');
(async()=>{
  try{
    const py=await loadPyodide();
    out.textContent='';
    py.setStdout({batched:s=>out.textContent+=s+'\\n'});
    py.setStderr({batched:s=>out.textContent+=s+'\\n'});
    const code=${JSON.stringify(code)};
    await py.loadPackagesFromImports(code);
    const r=await py.runPythonAsync(code);
    if(r!==undefined&&r!==null)out.textContent+=String(r);
    if(!out.textContent)out.textContent='(no output)';
  }catch(e){out.innerHTML+='<span class="err">'+String(e.message||e).replace(/</g,'&lt;')+'</span>'}
})();
</script></body></html>`;

    case 'react': {
      const cleaned = code
        .replace(/^\s*import\s[^;]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^\s*export\s+default\s+/m, '');
      const mountsItself = /createRoot|ReactDOM\.render/.test(cleaned);
      const mount = mountsItself ? '' : '\nReactDOM.createRoot(document.getElementById("root")).render(<App />);';
      return `<!doctype html><html><head>${HEAD}${BASE_STYLE}
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.development.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.development.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js"></script>
</head><body><div id="root"></div>
<script>window.onerror=(m)=>{document.body.insertAdjacentHTML('beforeend','<pre class="err">'+String(m).replace(/</g,'&lt;')+'</pre>')}</script>
<script type="text/babel" data-presets="react,typescript" data-filename="App.tsx">
const { useState, useEffect, useMemo, useRef, useCallback, useReducer, useContext, createContext } = React;
{ // own block, so code that destructures React hooks itself doesn't clash with the line above
${escapeForScript(cleaned)}${mount}
}
</script></body></html>`;
    }

    case 'markdown':
      return `<!doctype html><html><head>${HEAD}${BASE_STYLE}<style>body{line-height:1.6}code{background:#f0eee6;padding:1px 4px;border-radius:4px}pre code{display:block;padding:12px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px}</style>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script></head><body><div id="md"></div>
<script>document.getElementById('md').innerHTML=marked.parse(${JSON.stringify(code)});</script></body></html>`;

    case 'mermaid':
      return `<!doctype html><html><head>${HEAD}${BASE_STYLE}
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script></head><body>
<pre class="mermaid">${code.replace(/</g, '&lt;')}</pre><script>mermaid.initialize({startOnLoad:true});</script></body></html>`;

    case 'svg':
    case 'html':
    default:
      if (/<html[\s>]/i.test(code) || /<!doctype/i.test(code)) return code;
      return `<!doctype html><html><head>${HEAD}</head><body>${code}</body></html>`;
  }
}
