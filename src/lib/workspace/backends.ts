import { phoneFs, phoneTools } from '../phoneTools';
import { normalizeBridgeUrl } from '../tools';
import type { Settings } from '../types';
import type { Entry, Workspace } from './core';
import {
  baseName,
  ghList,
  ghRead,
  ghReadBase,
  ghSearch,
  ghStageDelete,
  ghStageRename,
  ghStageWrite,
  joinPath,
  normPath,
  unifiedDiff,
} from './core';
import { getWorkspace, patchWorkspace } from './store';

/** One interface over GitHub (staged), laptop (bridge) and phone (direct) workspaces. */

async function bridge(s: Settings, path: string, body: unknown) {
  if (!s.bridgeUrl || !s.bridgeToken) throw new Error('The laptop isn’t connected (Connections → Laptop).');
  const res = await fetch(normalizeBridgeUrl(s.bridgeUrl) + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.bridgeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Laptop ${res.status}: ${json?.error ?? res.statusText}`);
  return json;
}

/** Runs a small Node script on the laptop (base64 keeps it safe from shell quoting on every OS). */
async function laptopNode(s: Settings, cwd: string, script: string): Promise<string> {
  const b64 = btoa(unescape(encodeURIComponent(script)));
  const r = await bridge(s, '/run', { command: `node -e "eval(Buffer.from('${b64}','base64').toString())"`, cwd: cwd || '.' });
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || 'Command failed').trim().split('\n').slice(-3).join('\n'));
  return r.stdout ?? '';
}

const lp = (ws: Workspace, p: string) => joinPath(ws.root ?? '', p) || '.';

function phone(s: Settings) {
  if (!s.phoneFolder) throw new Error('No phone folder is shared (Connections → Phone folder).');
  return phoneFs(s.phoneFolder);
}

const fresh = (ws: Workspace) => getWorkspace(ws.id) ?? ws;

export async function wsList(s: Settings, ws: Workspace, dir: string): Promise<Entry[]> {
  dir = normPath(dir);
  if (ws.kind === 'github') return ghList(s, fresh(ws), dir);
  if (ws.kind === 'phone') return phone(s).list(dir);
  const r = await bridge(s, '/list', { path: lp(ws, dir) });
  return (r.entries as string[])
    .map((e) => {
      const isDir = e.endsWith('/');
      const name = isDir ? e.slice(0, -1) : e;
      return { name, path: joinPath(dir, name), isDir };
    })
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}

export async function wsRead(s: Settings, ws: Workspace, path: string): Promise<string> {
  path = normPath(path);
  if (!path) throw new Error('Missing "path".');
  if (ws.kind === 'github') return ghRead(s, fresh(ws), path);
  if (ws.kind === 'phone') return phone(s).read(path);
  const r = await bridge(s, '/read', { path: lp(ws, path), length: 2 * 1024 * 1024 });
  if (r.binary) throw new Error(`${path} is a binary file.`);
  if (typeof r.size === 'number' && r.end < r.size) throw new Error(`${path} is too big to edit here (${r.size} bytes).`);
  return r.content;
}

/** The base version for diffs (github only; others have no staging). */
export const wsReadBase = (s: Settings, ws: Workspace, path: string) => ghReadBase(s, fresh(ws), path);

/** GitHub: stages. Laptop/phone: writes the file now. */
export async function wsWrite(s: Settings, ws: Workspace, path: string, content: string): Promise<string> {
  path = normPath(path);
  if (!path) throw new Error('Missing "path".');
  if (ws.kind === 'github') {
    const cur = fresh(ws);
    const changes = await ghStageWrite(s, cur, path, content);
    patchWorkspace(ws.id, { changes });
    return changes[path] ? `Staged ${path} (${Object.keys(changes).length} staged change(s); commit with ws.commit).` : `${path} is unchanged from the branch.`;
  }
  if (ws.kind === 'phone') {
    const t = phoneTools({ settings: s, skills: [], mcpServers: [], mcpTools: {} })['phone.write'];
    return String(await t.run({ settings: s, skills: [], mcpServers: [], mcpTools: {} }, { path, content }));
  }
  const r = await bridge(s, '/write', { path: lp(ws, path), content });
  return `Wrote ${r.bytes} bytes to ${path} on the laptop.`;
}

export async function wsDelete(s: Settings, ws: Workspace, path: string): Promise<string> {
  path = normPath(path);
  if (!path) throw new Error('Missing "path".');
  if (ws.kind === 'github') {
    const { changes, count } = await ghStageDelete(s, fresh(ws), path);
    patchWorkspace(ws.id, { changes });
    return `Staged deletion of ${count} file(s) under ${path}.`;
  }
  if (ws.kind === 'phone') {
    phone(s).remove(path);
    return `Deleted ${path}.`;
  }
  await laptopNode(s, '.', `require('fs').rmSync(${JSON.stringify(lp(ws, path))},{recursive:true})`);
  return `Deleted ${path} on the laptop.`;
}

export async function wsRename(s: Settings, ws: Workspace, from: string, to: string): Promise<string> {
  from = normPath(from);
  to = normPath(to);
  if (!from || !to) throw new Error('Both paths are needed.');
  if (ws.kind === 'github') {
    patchWorkspace(ws.id, { changes: await ghStageRename(s, fresh(ws), from, to) });
    return `Staged rename ${from} → ${to}.`;
  }
  if (ws.kind === 'phone') {
    const text = await phone(s).read(from); // text files only
    await wsWrite(s, ws, to, text);
    phone(s).remove(from);
    return `Renamed ${from} → ${to}.`;
  }
  await laptopNode(s, '.', `const f=require('fs'),p=require('path');f.mkdirSync(p.dirname(${JSON.stringify(lp(ws, to))}),{recursive:true});f.renameSync(${JSON.stringify(lp(ws, from))},${JSON.stringify(lp(ws, to))})`);
  return `Renamed ${from} → ${to}.`;
}

export async function wsMkdir(s: Settings, ws: Workspace, path: string): Promise<string> {
  path = normPath(path);
  if (ws.kind === 'github') return wsWrite(s, ws, `${path}/.gitkeep`, ''); // git has no empty folders
  if (ws.kind === 'phone') {
    phone(s).mkdir(path);
    return `Created ${path}/.`;
  }
  await laptopNode(s, '.', `require('fs').mkdirSync(${JSON.stringify(lp(ws, path))},{recursive:true})`);
  return `Created ${path}/.`;
}

/** Name matches (and, where possible, content matches as "path:line: text"). */
export async function wsSearch(s: Settings, ws: Workspace, query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) throw new Error('Missing "query".');
  if (ws.kind === 'github') return ghSearch(s, fresh(ws), q);
  if (ws.kind === 'phone') {
    // Breadth-first walk over names.
    const out: string[] = [];
    const queue = [''];
    let seen = 0;
    while (queue.length && seen < 2000 && out.length < 100) {
      const dir = queue.shift()!;
      for (const e of phone(s).list(dir)) {
        seen++;
        if (e.name.toLowerCase().includes(q.toLowerCase())) out.push(e.isDir ? `${e.path}/` : e.path);
        if (e.isDir && !/^(\.git|node_modules)$/.test(e.name)) queue.push(e.path);
      }
    }
    return out;
  }
  const script = `const f=require('fs'),p=require('path');const q=${JSON.stringify(q.toLowerCase())};const out=[];let n=0;
function walk(d){if(out.length>=120||n>5000)return;let es;try{es=f.readdirSync(d,{withFileTypes:true})}catch{return}
for(const e of es){n++;if(/^(\\.git|node_modules|dist|build|\\.expo)$/.test(e.name))continue;const r=p.join(d,e.name);const rel=p.relative('.',r).split(p.sep).join('/');
if(e.name.toLowerCase().includes(q))out.push(rel+(e.isDirectory()?'/':''));
if(e.isDirectory())walk(r);else{try{const st=f.statSync(r);if(st.size<300000){const t=f.readFileSync(r,'utf8');if(!t.includes('\\u0000'))t.split('\\n').forEach((l,i)=>{if(out.length<120&&l.toLowerCase().includes(q))out.push(rel+':'+(i+1)+': '+l.trim().slice(0,160))})}}catch{}}}}
walk('.');console.log(out.join('\\n'))`;
  return (await laptopNode(s, lp(ws, ''), script)).split('\n').filter(Boolean);
}

export async function wsDiffText(s: Settings, ws: Workspace, only?: string): Promise<string> {
  const cur = fresh(ws);
  if (cur.kind !== 'github') return 'Laptop and phone workspaces save files directly, so there is nothing staged.';
  const entries = Object.entries(cur.changes).filter(([p]) => !only || p === only || p.startsWith(`${only}/`));
  if (!entries.length) return 'No staged changes.';
  const parts: string[] = [];
  for (const [p, c] of entries) {
    const base = c.isNew ? null : await ghReadBase(s, cur, p).catch(() => '(binary)');
    parts.push(unifiedDiff(p, base, c.op === 'delete' ? null : (c.content ?? '')));
  }
  return parts.join('\n\n');
}

export function describeWorkspace(ws: Workspace): string {
  if (ws.kind === 'github') return `GitHub ${ws.repo} @ ${ws.branch}`;
  if (ws.kind === 'laptop') return `Laptop folder ${ws.root ? `“${ws.root}”` : '(bridge root)'}`;
  return 'Phone folder';
}

export const titleOf = (p: string) => baseName(p) || '/';
