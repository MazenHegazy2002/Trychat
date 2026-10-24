import { useSyncExternalStore } from 'react';

import { docStore } from './docStore';
import { uid } from './id';

/**
 * Design studio data: designs made of HTML "boards" laid out on a canvas. Kept on this device only
 * (designs/designs.json via docStore); boards can hold large HTML, so they stay out of account sync.
 */

export interface Board {
  id: string;
  name: string;
  /** Self-contained HTML document (inline CSS, data-URI / SVG images). */
  html: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface Design {
  id: string;
  title: string;
  boards: Board[];
  notes: string;
  createdAt: number;
  updatedAt: number;
}

const PATH = 'designs.json';
export const MOBILE = { width: 390, height: 844 };
export const DESKTOP = { width: 1440, height: 900 };
const GAP = 120;

let designs: Design[] = [];
let loaded: Promise<void> | null = null;
let writable = true;
const listeners = new Set<() => void>();

export function loadDesigns(): Promise<void> {
  loaded ??= docStore.read<Design[]>(PATH, (v) => {
    if (!Array.isArray(v)) throw new Error('designs.json is not a list');
  }).then((r) => {
    if (r.status === 'ok') designs = r.value;
    else if (r.status === 'unreadable') writable = false; // never overwrite data we couldn't read
    emit();
  });
  return loaded;
}

function emit() {
  listeners.forEach((l) => l());
}

let saving = Promise.resolve();
function commit(next: Design[]) {
  designs = next;
  emit();
  if (!writable) return;
  const text = JSON.stringify(next);
  saving = saving.then(() => docStore.write(PATH, text)).catch(() => {});
}

function subscribe(l: () => void) {
  listeners.add(l);
  void loadDesigns();
  return () => listeners.delete(l);
}

export function useDesigns(): Design[] {
  return useSyncExternalStore(subscribe, () => designs, () => designs);
}

export function useDesign(id: string | undefined): Design | undefined {
  const list = useDesigns();
  return list.find((d) => d.id === id);
}

export async function allDesigns(): Promise<Design[]> {
  await loadDesigns();
  return designs;
}

export async function getDesign(id: string): Promise<Design | undefined> {
  await loadDesigns();
  const k = String(id ?? '').trim().toLowerCase();
  return designs.find((d) => d.id === id) ?? designs.find((d) => d.title.toLowerCase() === k);
}

function patch(id: string, fn: (d: Design) => Design) {
  commit(designs.map((d) => (d.id === id ? { ...fn(d), updatedAt: Date.now() } : d)));
}

export async function createDesign(title: string, notes = '', boards: Omit<Board, 'id' | 'x' | 'y'>[] = []): Promise<Design> {
  await loadDesigns();
  const now = Date.now();
  let d: Design = { id: uid(), title: title.trim() || 'Untitled design', boards: [], notes, createdAt: now, updatedAt: now };
  for (const b of boards) d = { ...d, boards: [...d.boards, placeBoard(d.boards, b)] };
  commit([d, ...designs]);
  return d;
}

/** Puts a new board to the right of the existing ones. */
function placeBoard(existing: Board[], b: Omit<Board, 'id' | 'x' | 'y'>): Board {
  const right = existing.reduce((m, o) => Math.max(m, o.x + o.width + GAP), 0);
  return { ...b, id: uid(), x: right, y: 0 };
}

export function normalizeSize(width?: unknown, height?: unknown) {
  const w = Math.round(Number(width)) || MOBILE.width;
  const h = Math.round(Number(height)) || (w >= 900 ? DESKTOP.height : MOBILE.height);
  return { width: Math.min(Math.max(w, 200), 3000), height: Math.min(Math.max(h, 200), 6000) };
}

export async function addBoard(designId: string, input: { name: string; html: string; width?: unknown; height?: unknown }): Promise<Board> {
  const d = await getDesign(designId);
  if (!d) throw new Error(`No design "${designId}". Use design.list or design.create.`);
  const board = placeBoard(d.boards, { name: input.name.trim() || `Screen ${d.boards.length + 1}`, html: input.html, ...normalizeSize(input.width, input.height) });
  patch(d.id, (x) => ({ ...x, boards: [...x.boards, board] }));
  return board;
}

export function findBoard(d: Design, key: string): Board | undefined {
  const k = String(key ?? '').trim().toLowerCase().replace(/\.html$/, '');
  return d.boards.find((b) => b.id === key) ?? d.boards.find((b) => b.name.toLowerCase() === k) ?? d.boards.find((b) => slug(b.name) === slug(k));
}

export function updateBoard(designId: string, boardId: string, changes: Partial<Omit<Board, 'id'>>) {
  patch(designId, (d) => ({ ...d, boards: d.boards.map((b) => (b.id === boardId ? { ...b, ...changes } : b)) }));
}

export function duplicateBoard(designId: string, boardId: string) {
  patch(designId, (d) => {
    const b = d.boards.find((x) => x.id === boardId);
    if (!b) return d;
    return { ...d, boards: [...d.boards, placeBoard(d.boards, { name: `${b.name} copy`, html: b.html, width: b.width, height: b.height })] };
  });
}

export function deleteBoard(designId: string, boardId: string) {
  patch(designId, (d) => ({ ...d, boards: d.boards.filter((b) => b.id !== boardId) }));
}

export function renameDesign(id: string, title: string) {
  patch(id, (d) => ({ ...d, title: title.trim() || d.title }));
}

export function setDesignNotes(id: string, notes: string) {
  patch(id, (d) => ({ ...d, notes }));
}

export function deleteDesign(id: string) {
  commit(designs.filter((d) => d.id !== id));
}

export const slug = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ---------- HTML documents built from boards ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** Makes sure a board's HTML is a full document. */
export function boardDocument(html: string): string {
  if (/<html[\s>]/i.test(html) || /<!doctype/i.test(html)) return html;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${html}</body></html>`;
}

/** A static thumbnail: the board scaled to fit, no interaction. */
export function thumbnailDocument(board: Board, background = '#F0EEE6'): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;height:100%;overflow:hidden;background:${background}}
#f{position:absolute;left:0;top:0;border:0;transform-origin:0 0;pointer-events:none;background:#fff}
</style></head><body><iframe id="f" scrolling="no" tabindex="-1" width="${board.width}" height="${board.height}" srcdoc="${esc(boardDocument(board.html))}"></iframe>
<script>const f=document.getElementById('f');function fit(){if(innerWidth<10||innerHeight<10){setTimeout(fit,50);return}const k=Math.min(innerWidth/${board.width},innerHeight/${board.height}*1.6);f.style.left=((innerWidth-${board.width}*k)/2)+'px';f.style.transform='scale('+k+')';}fit();addEventListener('resize',fit);</script></body></html>`;
}

/**
 * Interactive prototype: one board at a time, scaled to fit; links like href="Checkout.html" (a board's name)
 * switch boards, so the whole design clicks through like a prototype. Also used for HTML export.
 */
export function prototypeDocument(d: Design, startBoardId?: string): string {
  const boards = d.boards.map((b) => ({ id: b.id, name: b.name, slug: slug(b.name), w: b.width, h: b.height, html: boardDocument(b.html) }));
  const start = Math.max(0, boards.findIndex((b) => b.id === startBoardId));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title><style>
html,body{margin:0;height:100%;overflow:hidden;background:#1F1E1D;font-family:-apple-system,system-ui,sans-serif}
#stage{position:absolute;inset:0;overflow:auto;display:flex;justify-content:center}
#f{border:0;background:#fff;transform-origin:50% 0;flex:none;box-shadow:0 10px 40px rgba(0,0,0,.4)}
#bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;align-items:center;background:rgba(20,20,19,.86);color:#F5F4ED;border-radius:999px;padding:6px 8px;font-size:13px;backdrop-filter:blur(8px);z-index:2}
#bar button{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:16px}
#bar button:hover{background:rgba(255,255,255,.12)}#name{padding:0 6px;max-width:50vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body><div id="stage"><iframe id="f" sandbox="allow-scripts allow-forms allow-same-origin"></iframe></div>
<div id="bar"><button id="prev" aria-label="Previous screen">‹</button><span id="name"></span><button id="next" aria-label="Next screen">›</button></div>
<script>
const B=${jsonForScript(boards)};let i=${start};const f=document.getElementById('f');
const NAV='<script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href");if(/^(https?:|mailto:|tel:)/i.test(h))return;if(h&&h.charAt(0)!=="#"){e.preventDefault();parent.postMessage({__board:h},"*")}},true)<\\/script>';
function fit(){const b=B[i];if(!b)return;if(innerWidth<10||innerHeight<10){setTimeout(fit,50);return}const k=Math.min(1,innerWidth/b.w,b.w<900?(innerHeight-72)/b.h:1);f.style.transform='scale('+k+')';f.style.marginBottom=(b.h*k-b.h)+'px';f.style.marginTop=(b.w<900&&k<1?0:0)+'px'}
function show(n){if(!B.length)return;i=(n+B.length)%B.length;const b=B[i];f.width=b.w;f.height=b.h;f.srcdoc=b.html.replace(/<\\/body>/i,NAV+'</body>')+(/<\\/body>/i.test(b.html)?'':NAV);document.getElementById('name').textContent=b.name+'  ·  '+(i+1)+'/'+B.length;fit()}
function slug(s){return String(s).toLowerCase().replace(/\\.html?$/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
addEventListener('message',e=>{const h=e.data&&e.data.__board;if(!h)return;const s=slug(decodeURIComponent(h.split('/').pop().split('#')[0]));const n=B.findIndex(b=>b.slug===s||b.id===h);if(n>=0)show(n)});
document.getElementById('prev').onclick=()=>show(i-1);document.getElementById('next').onclick=()=>show(i+1);
addEventListener('keydown',e=>{if(e.key==='ArrowRight')show(i+1);if(e.key==='ArrowLeft')show(i-1)});
addEventListener('resize',fit);show(i);
</script></body></html>`;
}

/**
 * The pan/zoom canvas. Boards are live iframes under a transparent shield (so gestures reach the canvas).
 * Posts {type:'tap'|'longpress', id} and {type:'view', x, y, k} to the app (React Native WebView or parent window).
 */
export function canvasDocument(d: Design, view: { x: number; y: number; k: number } | null, dark: boolean, token: string): string {
  const boards = d.boards.map((b) => ({ id: b.id, name: b.name, x: b.x, y: b.y, w: b.width, h: b.height, html: boardDocument(b.html) }));
  const bg = dark ? '#1F1E1D' : '#F0EEE6';
  const dot = dark ? 'rgba(250,249,245,.10)' : 'rgba(31,30,29,.13)';
  const label = dark ? '#C2C0B6' : '#5E5D59';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
html,body{margin:0;height:100%;overflow:hidden;background:${bg};touch-action:none;-webkit-user-select:none;user-select:none;font-family:-apple-system,system-ui,sans-serif;-webkit-touch-callout:none}
#bg{position:absolute;inset:0;background-image:radial-gradient(${dot} 1.2px,transparent 1.2px)}
#world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.b{position:absolute}
.t{position:absolute;left:2px;bottom:100%;margin-bottom:10px;font-size:15px;font-weight:600;color:${label};white-space:nowrap;transform-origin:0 100%}
.fr{position:absolute;inset:0;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.08),0 12px 40px rgba(0,0,0,.12);transition:box-shadow .15s,outline-color .15s;outline:3px solid transparent;outline-offset:4px}
.b.m .fr{border-radius:28px}
.b.press .fr{outline-color:#D97757}
iframe{border:0;width:100%;height:100%;pointer-events:none;display:block}
.sh{position:absolute;inset:0}
#empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:${label};font-size:15px;text-align:center;padding:24px}
</style></head><body><div id="bg"></div><div id="world"></div>${boards.length ? '' : '<div id="empty">No boards yet. Describe a screen below to start.</div>'}
<script>
const B=${jsonForScript(boards)},T=${JSON.stringify(token)};
const send=m=>{m.token=T;const s=JSON.stringify(m);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);else parent.postMessage(s,'*')};
const W=document.getElementById('world'),BG=document.getElementById('bg');
let v=${view ? JSON.stringify(view) : 'null'};
for(const b of B){const el=document.createElement('div');el.className='b'+(b.w<700?' m':'');el.dataset.id=b.id;el.style.cssText='left:'+b.x+'px;top:'+b.y+'px;width:'+b.w+'px;height:'+b.h+'px';
const t=document.createElement('div');t.className='t';t.textContent=b.name;const fr=document.createElement('div');fr.className='fr';const f=document.createElement('iframe');f.setAttribute('scrolling','no');f.setAttribute('tabindex','-1');f.setAttribute('loading','lazy');f.srcdoc=b.html;fr.appendChild(f);const sh=document.createElement('div');sh.className='sh';el.append(t,fr,sh);W.appendChild(el)}
function fit(){if(!B.length){v={x:0,y:0,k:1};return}let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const b of B){x0=Math.min(x0,b.x);y0=Math.min(y0,b.y-40);x1=Math.max(x1,b.x+b.w);y1=Math.max(y1,b.y+b.h)}
const pad=32,k=Math.max(.03,Math.min((innerWidth-pad*2)/(x1-x0),(innerHeight-pad*2)/(y1-y0),1));v={k,x:(innerWidth-(x1-x0)*k)/2-x0*k,y:(innerHeight-(y1-y0)*k)/2-y0*k}}
let st=0;function apply(){W.style.transform='translate('+v.x+'px,'+v.y+'px) scale('+v.k+')';const g=24*v.k;BG.style.backgroundSize=g+'px '+g+'px';BG.style.backgroundPosition=v.x+'px '+v.y+'px';
document.querySelectorAll('.t').forEach(t=>t.style.transform='scale('+(1/Math.max(v.k,.05))+')');clearTimeout(st);st=setTimeout(()=>send({type:'view',x:v.x,y:v.y,k:v.k}),250)}
function zoomAt(cx,cy,f){const k=Math.min(4,Math.max(.03,v.k*f));v.x=cx-(cx-v.x)*k/v.k;v.y=cy-(cy-v.y)*k/v.k;v.k=k;apply()}
let touched=!!v;function boot(){if(innerWidth<10||innerHeight<10){setTimeout(boot,50);return}if(!v)fit();apply()}boot();
window.__cmd=c=>{if(c==='fit'){fit();apply()}if(c==='in')zoomAt(innerWidth/2,innerHeight/2,1.25);if(c==='out')zoomAt(innerWidth/2,innerHeight/2,.8)};
addEventListener('message',e=>{let m=e.data;try{if(typeof m==='string')m=JSON.parse(m)}catch(_){return}if(m&&m.cmd&&m.token===T)window.__cmd(m.cmd)});
const P=new Map();let start=null,pinch=null,lp=0,lastTap=0;
const boardAt=(x,y)=>{const el=document.elementFromPoint(x,y);const b=el&&el.closest&&el.closest('.b');return b?b.dataset.id:null};
const mark=(id,on)=>{const el=id&&W.querySelector('.b[data-id="'+id+'"]');if(el)el.classList.toggle('press',on)};
addEventListener('pointerdown',e=>{touched=true;P.set(e.pointerId,{x:e.clientX,y:e.clientY});
if(P.size===1){const id=boardAt(e.clientX,e.clientY);start={x:e.clientX,y:e.clientY,vx:v.x,vy:v.y,t:Date.now(),id,moved:false,long:false};mark(id,true);
clearTimeout(lp);lp=setTimeout(()=>{if(start&&!start.moved&&start.id){start.long=true;mark(start.id,false);send({type:'longpress',id:start.id})}},520)}
else if(P.size===2){clearTimeout(lp);if(start){mark(start.id,false);start.moved=true}const [a,b]=[...P.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),k:v.k,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,vx:v.x,vy:v.y}}});
addEventListener('pointermove',e=>{if(!P.has(e.pointerId))return;P.set(e.pointerId,{x:e.clientX,y:e.clientY});
if(pinch&&P.size>=2){const [a,b]=[...P.values()];const d=Math.hypot(a.x-b.x,a.y-b.y),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;const k=Math.min(4,Math.max(.03,pinch.k*d/pinch.d));
v.x=cx-(pinch.cx-pinch.vx)*k/pinch.k;v.y=cy-(pinch.cy-pinch.vy)*k/pinch.k;v.k=k;apply()}
else if(start&&P.size===1){const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!start.moved&&Math.hypot(dx,dy)>6){start.moved=true;clearTimeout(lp);mark(start.id,false)}if(start.moved){v.x=start.vx+dx;v.y=start.vy+dy;apply()}}});
function up(e){P.delete(e.pointerId);if(P.size<2)pinch=null;if(P.size===0&&start){clearTimeout(lp);mark(start.id,false);
if(!start.moved&&!start.long){const now=Date.now();if(start.id)send({type:'tap',id:start.id});else if(now-lastTap<320){fit();apply()}lastTap=now}start=null}
else if(P.size===1){const [p]=[...P.values()];start={x:p.x,y:p.y,vx:v.x,vy:v.y,t:Date.now(),id:null,moved:true,long:false}}}
addEventListener('pointerup',up);addEventListener('pointercancel',up);
addEventListener('contextmenu',e=>{e.preventDefault();const id=boardAt(e.clientX,e.clientY);if(id){clearTimeout(lp);if(start)start.long=true;send({type:'longpress',id})}});
addEventListener('wheel',e=>{e.preventDefault();touched=true;if(e.ctrlKey||e.metaKey)zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*.01));else{v.x-=e.deltaX;v.y-=e.deltaY;apply()}},{passive:false});
addEventListener('resize',()=>{if(!touched&&innerWidth>10){fit();apply()}});
</script></body></html>`;
}
