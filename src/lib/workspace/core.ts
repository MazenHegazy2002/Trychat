import { base64ToBytes, decodeText, gh, GitHubError, looksBinary, utf8ToBase64 } from '../github';
import type { Settings } from '../types';

/**
 * Workspaces: a GitHub repo branch, a laptop folder (bridge) or the phone folder, opened like a code editor.
 * GitHub workspaces keep a local changeset that is committed as ONE commit through the Git Data API.
 * This file has no React Native imports so it can be tested with plain fetch.
 */

export type WorkspaceKind = 'github' | 'laptop' | 'phone';

export interface Change {
  op: 'write' | 'delete';
  content?: string;
  /** The file didn't exist in the base commit. */
  isNew: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /** github: owner/name and branch; baseSha = the commit the changeset is based on. */
  repo?: string;
  branch?: string;
  baseSha?: string;
  /** laptop: subfolder of the bridge root ('' = root). */
  root?: string;
  /** Staged changes by path (github only). */
  changes: Record<string, Change>;
  lastCommit?: { sha: string; url: string; branch: string; prUrl?: string; at: number };
  createdAt: number;
  updatedAt: number;
}

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  /** Staged state, github only. */
  status?: 'new' | 'modified' | 'deleted';
}

type Gh = Pick<Settings, 'githubToken' | 'repos'>;

export function normPath(p: unknown): string {
  if (p === undefined || p === null) return '';
  if (typeof p !== 'string') throw new Error('"path" must be text like "src/app.ts".');
  const out: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) throw new Error(`"${p}" points outside the workspace.`);
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const joinPath = (a: string, b: string) => normPath(a ? `${a}/${b}` : b);

// ---------- GitHub tree + blobs ----------

interface TreeItem {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  mode: string;
  size?: number;
}

const trees = new Map<string, Promise<{ items: TreeItem[]; truncated: boolean }>>();
const blobs = new Map<string, Promise<string>>();

export async function branchHead(s: Gh, repo: string, branch: string): Promise<string> {
  const ref = await gh<{ object: { sha: string } }>(s, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, '/')}`, {
    what: `branch ${branch} of ${repo}`,
  });
  return ref.object.sha;
}

export async function listBranches(s: Gh, repo: string): Promise<string[]> {
  const list = await gh<{ name: string }[]>(s, `/repos/${repo}/branches?per_page=100`, { what: repo });
  return list.map((b) => b.name);
}

export function repoTree(s: Gh, repo: string, commitSha: string) {
  const key = `${repo}@${commitSha}`;
  let p = trees.get(key);
  if (!p) {
    p = gh<{ tree: TreeItem[]; truncated: boolean }>(s, `/repos/${repo}/git/trees/${commitSha}?recursive=1`, { what: repo }).then((r) => ({
      items: r.tree,
      truncated: r.truncated,
    }));
    p.catch(() => trees.delete(key));
    trees.set(key, p);
  }
  return p;
}

async function blobText(s: Gh, repo: string, sha: string, path: string): Promise<string> {
  let p = blobs.get(sha);
  if (!p) {
    p = gh<{ content: string; size: number }>(s, `/repos/${repo}/git/blobs/${sha}`, { what: path }).then((b) => {
      const bytes = base64ToBytes(b.content);
      if (looksBinary(path, bytes)) throw new Error(`${path} is a binary file, so it can't be opened as text.`);
      return decodeText(bytes);
    });
    p.catch(() => blobs.delete(sha));
    blobs.set(sha, p);
  }
  return p;
}

function need(ws: Workspace) {
  if (ws.kind !== 'github' || !ws.repo || !ws.baseSha) throw new Error('Not a GitHub workspace.');
  return { repo: ws.repo, base: ws.baseSha };
}

/** The file as it is in the base commit (ignores staged changes); null if it doesn't exist there. */
export async function ghReadBase(s: Gh, ws: Workspace, path: string): Promise<string | null> {
  const { repo, base } = need(ws);
  const item = (await repoTree(s, repo, base)).items.find((i) => i.path === path && i.type === 'blob');
  return item ? blobText(s, repo, item.sha, path) : null;
}

/** Every file path in the workspace with staged changes applied. */
export async function ghFiles(s: Gh, ws: Workspace): Promise<Map<string, number | undefined>> {
  const { repo, base } = need(ws);
  const files = new Map<string, number | undefined>();
  for (const i of (await repoTree(s, repo, base)).items) if (i.type === 'blob') files.set(i.path, i.size);
  for (const [p, c] of Object.entries(ws.changes)) {
    if (c.op === 'delete') files.delete(p);
    else files.set(p, c.content?.length);
  }
  return files;
}

export async function ghList(s: Gh, ws: Workspace, dir: string): Promise<Entry[]> {
  const files = await ghFiles(s, ws);
  const prefix = dir ? `${dir}/` : '';
  const out = new Map<string, Entry>();
  for (const [p, size] of files) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      const name = rest.slice(0, slash);
      if (!out.has(name)) out.set(name, { name, path: prefix + name, isDir: true });
    } else {
      const c = ws.changes[p];
      out.set(rest, { name: rest, path: p, isDir: false, size, status: c ? (c.isNew ? 'new' : 'modified') : undefined });
    }
  }
  // Staged deletions stay visible (struck through) so they can be reviewed.
  for (const [p, c] of Object.entries(ws.changes)) {
    if (c.op === 'delete' && parentOf(p) === dir) out.set(baseName(p), { name: baseName(p), path: p, isDir: false, status: 'deleted' });
  }
  if (dir && !out.size && ![...files.keys()].some((p) => p.startsWith(prefix))) throw new Error(`No folder "${dir}".`);
  return [...out.values()].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}

export async function ghRead(s: Gh, ws: Workspace, path: string): Promise<string> {
  const c = ws.changes[path];
  if (c?.op === 'write') return c.content ?? '';
  if (c?.op === 'delete') throw new Error(`${path} is staged for deletion.`);
  const text = await ghReadBase(s, ws, path);
  if (text === null) throw new Error(`No file "${path}" in ${ws.repo}@${ws.branch}. Use ws.list or ws.search to find it.`);
  return text;
}

/** Returns the new changeset after staging a write (a write that restores the base content un-stages it). */
export async function ghStageWrite(s: Gh, ws: Workspace, path: string, content: string): Promise<Record<string, Change>> {
  if (!path) throw new Error('Missing "path".');
  const base = await ghReadBase(s, ws, path).catch(() => undefined); // binary base: treat as modified
  const changes = { ...ws.changes };
  if (base === content) delete changes[path];
  else changes[path] = { op: 'write', content, isNew: base === null };
  return changes;
}

/** Stages deletion of a file, or of every file under a folder. */
export async function ghStageDelete(s: Gh, ws: Workspace, path: string): Promise<{ changes: Record<string, Change>; count: number }> {
  const files = await ghFiles(s, ws);
  const targets = [...files.keys()].filter((p) => p === path || p.startsWith(`${path}/`));
  if (!targets.length) throw new Error(`Nothing at "${path}".`);
  const changes = { ...ws.changes };
  for (const p of targets) {
    if (changes[p]?.isNew) delete changes[p];
    else changes[p] = { op: 'delete', isNew: false };
  }
  return { changes, count: targets.length };
}

export async function ghStageRename(s: Gh, ws: Workspace, from: string, to: string): Promise<Record<string, Change>> {
  const files = await ghFiles(s, ws);
  const targets = [...files.keys()].filter((p) => p === from || p.startsWith(`${from}/`));
  if (!targets.length) throw new Error(`Nothing at "${from}".`);
  let cur: Workspace = ws;
  for (const p of targets) {
    const text = await ghRead(s, cur, p);
    const dest = to + p.slice(from.length);
    cur = { ...cur, changes: await ghStageWrite(s, cur, dest, text) };
    cur = { ...cur, changes: (await ghStageDelete(s, cur, p)).changes };
  }
  return cur.changes;
}

export async function ghSearch(s: Gh, ws: Workspace, query: string): Promise<string[]> {
  const q = query.toLowerCase();
  const files = await ghFiles(s, ws);
  const out = [...files.keys()].filter((p) => p.toLowerCase().includes(q)).slice(0, 60);
  for (const [p, c] of Object.entries(ws.changes)) {
    if (c.op !== 'write') continue;
    (c.content ?? '').split('\n').forEach((line, i) => {
      if (line.toLowerCase().includes(q) && out.length < 120) out.push(`${p}:${i + 1}: ${line.trim().slice(0, 160)} (staged)`);
    });
  }
  // Code search covers the default branch only and needs a token.
  if (s.githubToken) {
    try {
      const r = await gh<{ items: { path: string }[] }>(s, `/search/code?per_page=30&q=${encodeURIComponent(`${query} repo:${ws.repo}`)}`, {
        what: 'code search',
      });
      for (const it of r.items) if (files.has(it.path) && !out.includes(it.path)) out.push(`${it.path} (contains “${query}”)`);
    } catch {
      // code search is best effort
    }
  }
  return out;
}

// ---------- Commit (Git Data API) ----------

export interface CommitOptions {
  message: string;
  /** Commit to a new branch made from the current one. */
  newBranch?: string;
  pr?: { title?: string; body?: string };
}

export interface CommitResult {
  sha: string;
  url: string;
  branch: string;
  prUrl?: string;
  rebased: boolean;
  /** The new baseSha after the commit. */
  baseSha: string;
}

export class ConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(
      `The branch moved on GitHub and these staged files were also changed there: ${paths.join(', ')}. ` +
        'Discard or re-apply those changes on the latest version, then commit again.',
    );
  }
}

/**
 * Commits the whole changeset as one commit: blobs → tree → commit → update (or create) the ref, then an optional PR.
 * If the branch moved since baseSha, it rebases when none of the staged files changed there, else ConflictError.
 */
export async function commitChangeset(s: Gh, ws: Workspace, opts: CommitOptions): Promise<CommitResult> {
  const { repo, base } = need(ws);
  const branch = ws.branch!;
  const entries = Object.entries(ws.changes);
  if (!entries.length) throw new Error('There are no staged changes to commit.');
  if (!opts.message.trim()) throw new Error('A commit message is required.');
  const newBranch = opts.newBranch?.trim();
  if (newBranch && !/^(?!\/|.*\/\/|.*\.\.|.*\.lock$)[\w./-]+$/.test(newBranch)) throw new Error(`"${newBranch}" isn't a valid branch name.`);

  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await branchHead(s, repo, branch);
    let rebased = false;
    if (head !== base) {
      const cmp = await gh<{ files?: { filename: string; previous_filename?: string }[] }>(s, `/repos/${repo}/compare/${base}...${head}`, {
        what: 'changes on the branch',
      });
      const touched = new Set((cmp.files ?? []).flatMap((f) => [f.filename, f.previous_filename].filter(Boolean) as string[]));
      const clash = entries.map(([p]) => p).filter((p) => touched.has(p));
      if (clash.length) throw new ConflictError(clash);
      rebased = true;
    }
    const parent = await gh<{ tree: { sha: string } }>(s, `/repos/${repo}/git/commits/${head}`, { what: 'the latest commit' });
    const baseItems = (await repoTree(s, repo, base)).items;
    const tree: { path: string; mode: string; type: 'blob'; sha: string | null }[] = [];
    for (const [path, c] of entries) {
      const mode = baseItems.find((i) => i.path === path)?.mode ?? '100644';
      if (c.op === 'delete') {
        tree.push({ path, mode, type: 'blob', sha: null });
      } else {
        const blob = await gh<{ sha: string }>(s, `/repos/${repo}/git/blobs`, {
          method: 'POST',
          body: { content: utf8ToBase64(c.content ?? ''), encoding: 'base64' },
          what: path,
        });
        tree.push({ path, mode, type: 'blob', sha: blob.sha });
      }
    }
    const newTree = await gh<{ sha: string }>(s, `/repos/${repo}/git/trees`, {
      method: 'POST',
      body: { base_tree: parent.tree.sha, tree },
      what: 'the new tree',
    });
    const commit = await gh<{ sha: string; html_url?: string }>(s, `/repos/${repo}/git/commits`, {
      method: 'POST',
      body: { message: opts.message.trim(), tree: newTree.sha, parents: [head] },
      what: 'the commit',
    });
    try {
      if (newBranch) {
        await gh(s, `/repos/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${newBranch}`, sha: commit.sha }, what: `branch ${newBranch}` });
      } else {
        await gh(s, `/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha, force: false }, what: `branch ${branch}` });
      }
    } catch (e) {
      // Someone pushed between reading the head and updating it: try once more from the new head.
      if (!newBranch && e instanceof GitHubError && e.status === 422 && attempt === 0) continue;
      throw e;
    }
    const target = newBranch ?? branch;
    let prUrl: string | undefined;
    if (opts.pr && newBranch) {
      const pr = await gh<{ html_url: string }>(s, `/repos/${repo}/pulls`, {
        method: 'POST',
        body: { title: opts.pr.title?.trim() || opts.message.split('\n')[0], body: opts.pr.body ?? '', head: newBranch, base: branch },
        what: 'the pull request',
      });
      prUrl = pr.html_url;
    }
    return { sha: commit.sha, url: commit.html_url ?? `https://github.com/${repo}/commit/${commit.sha}`, branch: target, prUrl, rebased, baseSha: commit.sha };
  }
  throw new Error('The branch kept moving on GitHub; try again.');
}

// ---------- Diff ----------

export type DiffLine = { t: ' ' | '+' | '-'; text: string; a?: number; b?: number };

/** Line diff (LCS on the part between the common prefix and suffix). */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText === '' ? [] : oldText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const out: DiffLine[] = [];
  for (let i = 0; i < pre; i++) out.push({ t: ' ', text: a[i], a: i + 1, b: i + 1 });
  if (am.length * bm.length > 4_000_000) {
    am.forEach((text, i) => out.push({ t: '-', text, a: pre + i + 1 }));
    bm.forEach((text, i) => out.push({ t: '+', text, b: pre + i + 1 }));
  } else {
    const n = am.length;
    const m = bm.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = am[i] === bm[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) {
        out.push({ t: ' ', text: am[i], a: pre + i + 1, b: pre + j + 1 });
        i++;
        j++;
      } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
        out.push({ t: '+', text: bm[j], b: pre + j + 1 });
        j++;
      } else {
        out.push({ t: '-', text: am[i], a: pre + i + 1 });
        i++;
      }
    }
  }
  for (let k = 0; k < suf; k++) out.push({ t: ' ', text: a[a.length - suf + k], a: a.length - suf + k + 1, b: b.length - suf + k + 1 });
  return out;
}

/** Keeps changed lines plus `context` lines around them; null entries mark skipped runs. */
export function hunks(lines: DiffLine[], context = 3): (DiffLine | null)[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.t !== ' ') for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | null)[] = [];
  lines.forEach((l, i) => {
    if (keep[i]) out.push(l);
    else if (out.at(-1) !== null) out.push(null);
  });
  return out;
}

export function unifiedDiff(path: string, oldText: string | null, newText: string | null): string {
  const body = hunks(diffLines(oldText ?? '', newText ?? ''))
    .map((l) => (l ? `${l.t}${l.text}` : '@@ … @@'))
    .join('\n');
  return `--- ${oldText === null ? '/dev/null' : `a/${path}`}\n+++ ${newText === null ? '/dev/null' : `b/${path}`}\n${body}`;
}
