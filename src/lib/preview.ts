// Holds the code for the preview screen; too large to pass as a route param.
let current = { code: '', lang: 'html' };

export function setPreview(code: string, lang: string) {
  current = { code, lang };
}

export function getPreview() {
  return current;
}

export function isPreviewable(lang: string): boolean {
  return ['html', 'htm', 'svg', 'xml', 'javascript', 'js'].includes(lang.toLowerCase());
}

export function toHtmlDocument(code: string, lang: string): string {
  const l = lang.toLowerCase();
  if (l === 'javascript' || l === 'js') {
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><pre id="out" style="font-family:monospace;white-space:pre-wrap"></pre><script>
const out=document.getElementById('out');const log=(...a)=>{out.textContent+=a.map(x=>typeof x==='object'?JSON.stringify(x,null,2):String(x)).join(' ')+'\\n'};
console.log=log;console.error=log;window.onerror=(m)=>log('Error: '+m);
</script><script>${code}</script></body></html>`;
  }
  if (/<html[\s>]/i.test(code) || /<!doctype/i.test(code)) return code;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${code}</body></html>`;
}
