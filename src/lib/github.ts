import type { Args, ToolDef } from './tools';
import type { Settings } from './types';

/**
 * GitHub REST API client and the github.* tools (personal access token from Connections).
 * Pure fetch code (no native modules) so it runs anywhere.
 */

type GhSettings = Pick<Settings, 'githubToken' | 'repos'>;
export type GithubTool = Omit<ToolDef, 'run' | 'service'> & { service: 'github'; run: (s: Settings, a: Args) => Promise<unknown> };

const API = 'https://api.github.com';
/** Characters of file text per tool result (results are cut at 12,000). */
const PAGE_CHARS = 10_000;
/** Files over 1 MB come from the blob API, up to this size. */
const MAX_BLOB_BYTES = 10 * 1024 * 1024;

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly githubMessage = '',
  ) {
    super(message);
  }
}

// ---------- HTTP ----------

interface GhInit {
  method?: string;
  body?: unknown;
  accept?: string;
  /** What was being fetched, for error messages, e.g. `"src/x.ts" in owner/repo`. */
  what?: string;
}

async function ghRaw(s: GhSettings, path: string, init: GhInit = {}): Promise<{ res: Response; text: string }> {
  // Never send a trailing slash (".../contents/" breaks some proxies; GitHub doesn't need it).
  const clean = path.replace(/\/+(?=\?|$)/, '');
  let res: Response;
  try {
    res = await fetch(API + clean, {
      method: init.method ?? 'GET',
      headers: {
        Accept: init.accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(s.githubToken ? { Authorization: `Bearer ${s.githubToken}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new GitHubError(`Couldn't reach GitHub (${e instanceof Error ? e.message : String(e)}). Check the internet connection.`, 0);
  }
  const text = await res.text();
  if (!res.ok) throw describeError(res, text, s, init.what);
  return { res, text };
}

async function gh<T = any>(s: GhSettings, path: string, init: GhInit = {}): Promise<T> {
  const { text } = await ghRaw(s, path, init);
  return (text ? JSON.parse(text) : null) as T;
}

/** One page of a list endpoint, and whether the Link header says there are more. */
async function ghPage<T = any>(s: GhSettings, path: string, init: GhInit = {}): Promise<{ data: T; next: boolean }> {
  const { res, text } = await ghRaw(s, path, init);
  return { data: (text ? JSON.parse(text) : null) as T, next: /rel="next"/.test(res.headers.get('link') ?? '') };
}

export function describeError(res: Response, text: string, s: GhSettings, what?: string): GitHubError {
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const status = res.status;
  const msg: string = json?.message ?? (text.slice(0, 200) || res.statusText || 'error');
  const details = Array.isArray(json?.errors)
    ? json.errors
        .map((e: any) => (typeof e === 'string' ? e : e?.message ?? [e?.resource, e?.field, e?.code].filter(Boolean).join(' ')))
        .filter(Boolean)
        .join('; ')
    : '';
  const full = (details ? `${msg}: ${details}` : msg).replace(/\.+$/, '');
  const target = what ? ` (${what})` : '';
  const tokenHint = s.githubToken
    ? 'Check that the token in Connections → GitHub has access to this repository (fine-grained tokens: select the repo and grant Contents, Issues and Pull requests — "Read and write" for changes; classic tokens: the "repo" scope).'
    : 'Add a GitHub personal access token in Connections → GitHub.';
  const err = (m: string) => new GitHubError(m, status, msg);

  if ((status === 403 || status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(msg))) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const wait = retryAfter > 0 ? retryAfter : reset > 0 ? Math.max(0, reset - Date.now() / 1000) : 0;
    return err(
      `GitHub rate limit reached${/secondary/i.test(msg) ? ' (too many requests in a short time)' : ''}. ` +
        (wait ? `Try again in about ${Math.max(1, Math.ceil(wait / 60))} min.` : 'Try again in a few minutes.') +
        (s.githubToken ? '' : ' Adding a GitHub token in Connections → GitHub raises the limit to 5,000 requests an hour.'),
    );
  }
  if (status === 401) {
    return err(`GitHub didn't accept the token (${msg}). It may be expired or revoked — create a new one and paste it in Connections → GitHub.`);
  }
  if (status === 403) return err(`GitHub refused access${target}: ${full}. ${tokenHint}`);
  if (status === 404) {
    const ref = /No commit found for the ref (.+)$/i.exec(msg)?.[1];
    if (ref) return err(`There's no branch, tag or commit named "${ref}". github.list_branches shows the branches.`);
    if (/repository is empty/i.test(msg)) return err('This repository is empty (no commits yet).');
    return err(`Not found${target}. Check the owner/name, branch and path. Private repos only show up when the token can see them — ${tokenHint}`);
  }
  if (status === 409 && /empty/i.test(msg)) return err('This repository is empty (no commits yet).');
  if (status === 409) return err(`GitHub reported a conflict${target}: ${full}. The branch or file probably changed meanwhile — read it again and retry.`);
  if (status === 422) return err(`GitHub couldn't do that${target}: ${full}`);
  if (status >= 500) return err(`GitHub had a server error (${status}). Try again in a moment.`);
  return err(`GitHub ${status}${target}: ${full}`);
}

// ---------- Arguments ----------

/** "owner/name" from "owner/name", "owner/name.git", GitHub links or git URLs; null if it isn't one. */
export function normalizeRepo(input: string): string | null {
  const s = input
    .trim()
    .replace(/^git\+/, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]/i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/^\/+/, '')
    .replace(/[?#].*$/, '');
  const [owner, rawName] = s.split('/');
  const name = (rawName ?? '').replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner ?? '')) return null;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') return null;
  return `${owner}/${name}`;
}

function repoArg(s: GhSettings, a: Args): string {
  const raw = typeof a.repo === 'string' ? a.repo.trim() : '';
  if (!raw) {
    if (s.repos.length === 1) return s.repos[0];
    throw new Error(
      s.repos.length
        ? `Say which repository with "repo": ${s.repos.join(', ')} (or any "owner/name").`
        : 'Missing "repo" — give it as "owner/name".',
    );
  }
  const repo = normalizeRepo(raw);
  if (repo) return repo;
  const byName = s.repos.filter((r) => r.split('/')[1]?.toLowerCase() === raw.replace(/\.git$/i, '').toLowerCase());
  if (byName.length === 1) return byName[0];
  throw new Error(`"${raw}" isn't a repository — use "owner/name", like "octocat/hello-world".`);
}

function pathArg(p: unknown, required: boolean): string {
  if (p === undefined || p === null || p === '') {
    if (required) throw new Error('Missing "path" — a file path in the repository, like "src/index.ts".');
    return '';
  }
  if (typeof p !== 'string') throw new Error('"path" must be text, like "src/index.ts".');
  const parts = p.replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
  if (parts.includes('..')) throw new Error('Repository paths can\'t contain "..".');
  return parts.join('/');
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function posInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? '').replace(/^#/, ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function numberArg(a: Args): number {
  const n = posInt(a.number ?? a.pr ?? a.issue ?? a.pull_number);
  if (!n) throw new Error('Missing "number" — the issue or pull request number, like 12.');
  return n;
}

const encodePath = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const refQuery = (ref?: string) => (ref ? `?ref=${encodeURIComponent(ref)}` : '');
const contentsUrl = (repo: string, path: string, ref?: string) => `/repos/${repo}/contents${path ? '/' + encodePath(path) : ''}${refQuery(ref)}`;
const where = (repo: string, path: string, ref?: string) => `"${path || '/'}" in ${repo}${ref ? `@${ref}` : ''}`;

// ---------- Encoding ----------

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + 8192)));
  return btoa(bin);
}

export const utf8ToBase64 = (s: string) => bytesToBase64(new TextEncoder().encode(s));

const BINARY_EXT = new Set(
  'png jpg jpeg gif webp bmp ico icns heic heif tif tiff psd ai sketch pdf zip gz tgz bz2 xz 7z rar jar war apk aab ipa dmg exe dll so dylib a o class wasm mp3 wav ogg flac m4a aac mp4 mov avi mkv webm ttf otf woff woff2 eot doc docx xls xlsx ppt pptx odt ods odp key numbers pages sqlite db bin dat pyc keystore jks p12 der glb'.split(
    ' ',
  ),
);
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml',
  pdf: 'application/pdf', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', mov: 'video/quicktime', json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', ttf: 'font/ttf', woff2: 'font/woff2',
};
export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export const mimeOf = (name: string) => MIME[extOf(name)];
export const hasBinaryExtension = (name: string) => BINARY_EXT.has(extOf(name));

const isUtf16 = (b: Uint8Array) => b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));

/** True for files that aren't text: known binary types, NUL bytes, or invalid UTF-8. */
export function looksBinary(name: string, bytes: Uint8Array): boolean {
  if (BINARY_EXT.has(extOf(name))) return true;
  if (isUtf16(bytes)) return false;
  for (let i = 0; i < Math.min(bytes.length, 8000); i++) if (bytes[i] === 0) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 65536), { stream: true });
    return false;
  } catch {
    return true;
  }
}

/** UTF-8 (BOM stripped) or UTF-16 with a BOM. */
export function decodeText(bytes: Uint8Array): string {
  if (isUtf16(bytes)) {
    const le = bytes[0] === 0xff;
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode(le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  return new TextDecoder().decode(bytes);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A page of whole lines that fits in one tool result. `offset` is a 1-based line number. */
export function pageText(text: string, offset?: unknown, limit?: unknown, maxChars = PAGE_CHARS) {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const total = lines.length;
  const start = Math.min(posInt(offset) ?? 1, Math.max(total, 1));
  const want = posInt(limit) ?? Infinity;
  const out: string[] = [];
  let chars = 0;
  let end = start - 1;
  let cutLine = false;
  while (end < total && out.length < want) {
    const line = lines[end];
    if (chars + line.length + 1 > maxChars) {
      if (!out.length) {
        out.push(line.slice(0, maxChars));
        cutLine = true;
        end++;
      }
      break;
    }
    out.push(line);
    chars += line.length + 1;
    end++;
  }
  return { text: out.join('\n'), start, end, total, complete: start === 1 && end >= total && !cutLine, cutLine };
}

/** "[header]\ncontent" for a page of a text file. */
export function textPage(label: string, size: number, text: string, offset?: unknown, limit?: unknown): string {
  const p = pageText(text, offset, limit);
  const head = `${label} · ${formatBytes(size)} · ${p.total} line${p.total === 1 ? '' : 's'}`;
  if (p.complete) return `[${head}]\n${p.text}`;
  const more = p.end < p.total ? `; continue with "offset": ${p.end + 1}` : '';
  const cut = p.cutLine ? ` (line ${p.start} is very long and was cut)` : '';
  return `[${head} · showing lines ${p.start}-${p.end}${cut}${more}]\n${p.text}`;
}

// ---------- Repository helpers ----------

export interface RepoInfo {
  full_name: string;
  default_branch: string;
  private: boolean;
  fork?: boolean;
  archived?: boolean;
  description?: string | null;
  permissions?: { push?: boolean };
}

const repoCache = new Map<string, { at: number; info: RepoInfo }>();

export async function repoInfo(s: GhSettings, repo: string): Promise<RepoInfo> {
  const key = repo.toLowerCase();
  const hit = repoCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.info;
  const info = await gh<RepoInfo>(s, `/repos/${repo}`, { what: repo });
  repoCache.set(key, { at: Date.now(), info });
  return info;
}

const defaultBranch = async (s: GhSettings, repo: string) => (await repoInfo(s, repo)).default_branch;

function repoLine(r: RepoInfo, pinned: string[]): string {
  const flags = [r.private && 'private', r.fork && 'fork', r.archived && 'archived'].filter(Boolean).join(', ');
  const pin = pinned.some((p) => p.toLowerCase() === r.full_name.toLowerCase()) ? ' · pinned' : '';
  return `${r.full_name}${flags ? ` (${flags})` : ''} · default branch ${r.default_branch}${pin}${r.description ? ` — ${r.description}` : ''}`;
}

/** The signed-in user's repositories, most recently updated first (Connections uses this too). */
export async function listUserRepos(s: GhSettings, page = 1): Promise<{ repos: RepoInfo[]; next: boolean }> {
  const { data, next } = await ghPage<RepoInfo[]>(s, `/user/repos?per_page=100&sort=updated&page=${page}`, { what: 'your repositories' });
  return { repos: data, next };
}

export async function githubWhoAmI(s: GhSettings): Promise<string> {
  return (await gh(s, '/user')).login;
}

/** The ref GitHub used, read from a contents response's `url` (".../contents/x?ref=main"). */
const refOf = (data: any): string | undefined => {
  const m = /[?&]ref=([^&]+)/.exec(String(data?.url ?? ''));
  return m ? decodeURIComponent(m[1]) : undefined;
};

function listing(items: any[]): string {
  const sorted = [...items].sort((x, y) => (x.type === 'dir' ? 0 : 1) - (y.type === 'dir' ? 0 : 1) || x.path.localeCompare(y.path));
  return sorted
    .map((i) =>
      i.type === 'dir' ? `${i.path}/` : i.type === 'submodule' ? `${i.path} (submodule)` : i.type === 'symlink' ? `${i.path} (link)` : `${i.path} · ${formatBytes(i.size ?? 0)}`,
    )
    .join('\n');
}

/** The raw bytes of a file entry from the contents API (inline up to 1 MB, else via the blob API). */
async function contentBytes(s: GhSettings, repo: string, data: any): Promise<Uint8Array> {
  if (data.encoding === 'base64' && typeof data.content === 'string' && (data.content || !data.size)) return base64ToBytes(data.content);
  if (data.size > MAX_BLOB_BYTES) {
    throw new Error(`${data.path} is ${formatBytes(data.size)} — too big to download here (limit ${formatBytes(MAX_BLOB_BYTES)}). It's on GitHub at ${data.html_url}`);
  }
  const blob = await gh(s, `/repos/${repo}/git/blobs/${data.sha}`, { what: `${data.path} in ${repo}` });
  return base64ToBytes(blob.content ?? '');
}

/** A file's bytes and details (for files.send and similar). Throws for folders. */
export async function fetchGithubFile(
  s: GhSettings,
  repoInput: string,
  pathInput: string,
  ref?: string,
): Promise<{ name: string; path: string; size: number; bytes: Uint8Array; mimeType: string; htmlUrl: string }> {
  const repo = repoArg(s, { repo: repoInput });
  const path = pathArg(pathInput, true);
  const data = await gh(s, contentsUrl(repo, path, ref), { what: where(repo, path, ref) });
  if (Array.isArray(data) || data.type !== 'file') throw new Error(`${path} is a ${Array.isArray(data) ? 'folder' : data.type}, not a file.`);
  const bytes = await contentBytes(s, repo, data);
  return { name: data.name, path: data.path, size: data.size, bytes, mimeType: mimeOf(data.name) ?? 'application/octet-stream', htmlUrl: data.html_url };
}

// ---------- Code search ----------

/** Splits a code search query into plain terms and the qualifiers we understand. */
function parseQuery(q: string) {
  const terms: string[] = [];
  const quals: Record<string, string> = {};
  for (const m of q.matchAll(/(\w+):("[^"]*"|\S+)|"([^"]+)"|(\S+)/g)) {
    if (m[1]) quals[m[1].toLowerCase()] = m[2].replace(/^"|"$/g, '');
    else terms.push((m[3] ?? m[4]).toLowerCase());
  }
  return { terms, quals };
}

const SKIP_SCAN = /(^|\/)(node_modules|vendor|dist|build|\.next)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$|\.(min\.js|map|lock)$/;

/** Fallback when GitHub's code search can't help: read the repo's text files and grep them. */
async function scanRepo(s: GhSettings, repo: string, ref: string | undefined, query: string, folder: string, ext?: string) {
  const branch = ref ?? (await defaultBranch(s, repo));
  const treeish = folder ? `${branch}:${folder}` : branch;
  const tree = await gh(s, `/repos/${repo}/git/trees/${encodeURIComponent(treeish)}?recursive=1`, { what: where(repo, folder, branch) });
  const { terms } = parseQuery(query);
  if (!terms.length) throw new Error('Give some words to search for in "query".');
  const blobs: { path: string; sha: string; size: number }[] = tree.tree
    .filter((t: any) => t.type === 'blob')
    .map((t: any) => ({ path: folder ? `${folder}/${t.path}` : t.path, sha: t.sha, size: t.size ?? 0 }))
    .filter((b: any) => !ext || extOf(b.path) === ext.replace(/^\./, '').toLowerCase());
  const nameHits = blobs.filter((b) => terms.every((t) => b.path.toLowerCase().includes(t)));
  const candidates = blobs
    .filter((b) => !hasBinaryExtension(b.path) && b.size <= 200_000 && !SKIP_SCAN.test(b.path))
    .sort((x, y) => x.size - y.size);
  const MAX_FILES = 80;
  const scanned = candidates.slice(0, MAX_FILES);
  const hits: string[] = [];
  for (let i = 0; i < scanned.length; i += 8) {
    const batch = await Promise.all(
      scanned.slice(i, i + 8).map(async (b) => {
        const blob = await gh(s, `/repos/${repo}/git/blobs/${b.sha}`).catch(() => null);
        if (!blob?.content) return null;
        const bytes = base64ToBytes(blob.content);
        if (looksBinary(b.path, bytes)) return null;
        const text = decodeText(bytes);
        const lower = text.toLowerCase();
        if (!terms.every((t) => lower.includes(t))) return null;
        const lines = text.split('\n');
        const shown: string[] = [];
        for (let n = 0; n < lines.length && shown.length < 3; n++) {
          if (terms.some((t) => lines[n].toLowerCase().includes(t))) shown.push(`  ${n + 1}: ${lines[n].trim().slice(0, 200)}`);
        }
        return `${b.path}\n${shown.join('\n')}`;
      }),
    );
    hits.push(...(batch.filter(Boolean) as string[]));
  }
  const parts = [
    `Searched ${scanned.length} of ${blobs.length} files on ${repo}@${branch}${folder ? ` in ${folder}/` : ''} directly${
      blobs.length > scanned.length ? ' (skipped big, binary, generated and dependency files)' : ''
    }${tree.truncated ? '; the repository is too big to list completely, narrow it with "path"' : ''}.`,
    nameHits.length ? `File names that match:\n${nameHits.slice(0, 30).map((b) => b.path).join('\n')}` : '',
    hits.length ? `Files containing ${terms.map((t) => `“${t}”`).join(' and ')}:\n${hits.slice(0, 40).join('\n')}` : 'No file contents matched.',
  ];
  return parts.filter(Boolean).join('\n\n');
}

// ---------- PR / issue formatting ----------

const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');
const clip = (t: string | null | undefined, n: number) => {
  const s = (t ?? '').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};

// ---------- Tools ----------

export const GITHUB_TOOLS: Record<string, GithubTool> = {
  'github.list_repos': {
    service: 'github',
    kind: 'read',
    description: "List the user's GitHub repositories (most recently updated first), with their default branches.",
    params: '{"page":"optional 2, 3…"}',
    label: () => 'Listed your GitHub repositories',
    run: async (s, a) => {
      const page = posInt(a.page) ?? 1;
      try {
        const { repos, next } = await listUserRepos(s, page);
        if (!repos.length) return page > 1 ? 'No more repositories.' : 'No repositories found for this token.';
        return [
          `Your repositories (page ${page}):`,
          ...repos.map((r) => repoLine(r, s.repos)),
          next ? `More: {"page":${page + 1}}` : '',
          s.repos.length ? `Pinned in TryChat: ${s.repos.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      } catch (e) {
        if (!s.repos.length || page > 1) throw e;
        // Some tokens can't list repos (e.g. fine-grained ones); show the pinned ones instead.
        const lines = await Promise.all(
          s.repos.map((r) => repoInfo(s, r).then((i) => repoLine(i, s.repos), (err) => `${r} — ${err instanceof Error ? err.message : err}`)),
        );
        return `Couldn't list all your repositories (${e instanceof Error ? e.message : e}).\nThe repositories pinned in TryChat:\n${lines.join('\n')}`;
      }
    },
  },
  'github.list_files': {
    service: 'github',
    kind: 'read',
    description: 'List one folder of a repository (default branch unless "ref" is given). For the whole tree use github.get_tree.',
    params: '{"repo":"owner/name","path":"optional/folder","ref":"optional branch, tag or commit"}',
    label: (a) => `Listed ${a.path || '/'} in ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const path = pathArg(a.path, false);
      const ref = str(a.ref ?? a.branch);
      const data = await gh(s, contentsUrl(repo, path, ref), { what: where(repo, path, ref) });
      if (!Array.isArray(data)) return `${data.path} is a ${data.type} (${formatBytes(data.size ?? 0)}), not a folder. Read it with github.read_file.`;
      const shownRef = ref ?? refOf(data[0]);
      const head = `[${repo}${shownRef ? `@${shownRef}` : ''} /${path} · ${data.length} item${data.length === 1 ? '' : 's'}]`;
      const tail = data.length >= 1000 ? '\nGitHub lists at most 1,000 items per folder — use github.get_tree to see everything.' : '';
      return data.length ? `${head}\n${listing(data)}${tail}` : `${head}\n(empty folder)`;
    },
  },
  'github.get_tree': {
    service: 'github',
    kind: 'read',
    description: 'All files and folders of a repository (or one folder of it) in one go, with sizes. Good for getting the lay of a codebase.',
    params: '{"repo":"owner/name","path":"optional/folder","ref":"optional branch, tag or commit"}',
    label: (a) => `Listed all files${a.path ? ` in ${a.path}` : ''} of ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const path = pathArg(a.path, false);
      const ref = str(a.ref ?? a.branch) ?? (await defaultBranch(s, repo));
      const treeish = path ? `${ref}:${path}` : ref;
      const tree = await gh(s, `/repos/${repo}/git/trees/${encodeURIComponent(treeish)}?recursive=1`, { what: where(repo, path, ref) });
      const entries: any[] = tree.tree ?? [];
      const files = entries.filter((e) => e.type === 'blob').length;
      const lines: string[] = [];
      let chars = 0;
      let shown = 0;
      for (const e of entries) {
        const p = path ? `${path}/${e.path}` : e.path;
        const line = e.type === 'tree' ? `${p}/` : e.type === 'commit' ? `${p} (submodule)` : `${p} · ${formatBytes(e.size ?? 0)}`;
        if (chars + line.length + 1 > PAGE_CHARS - 400) break;
        lines.push(line);
        chars += line.length + 1;
        shown++;
      }
      const notes = [
        shown < entries.length ? `…and ${entries.length - shown} more. Narrow it down with "path" (a folder).` : '',
        tree.truncated ? 'GitHub cut this listing short because the repository is very large — list a folder with "path".' : '',
      ].filter(Boolean);
      return [`[${repo}@${ref}${path ? ` /${path}` : ''} · ${files} files, ${entries.length - files} folders]`, ...lines, ...notes].join('\n');
    },
  },
  'github.read_file': {
    service: 'github',
    kind: 'read',
    description:
      'Read a text file from a repository. Long files come in pages of whole lines — the header says how to continue with "offset" (line number). Binary files (images, PDFs…) are described, not shown.',
    params: '{"repo":"owner/name","path":"file/path","ref":"optional branch","offset":"optional start line","limit":"optional number of lines"}',
    label: (a) => `Read ${a.path ?? 'a file'} on GitHub`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const path = pathArg(a.path, true);
      const ref = str(a.ref ?? a.branch);
      const data = await gh(s, contentsUrl(repo, path, ref), { what: where(repo, path, ref) });
      if (Array.isArray(data)) return `"${path}" is a folder. Its contents:\n${listing(data) || '(empty folder)'}`;
      if (data.type === 'symlink') return `${path} is a symbolic link to ${data.target}.`;
      if (data.type === 'submodule') return `${path} is a submodule pointing to ${data.submodule_git_url} at ${String(data.sha).slice(0, 7)}.`;
      const label = `${repo}@${ref ?? refOf(data) ?? 'default'} ${data.path}`;
      const binary = () =>
        `${data.path} is a binary file (${mimeOf(data.name) ?? 'unknown type'}, ${formatBytes(data.size)}), so it can't be shown as text. ` +
        `To give the user the file itself, send it with files.send ("fromGithub"). On GitHub: ${data.html_url}`;
      // Don't download big binaries just to say they're binary.
      if (hasBinaryExtension(data.name) && !data.content) return binary();
      const bytes = await contentBytes(s, repo, data);
      if (looksBinary(data.name, bytes)) return binary();
      return textPage(label, data.size, decodeText(bytes), a.offset, a.limit);
    },
  },
  'github.search_code': {
    service: 'github',
    kind: 'read',
    description:
      'Search code in repositories (the pinned repos unless "repo" is given). Words must all appear; qualifiers like path:src or extension:ts work. Falls back to reading the files directly when GitHub\'s index can\'t help (other branches, new repos).',
    params: '{"query":"useState","repo":"optional owner/name","path":"optional/folder","extension":"optional ts","ref":"optional branch"}',
    label: (a) => `Searched code for “${a.query ?? ''}”`,
    run: async (s, a) => {
      const query = str(a.query);
      if (!query) throw new Error('Missing "query" — the words or identifier to look for.');
      const { quals } = parseQuery(query);
      const repos = a.repo ? [repoArg(s, a)] : quals.repo ? [normalizeRepo(quals.repo) ?? quals.repo] : s.repos;
      const folder = pathArg(a.path ?? quals.path, false);
      const ext = str(a.extension) ?? quals.extension;
      const ref = str(a.ref ?? a.branch);
      const single = repos.length === 1 ? repos[0] : undefined;
      // GitHub's index only covers default branches, so another branch is searched directly.
      if (ref && single) return scanRepo(s, single, ref, query, folder, ext);
      const q = [
        query,
        ...(quals.repo ? [] : repos.map((r) => `repo:${r}`)),
        folder && !quals.path ? `path:${folder}` : '',
        ext && !quals.extension ? `extension:${ext.replace(/^\./, '')}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      let reason: string;
      try {
        const res = await gh(s, `/search/code?q=${encodeURIComponent(q)}&per_page=20`, {
          accept: 'application/vnd.github.text-match+json',
          what: 'code search',
        });
        const items: any[] = res.items ?? [];
        if (items.length) {
          const lines = items.map((it) => {
            const frags = (it.text_matches ?? [])
              .slice(0, 2)
              .map((m: any) => `  …${clip(String(m.fragment).replace(/\s+/g, ' '), 200)}…`)
              .join('\n');
            return `${it.path} (${it.repository?.full_name})${frags ? `\n${frags}` : ''}`;
          });
          const more = res.total_count > items.length ? `\n${res.total_count - items.length} more results — refine the query (path:, extension:).` : '';
          return `[${res.total_count} result${res.total_count === 1 ? '' : 's'} for ${q}${res.incomplete_results ? ', incomplete' : ''}]\n${lines.join('\n')}${more}`;
        }
        reason = 'GitHub\'s code search found nothing (its index may not include this repository yet)';
      } catch (e) {
        reason = `GitHub's code search isn't available (${e instanceof Error ? e.message : e})`;
      }
      if (!single) {
        throw new Error(`${reason}. Give "repo" to search one repository's files directly${repos.length ? ` (pinned: ${repos.join(', ')})` : ''}.`);
      }
      return `${reason}.\n${await scanRepo(s, single, undefined, query, folder, ext)}`;
    },
  },
  'github.list_branches': {
    service: 'github',
    kind: 'read',
    description: 'List the branches of a repository (the default branch is marked).',
    params: '{"repo":"owner/name","page":"optional 2, 3…"}',
    label: (a) => `Listed branches of ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const page = posInt(a.page) ?? 1;
      const [info, { data, next }] = await Promise.all([
        repoInfo(s, repo).catch(() => null),
        ghPage<any[]>(s, `/repos/${repo}/branches?per_page=100&page=${page}`, { what: `branches of ${repo}` }),
      ]);
      if (!data.length) return page > 1 ? 'No more branches.' : `${repo} has no branches yet (empty repository).`;
      const lines = data.map(
        (b) => `${b.name}${b.name === info?.default_branch ? ' (default)' : ''}${b.protected ? ' (protected)' : ''} · ${String(b.commit?.sha).slice(0, 7)}`,
      );
      return `[${repo} branches${page > 1 ? `, page ${page}` : ''}]\n${lines.join('\n')}${next ? `\nMore: {"page":${page + 1}}` : ''}`;
    },
  },
  'github.read_pull_request': {
    service: 'github',
    kind: 'read',
    description: 'Read a pull request: description, status, changed files and a summary of the diff ("file" shows one file\'s full diff).',
    params: '{"repo":"owner/name","number":12,"file":"optional path to show in full"}',
    label: (a) => `Read PR #${a.number ?? '?'} in ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const n = numberArg(a);
      const what = `pull request #${n} in ${repo}`;
      const pr = await gh(s, `/repos/${repo}/pulls/${n}`, { what });
      const files: any[] = [];
      for (let page = 1; page <= 3; page++) {
        const { data, next } = await ghPage<any[]>(s, `/repos/${repo}/pulls/${n}/files?per_page=100&page=${page}`, { what });
        files.push(...data);
        if (!next) break;
      }
      const state = pr.merged_at ? `merged ${day(pr.merged_at)}` : pr.draft ? `draft, ${pr.state}` : pr.state;
      const mergeable = pr.mergeable === true ? 'yes' : pr.mergeable === false ? `no (${pr.mergeable_state})` : 'not computed yet';
      const head = [
        `PR #${pr.number}: ${pr.title} [${state}]`,
        `${pr.user?.login} wants to merge ${pr.head?.label} into ${pr.base?.ref} · opened ${day(pr.created_at)} · updated ${day(pr.updated_at)}`,
        `+${pr.additions} −${pr.deletions} in ${pr.changed_files} file${pr.changed_files === 1 ? '' : 's'} · ${pr.commits} commit${pr.commits === 1 ? '' : 's'} · ${pr.comments + pr.review_comments} comments · mergeable: ${mergeable}`,
        pr.html_url,
        pr.body ? `\nDescription:\n${clip(pr.body, 1500)}` : '',
      ].filter(Boolean);
      const STATUS: Record<string, string> = { added: 'A', removed: 'D', modified: 'M', renamed: 'R', copied: 'C', changed: 'M' };
      const fileLines = files.map(
        (f) => `${STATUS[f.status] ?? '?'} ${f.previous_filename ? `${f.previous_filename} → ` : ''}${f.filename} (+${f.additions} −${f.deletions})`,
      );
      const only = str(a.file);
      let budget = PAGE_CHARS - head.join('\n').length - fileLines.join('\n').length - 200;
      const diffs: string[] = [];
      for (const f of only ? files.filter((x) => x.filename === only || x.filename.endsWith('/' + only)) : files) {
        if (budget < 300) {
          diffs.push('…more diffs left out; ask for one with "file".');
          break;
        }
        const patch: string = f.patch ?? '';
        const cap = only ? budget : Math.min(budget, 2500);
        const body = !patch ? '(no diff shown: binary or too large)' : patch.length > cap ? patch.slice(0, cap) + '\n…[diff cut]' : patch;
        diffs.push(`--- ${f.filename}\n${body}`);
        budget -= body.length + f.filename.length + 6;
      }
      if (only && !diffs.length) diffs.push(`No changed file matches "${only}".`);
      return [...head, `\nFiles (${files.length}${pr.changed_files > files.length ? ` of ${pr.changed_files}` : ''}):`, ...fileLines, '\nDiff:', ...diffs].join('\n');
    },
  },
  'github.list_issues': {
    service: 'github',
    kind: 'read',
    description: 'List issues and pull requests of a repository.',
    params: '{"repo":"owner/name","state":"open|closed|all","labels":"optional bug,ui","page":"optional 2, 3…"}',
    label: (a) => `Listed issues in ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const state = ['open', 'closed', 'all'].includes(a.state) ? a.state : 'open';
      const page = posInt(a.page) ?? 1;
      const labels = str(a.labels) ? `&labels=${encodeURIComponent(a.labels)}` : '';
      const { data, next } = await ghPage<any[]>(s, `/repos/${repo}/issues?state=${state}&per_page=30&page=${page}${labels}`, { what: `issues of ${repo}` });
      if (!data.length) return page > 1 ? 'No more issues.' : `No ${state === 'all' ? '' : state + ' '}issues in ${repo}.`;
      const lines = data.map((i) => {
        const tags = (i.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
        return `#${i.number} ${i.title}${i.pull_request ? ' (PR)' : ''}${state === 'all' ? ` [${i.state}]` : ''}${tags.length ? ` {${tags.join(', ')}}` : ''} · ${i.user?.login} · ${i.comments} comments`;
      });
      return `${lines.join('\n')}${next ? `\nMore: {"page":${page + 1}}` : ''}`;
    },
  },
  'github.read_issue': {
    service: 'github',
    kind: 'read',
    description: 'Read an issue (or a pull request\'s conversation) with its latest comments.',
    params: '{"repo":"owner/name","number":12}',
    label: (a) => `Read #${a.number ?? '?'} in ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const n = numberArg(a);
      const issue = await gh(s, `/repos/${repo}/issues/${n}`, { what: `issue #${n} in ${repo}` });
      const comments: any[] = issue.comments
        ? await gh(s, `/repos/${repo}/issues/${n}/comments?per_page=100`, { what: `comments on #${n}` })
        : [];
      const latest = comments.slice(-10);
      return [
        `#${issue.number}: ${issue.title} [${issue.state}${issue.state_reason ? `, ${issue.state_reason}` : ''}]${issue.pull_request ? ' (pull request — github.read_pull_request shows its changes)' : ''}`,
        `by ${issue.user?.login} · ${day(issue.created_at)} · ${issue.html_url}`,
        clip(issue.body, 3000) || '(no description)',
        comments.length ? `\nComments (${comments.length}${comments.length > latest.length ? `, latest ${latest.length}` : ''}):` : '',
        ...latest.map((c) => `- ${c.user?.login} (${day(c.created_at)}): ${clip(c.body, 600)}`),
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  'github.write_file': {
    service: 'github',
    kind: 'write',
    description: 'Create or update a file in a repository (commits directly to the branch; default branch if none given).',
    params: '{"repo":"owner/name","path":"file/path","content":"full new file content","message":"commit message","branch":"optional"}',
    label: (a) => `Commit ${a.path ?? 'a file'} to ${a.repo ?? 'the repo'}${a.branch ? `@${a.branch}` : ''}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const path = pathArg(a.path, true);
      if (typeof a.content !== 'string') throw new Error('Missing "content" — give the complete new file text as a string ("" for an empty file).');
      const branch = str(a.branch);
      let existing: any = null;
      try {
        existing = await gh(s, contentsUrl(repo, path, branch), { what: where(repo, path, branch) });
      } catch (e) {
        if (!(e instanceof GitHubError && e.status === 404)) throw e;
        if (/No commit found/i.test(e.githubMessage)) throw new Error(`Branch "${branch}" doesn't exist in ${repo}. Create it first with github.create_branch.`);
        existing = null; // a new file
      }
      if (Array.isArray(existing) || (existing && existing.type !== 'file')) throw new Error(`${path} is a ${Array.isArray(existing) ? 'folder' : existing.type}; give a file path.`);
      const content = utf8ToBase64(a.content);
      if (existing?.content && existing.encoding === 'base64' && existing.content.replace(/\s/g, '') === content) {
        return `No change: ${path} already has exactly this content.`;
      }
      const res = await gh(s, `/repos/${repo}/contents/${encodePath(path)}`, {
        method: 'PUT',
        body: { message: str(a.message) ?? `${existing ? 'Update' : 'Create'} ${path}`, content, sha: existing?.sha, branch },
        what: where(repo, path, branch),
      });
      return `${existing ? 'Updated' : 'Created'} ${path} in commit ${String(res.commit?.sha).slice(0, 7)}${branch ? ` on ${branch}` : ''}: ${res.commit?.html_url}`;
    },
  },
  'github.create_branch': {
    service: 'github',
    kind: 'write',
    description: 'Create a branch (from the default branch unless "from" names a branch, tag or commit).',
    params: '{"repo":"owner/name","branch":"new-branch-name","from":"optional base"}',
    label: (a) => `Create branch ${a.branch ?? ''} in ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const branch = str(a.branch)?.replace(/^refs\/heads\//, '');
      if (!branch || /[\s~^:?*[\\]|\.\.|@\{|^[-/.]|[/.]$|\.lock$|\/\//.test(branch)) {
        throw new Error('Give a valid "branch" name, like "fix-login" or "feature/search" (no spaces or ~^:?*[\\).');
      }
      const from = str(a.from) ?? (await defaultBranch(s, repo));
      const { text: sha } = await ghRaw(s, `/repos/${repo}/commits/${encodePath(from)}`, {
        accept: 'application/vnd.github.sha',
        what: `"${from}" in ${repo}`,
      });
      try {
        await gh(s, `/repos/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: sha.trim() }, what: `branch ${branch}` });
      } catch (e) {
        if (e instanceof GitHubError && e.status === 422 && /already exists/i.test(e.message)) throw new Error(`A branch named "${branch}" already exists in ${repo}.`);
        throw e;
      }
      return `Created branch ${branch} from ${from} (${sha.trim().slice(0, 7)}) in ${repo}.`;
    },
  },
  'github.create_pull_request': {
    service: 'github',
    kind: 'write',
    description: 'Open a pull request from "head" into "base" (default branch unless given).',
    params: '{"repo":"owner/name","title":"...","head":"branch-with-changes","base":"optional","body":"optional description","draft":false}',
    label: (a) => `Open PR “${a.title ?? ''}” in ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const title = str(a.title);
      const head = str(a.head ?? a.branch);
      if (!title) throw new Error('Missing "title".');
      if (!head) throw new Error('Missing "head" — the branch with the changes.');
      const base = str(a.base) ?? (await defaultBranch(s, repo));
      const pr = await gh(s, `/repos/${repo}/pulls`, {
        method: 'POST',
        body: { title, head, base, body: typeof a.body === 'string' ? a.body : undefined, draft: a.draft === true },
        what: `pull request ${head} → ${base}`,
      });
      return `Opened PR #${pr.number} (${head} → ${base}): ${pr.html_url}`;
    },
  },
  'github.comment': {
    service: 'github',
    kind: 'write',
    description: 'Comment on an issue or pull request.',
    params: '{"repo":"owner/name","number":12,"body":"comment text (Markdown)"}',
    label: (a) => `Comment on #${a.number ?? '?'} in ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const n = numberArg(a);
      const body = str(a.body);
      if (!body) throw new Error('Missing "body" — the comment text.');
      const c = await gh(s, `/repos/${repo}/issues/${n}/comments`, { method: 'POST', body: { body }, what: `#${n} in ${repo}` });
      return `Commented on #${n}: ${c.html_url}`;
    },
  },
  'github.create_issue': {
    service: 'github',
    kind: 'write',
    description: 'Open a new issue.',
    params: '{"repo":"owner/name","title":"...","body":"...","labels":["optional"]}',
    label: (a) => `Open issue “${a.title ?? ''}” in ${a.repo ?? 'the repo'}`,
    run: async (s, a) => {
      const repo = repoArg(s, a);
      const title = str(a.title);
      if (!title) throw new Error('Missing "title".');
      const labels = Array.isArray(a.labels) ? a.labels.filter((l: unknown) => typeof l === 'string') : undefined;
      const issue = await gh(s, `/repos/${repo}/issues`, {
        method: 'POST',
        body: { title, body: typeof a.body === 'string' ? a.body : undefined, labels },
        what: `new issue in ${repo}`,
      });
      return `Opened #${issue.number}: ${issue.html_url}`;
    },
  },
};
