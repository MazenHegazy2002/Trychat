import type {
  Plugin,
  PluginAgent,
  PluginCommand,
  PluginConfigField,
  PluginMcpServer,
  PluginSkill,
} from './types';
import { parseGithubLink } from './skills';

/**
 * Installs Claude Code–format plugins and marketplaces from GitHub.
 *
 * Supported inputs (same link forms as skill import): https://github.com/owner/repo[.git],
 * github.com/owner/repo/tree/<ref>/<path>, owner/repo.
 *
 * Plugin layout (plugin root): optional .claude-plugin/plugin.json (name, displayName, version,
 * description, author{name}, homepage, userConfig, and component keys: skills, commands, agents,
 * mcpServers, hooks, lspServers, outputStyles…); default dirs skills/<name>/SKILL.md, commands/*.md,
 * agents/*.md (subfolders become part of the agent name), .mcp.json, hooks/hooks.json, .lsp.json, bin/.
 * A plugin with SKILL.md at its root and no skills/ loads as one skill.
 *
 * Marketplace: .claude-plugin/marketplace.json { name, owner{name}, description?, metadata{pluginRoot?},
 * plugins: [{ name, source, description?, version?, displayName?, category?, strict?, + any plugin.json
 * component fields }] } where source is "./relative/path", {source:'github', repo, ref?, sha?},
 * {source:'git-subdir', url, path, ref?}, {source:'url', url, ref?} (only GitHub URLs supported here),
 * or archive/npm/command (unsupported on mobile).
 *
 * GitHub access: one GET /repos/{o}/{r} (default branch) and one recursive tree listing per repo+ref,
 * then file contents from raw.githubusercontent.com, at most 6 downloads at a time.
 */

export interface MarketplaceEntry {
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  category?: string;
  /** False when the source type can't be installed from the phone (npm, archive, command, non-GitHub git). */
  supported: boolean;
  /** Why it isn't supported. */
  reason?: string;
  /** Opaque data the installer needs (original entry + resolved source). */
  raw: unknown;
}

export interface MarketplaceInfo {
  name: string;
  description?: string;
  owner?: string;
  /** The link the user entered. */
  source: string;
  entries: MarketplaceEntry[];
}

export type InstallTarget = { kind: 'plugin'; plugin: Plugin } | { kind: 'marketplace'; marketplace: MarketplaceInfo };

// ---------------------------------------------------------------------------------------------
// Limits and small helpers
// ---------------------------------------------------------------------------------------------

/** Files bigger than this are skipped (and listed as skipped). */
export const MAX_FILE_BYTES = 200 * 1024;
/** At most this many skills, commands and agents (each) per plugin. */
export const MAX_ITEMS = 200;
/** Parallel raw-file downloads. */
const CONCURRENCY = 6;

const TOKEN_HINT = 'Add a GitHub token in Settings → Connections';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trimmed non-empty string (numbers are accepted and stringified). */
const str = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
};

const toArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const strings = (v: unknown): string[] => toArray(v).filter((x): x is string => typeof x === 'string' && !!x.trim());
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Name usable in "/plugin:command" and "plugin:skill" (letters, digits, _ . -). */
function slug(name: string | undefined, lower = false): string | undefined {
  if (!name) return undefined;
  const s = (lower ? name.toLowerCase() : name)
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return s || undefined;
}

/** The link as the user entered it, trimmed and without a trailing slash or .git. */
const cleanLink = (link: string) => link.trim().replace(/\/+$/, '').replace(/\.git$/i, '');

// ---------------------------------------------------------------------------------------------
// Paths inside a repo ("" is the repo root; never a leading or trailing slash)
// ---------------------------------------------------------------------------------------------

const hasDotDot = (p: string) => p.split(/[\\/]+/).includes('..');

function joinPath(...parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) {
    for (const seg of part.split(/[\\/]+/)) {
      if (!seg || seg === '.') continue;
      if (seg === '..') throw new Error(`The path "${part}" points outside the plugin folder (".." isn’t allowed).`);
      out.push(seg);
    }
  }
  return out.join('/');
}

const dirname = (p: string) => p.split('/').slice(0, -1).join('/');
const basename = (p: string) => p.split('/').pop() ?? '';
const isUnder = (dir: string, path: string) => !dir || path.startsWith(`${dir}/`);
const relTo = (dir: string, path: string) => (dir ? path.slice(dir.length + 1) : path);
const isMd = (p: string) => /\.md$/i.test(p);
const isSkillMd = (p: string) => /^skill\.md$/i.test(basename(p));
const mdName = (p: string) => basename(p).replace(/\.md$/i, '');
/** Docs that sit next to commands/agents and aren't components (README in any case, the rest in caps). */
const isDocFile = (p: string) =>
  /^readme(\.[\w-]+)?\.md$/i.test(basename(p)) ||
  /^(LICEN[CS]E|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)(\.[\w-]+)?\.md$/.test(basename(p));

/** A component path from a manifest ("./x", relative to the plugin root). ".." is rejected. */
function pluginPath(root: string, p: string): string {
  if (hasDotDot(p)) {
    throw new Error(`The plugin path "${p}" isn’t allowed: paths must stay inside the plugin folder (no "..").`);
  }
  return joinPath(root, p.trim());
}

// ---------------------------------------------------------------------------------------------
// GitHub access
// ---------------------------------------------------------------------------------------------

interface RepoTree {
  owner: string;
  repo: string;
  /** Branch, tag or commit the files were listed at. */
  ref: string;
  /** Blob path → size in bytes. */
  files: Map<string, number>;
  dirs: Set<string>;
  /** GitHub cut the recursive listing short (very large repos); see Ctx.fill. */
  truncated: boolean;
  /** Folders listed separately after truncation. */
  filled: Set<string>;
}

const hasFile = (t: RepoTree, p: string) => t.files.has(p);
const hasDir = (t: RepoTree, p: string) => p === '' || t.dirs.has(p);

function filesUnder(t: RepoTree, dir: string): string[] {
  const out: string[] = [];
  for (const p of t.files.keys()) if (isUnder(dir, p)) out.push(p);
  return out.sort();
}

/** Like hasFile, but ignores the case of the file name (SKILL.md vs skill.md). */
function findFileCaseless(t: RepoTree, dir: string, file: string): string | undefined {
  const exact = joinPath(dir, file);
  if (t.files.has(exact)) return exact;
  const lower = exact.toLowerCase();
  for (const p of t.files.keys()) if (p.toLowerCase() === lower) return p;
  return undefined;
}

interface Ctx {
  tree(owner: string, repo: string, ref?: string): Promise<RepoTree>;
  /** File contents, or null when the file is over MAX_FILE_BYTES. */
  read(tree: RepoTree, path: string): Promise<string | null>;
  /** When the repo listing was truncated, lists `path` on its own so the plugin there is complete. */
  fill(tree: RepoTree, path: string): Promise<void>;
}

/** Adds GitHub tree items (paths relative to `prefix`) to a listing. */
function addTreeItems(tree: RepoTree, items: unknown[], prefix: string) {
  for (const item of items) {
    if (!isObj(item) || typeof item.path !== 'string') continue;
    const path = prefix ? `${prefix}/${item.path}` : item.path;
    if (item.type === 'blob') {
      tree.files.set(path, typeof item.size === 'number' ? item.size : 0);
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) tree.dirs.add(parts.slice(0, i).join('/'));
    } else if (item.type === 'tree') {
      tree.dirs.add(path);
    }
  }
}

function rateLimitError(token?: string): Error {
  return new Error(
    token
      ? 'GitHub’s rate limit was reached. Wait a few minutes and try again.'
      : `GitHub’s limit for requests without a token was reached. ${TOKEN_HINT}, or try again later.`,
  );
}

async function httpError(res: Response, token: string | undefined, notFound: string): Promise<Error> {
  let message = '';
  try {
    const text = await res.text();
    try {
      const json: unknown = JSON.parse(text);
      if (isObj(json) && typeof json.message === 'string') message = json.message;
    } catch {
      message = text.slice(0, 200);
    }
  } catch {
    // no body
  }
  const remaining = res.headers?.get?.('x-ratelimit-remaining');
  if (res.status === 429 || (res.status === 403 && (/rate limit/i.test(message) || remaining === '0'))) {
    return rateLimitError(token);
  }
  if (res.status === 401) return new Error('GitHub didn’t accept your token. Update it in Settings → Connections.');
  if (res.status === 404) return new Error(notFound);
  if (res.status === 403) return new Error(`GitHub refused access${message ? `: ${message}` : ''}.`);
  return new Error(`GitHub error ${res.status}${message ? `: ${message}` : ''}.`);
}

/** Runs at most `max` tasks at once; a finished task hands its slot straight to the next one. */
function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

function createCtx(token?: string): Ctx {
  const limit = createLimiter(CONCURRENCY);
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const branches = new Map<string, Promise<string>>();
  const trees = new Map<string, Promise<RepoTree>>();
  const texts = new Map<string, Promise<string | null>>();

  async function request(url: string, headers: Record<string, string>, notFound: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch {
      throw new Error('Couldn’t reach GitHub. Check your internet connection and try again.');
    }
    if (!res.ok) throw await httpError(res, token, notFound);
    return res;
  }

  async function api(path: string, notFound: string): Promise<unknown> {
    const res = await request(`https://api.github.com${path}`, { Accept: 'application/vnd.github+json', ...auth }, notFound);
    try {
      return await res.json();
    } catch {
      throw new Error('GitHub sent a response TryChat couldn’t read. Try again.');
    }
  }

  const repoNotFound = (owner: string, repo: string) =>
    `Repository ${owner}/${repo} wasn’t found. Check the link (private repos need a GitHub token in Settings → Connections).`;

  function defaultBranch(owner: string, repo: string): Promise<string> {
    const key = `${owner}/${repo}`.toLowerCase();
    let p = branches.get(key);
    if (!p) {
      p = api(`/repos/${owner}/${repo}`, repoNotFound(owner, repo)).then((json) => {
        const branch = isObj(json) ? str(json.default_branch) : undefined;
        if (!branch) throw new Error(`Couldn’t find the default branch of ${owner}/${repo}.`);
        return branch;
      });
      branches.set(key, p);
    }
    return p;
  }

  const refNotFound = (owner: string, repo: string, ref: string) =>
    `Couldn’t find “${ref}” in ${owner}/${repo}. Check the link (private repos need a GitHub token in Settings → Connections).`;
  const treeItems = (json: unknown): unknown[] => (isObj(json) && Array.isArray(json.tree) ? json.tree : []);

  async function loadTree(owner: string, repo: string, ref: string): Promise<RepoTree> {
    const json = await api(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, refNotFound(owner, repo, ref));
    const tree: RepoTree = {
      owner,
      repo,
      ref,
      files: new Map(),
      dirs: new Set(),
      truncated: isObj(json) && json.truncated === true,
      filled: new Set(),
    };
    addTreeItems(tree, treeItems(json), '');
    return tree;
  }

  /** Walks down to `path` one level at a time, then lists that folder recursively. */
  async function fillTree(tree: RepoTree, path: string): Promise<void> {
    let sha = tree.ref;
    const segments = path.split('/');
    for (let i = 0; i < segments.length; i++) {
      const json = await api(
        `/repos/${tree.owner}/${tree.repo}/git/trees/${encodeURIComponent(sha)}`,
        refNotFound(tree.owner, tree.repo, tree.ref),
      );
      const item = treeItems(json).find((x) => isObj(x) && x.path === segments[i] && x.type === 'tree');
      if (!isObj(item) || typeof item.sha !== 'string') return;
      sha = item.sha;
      tree.dirs.add(segments.slice(0, i + 1).join('/'));
    }
    const json = await api(`/repos/${tree.owner}/${tree.repo}/git/trees/${sha}?recursive=1`, refNotFound(tree.owner, tree.repo, tree.ref));
    addTreeItems(tree, treeItems(json), path);
  }

  return {
    async tree(owner, repo, ref) {
      const r = ref || (await defaultBranch(owner, repo));
      const key = `${owner}/${repo}@${r}`.toLowerCase();
      let p = trees.get(key);
      if (!p) {
        p = loadTree(owner, repo, r);
        trees.set(key, p);
      }
      return p;
    },
    async fill(tree, path) {
      if (!tree.truncated || !path || tree.filled.has(path)) return;
      tree.filled.add(path);
      await fillTree(tree, path);
    },
    read(tree, path) {
      const size = tree.files.get(path);
      if (size !== undefined && size > MAX_FILE_BYTES) return Promise.resolve(null);
      const key = `${tree.owner}/${tree.repo}@${tree.ref}:${path}`.toLowerCase();
      let p = texts.get(key);
      if (!p) {
        const url = `https://raw.githubusercontent.com/${tree.owner}/${tree.repo}/${tree.ref
          .split('/')
          .map(encodeURIComponent)
          .join('/')}/${path.split('/').map(encodeURIComponent).join('/')}`;
        p = limit(async () => {
          const res = await request(url, auth, `Couldn’t download ${path} from ${tree.owner}/${tree.repo} (not found).`);
          const text = await res.text();
          return text.length > MAX_FILE_BYTES ? null : text;
        });
        texts.set(key, p);
      }
      return p;
    },
  };
}

async function readJson(ctx: Ctx, tree: RepoTree, path: string): Promise<unknown> {
  const text = await ctx.read(tree, path);
  if (text === null) throw new Error(`${path} is too large (over 200 KB).`);
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`${path} isn’t valid JSON (${errorMessage(e)}).`);
  }
}

// ---------------------------------------------------------------------------------------------
// Front matter (the small YAML subset Claude Code files use)
// ---------------------------------------------------------------------------------------------

export type FrontmatterValue = string | string[];

export interface Frontmatter {
  data: Record<string, FrontmatterValue>;
  /** The value text exactly as written on the key's line (e.g. "[pr-number] [priority]"). */
  raw: Record<string, string>;
  body: string;
}

const indentOf = (line: string) => line.length - line.trimStart().length;

function readQuoted(s: string): { value: string; rest: string } | null {
  const q = s[0];
  let out = '';
  let i = 1;
  if (q === "'") {
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return { value: out, rest: s.slice(i + 1) };
      }
      out += s[i++];
    }
    return null;
  }
  const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ' };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1] ?? '';
      if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      out += escapes[n] ?? n;
      i += 2;
      continue;
    }
    if (c === '"') return { value: out, rest: s.slice(i + 1) };
    out += c;
    i++;
  }
  return null;
}

/** Joins the lines of a multi-line plain or quoted scalar: line breaks fold to spaces, blank lines to "\n". */
function foldLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out += '\n';
      continue;
    }
    if (out && !out.endsWith('\n')) out += ' ';
    out += line;
  }
  return out;
}

function blockScalar(lines: string[], folded: boolean): string {
  const content = [...lines];
  while (content.length && !content[content.length - 1].trim()) content.pop();
  const nonEmpty = content.filter((l) => l.trim());
  if (!nonEmpty.length) return '';
  const indent = Math.min(...nonEmpty.map(indentOf));
  const stripped = content.map((l) => l.slice(Math.min(indent, indentOf(l))));
  if (!folded) return stripped.join('\n');
  let out = '';
  for (const line of stripped) {
    if (!line.trim()) {
      out += '\n';
      continue;
    }
    if (out && !out.endsWith('\n')) out += /^\s/.test(line) ? '\n' : ' ';
    out += line;
  }
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (/^["']/.test(t)) return readQuoted(t)?.value ?? t;
  return t;
}

function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = '';
      cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map(unquote).filter(Boolean);
}

/**
 * Parses "---" front matter: `key: value`, quoted values, `[a, b]` and `- item` lists, multi-line
 * plain scalars and `|` / `>` block scalars. Nested maps are ignored.
 */
export function parseFrontmatter(md: string): Frontmatter {
  const text = md.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = text.match(/^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/);
  if (!m) return { data: {}, raw: {}, body: text };
  const data: Record<string, FrontmatterValue> = {};
  const raw: Record<string, string> = {};
  const lines = (m[1] ?? '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    if (!line.trim() || /^\s/.test(line) || /^#/.test(line)) continue;
    const km = line.match(/^(["']?)([\w.-]+)\1[ \t]*:(?:[ \t]+(.*))?$/);
    if (!km) continue;
    const key = km[2];
    const value = (km[3] ?? '').trim();
    // Following lines that belong to this key: indented, blank, or "- item" right under an empty value.
    const cont: string[] = [];
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim() || /^\s/.test(next) || (value === '' && /^-(\s|$)/.test(next))) {
        cont.push(next);
        i++;
      } else break;
    }
    raw[key] = value;
    const block = value.match(/^([|>])[+-]?\d*[+-]?\s*(#.*)?$/);
    if (block) {
      data[key] = blockScalar(cont, block[1] === '>');
    } else if (value === '') {
      const items = cont.map((l) => l.trim()).filter(Boolean);
      if (items.length && items.every((l) => /^-(\s|$)/.test(l))) {
        data[key] = items.map((l) => unquote(l.replace(/^-\s*/, ''))).filter(Boolean);
      } else if (items.length && !items.some((l) => /^[\w.-]+\s*:(\s|$)/.test(l))) {
        data[key] = foldLines(cont);
      } else {
        data[key] = '';
      }
    } else if (/^["']/.test(value)) {
      const joined = cont.length ? foldLines([value, ...cont]) : value;
      data[key] = readQuoted(joined)?.value ?? joined;
      raw[key] = data[key] as string;
    } else if (/^\[[^[\]]*\]$/.test(value)) {
      data[key] = splitFlow(value.slice(1, -1));
    } else {
      const first = value.replace(/\s+#.*$/, '');
      data[key] = cont.length ? foldLines([first, ...cont]) : first;
    }
  }
  return { data, raw, body: text.slice(m[0].length) };
}

const fmString = (v: FrontmatterValue | undefined): string | undefined =>
  Array.isArray(v) ? str(v.join(', ')) : str(v);

/** First meaningful line of a Markdown body (headings lose their #), for missing descriptions. */
function firstLine(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t && !/^(```|---|<!--)/.test(t)) return t.length > 200 ? `${t.slice(0, 197)}…` : t;
  }
  return '';
}

// ---------------------------------------------------------------------------------------------
// Plugin parsing
// ---------------------------------------------------------------------------------------------

const COMPONENT_KEYS = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
  'lspServers',
  'outputStyles',
  'workflows',
  'experimental',
] as const;

const declaresComponents = (o: Obj | undefined) => !!o && COMPONENT_KEYS.some((k) => o[k] !== undefined);

const CONFIG_TYPES: PluginConfigField['type'][] = ['string', 'number', 'boolean', 'directory', 'file'];

function parseUserConfig(value: unknown): PluginConfigField[] {
  if (!isObj(value)) return [];
  const fields: PluginConfigField[] = [];
  for (const [key, f] of Object.entries(value)) {
    if (!isObj(f)) continue;
    const type = CONFIG_TYPES.find((t) => t === f.type) ?? 'string';
    const field: PluginConfigField = { key, type, title: str(f.title) ?? key, description: str(f.description) ?? '' };
    if (f.required === true) field.required = true;
    if (f.sensitive === true) field.sensitive = true;
    if (f.multiple === true) field.multiple = true;
    const d = f.default;
    if (typeof d === 'string' || typeof d === 'boolean' || (typeof d === 'number' && Number.isFinite(d))) field.default = d;
    else if (Array.isArray(d)) field.default = d.filter((x) => x !== null && x !== undefined).map(String);
    if (Array.isArray(f.options)) {
      const options = f.options
        .map((o) => (isObj(o) ? (str(o.value) ?? str(o.label)) : str(o) ?? (typeof o === 'boolean' ? String(o) : undefined)))
        .filter((o): o is string => !!o);
      if (options.length) field.options = options;
    }
    if (typeof f.min === 'number') field.min = f.min;
    if (typeof f.max === 'number') field.max = f.max;
    fields.push(field);
  }
  return fields;
}

/**
 * Combines plugin.json and a marketplace entry. Without plugin.json the entry is the manifest.
 * strict (default): plugin.json wins for metadata and the entry's components are appended.
 * strict:false: the entry is the whole definition.
 */
function buildManifest(pj: Obj | undefined, entry: Obj | undefined, strict: boolean): Obj {
  if (!pj) return { ...(entry ?? {}) };
  if (!entry) return pj;
  if (!strict) return { ...pj, ...entry };
  const m: Obj = { ...entry, ...pj };
  for (const k of COMPONENT_KEYS) {
    if (k !== 'experimental' && pj[k] !== undefined && entry[k] !== undefined) m[k] = [...toArray(pj[k]), ...toArray(entry[k])];
  }
  return m;
}

interface ParseInput {
  tree: RepoTree;
  /** Plugin folder inside the repo ("" for the repo root). */
  root: string;
  /** The marketplace entry, when installing from a marketplace. */
  entry?: Obj;
  /** Plugin name when plugin.json has none (folder or repo name). */
  fallbackName: string;
  /** Always use this name (the marketplace entry's name). */
  fixedName?: string;
  /** The part after "@" in the plugin id: marketplace name or "owner/repo". */
  idScope: string;
  marketplace?: string;
  source: string;
}

interface CommandSpec {
  name: string;
  path?: string;
  content?: string;
  description?: string;
  argumentHint?: string;
}

async function parsePlugin(ctx: Ctx, input: ParseInput): Promise<Plugin> {
  const { tree, root, entry } = input;
  const at = (p: string) => joinPath(root, p);
  const unsupported: string[] = [];
  const notes: string[] = [];
  let skippedLarge = 0;
  const read = async (path: string): Promise<string | null> => {
    const text = await ctx.read(tree, path);
    if (text === null) skippedLarge++;
    return text;
  };
  const cap = <T>(list: T[], label: string): T[] => {
    if (list.length <= MAX_ITEMS) return list;
    notes.push(`Only the first ${MAX_ITEMS} of ${list.length} ${label} were installed`);
    return list.slice(0, MAX_ITEMS);
  };

  // --- Manifest -------------------------------------------------------------------------------
  const pjPath = at('.claude-plugin/plugin.json');
  let pj: Obj | undefined;
  if (hasFile(tree, pjPath)) {
    const json = await readJson(ctx, tree, pjPath);
    if (!isObj(json)) throw new Error(`${pjPath} should contain a JSON object.`);
    pj = json;
  }
  const strict = entry?.strict !== false;
  if (entry && pj && !strict && declaresComponents(pj)) {
    throw new Error(
      `“${str(entry.name) ?? input.fallbackName}” can’t be installed: its marketplace entry sets strict: false (the entry defines the plugin), but ${pjPath} also declares components. The plugin author needs to keep only one of them.`,
    );
  }
  const m = buildManifest(pj, entry, strict);
  const name = slug(input.fixedName) ?? slug(str(m.name)) ?? slug(input.fallbackName, true) ?? 'plugin';

  // --- Skills: skills/ (always) + manifest paths; a lone root SKILL.md is one skill -------------
  const skillFiles: string[] = [];
  const addSkill = (p: string) => {
    if (!skillFiles.includes(p)) skillFiles.push(p);
  };
  const skillsDir = at('skills');
  filesUnder(tree, skillsDir).filter(isSkillMd).forEach(addSkill);
  for (const p of strings(m.skills)) {
    const dir = pluginPath(root, p);
    const direct = hasFile(tree, dir) && isSkillMd(dir) ? dir : findFileCaseless(tree, dir, 'SKILL.md');
    if (direct) {
      addSkill(direct);
      continue;
    }
    const all = filesUnder(tree, dir).filter(isSkillMd);
    const oneLevel = all.filter((f) => relTo(dir, f).split('/').length === 2);
    const found = oneLevel.length ? oneLevel : all;
    if (!found.length) notes.push(`Skills not found at ${p}`);
    found.forEach(addSkill);
  }
  if (m.skills === undefined && !hasDir(tree, skillsDir)) {
    const rootSkill = findFileCaseless(tree, root, 'SKILL.md');
    if (rootSkill) addSkill(rootSkill);
  }

  // --- Commands: manifest paths/map replace commands/ -----------------------------------------
  const commandSpecs: CommandSpec[] = [];
  const nestedName = (dir: string, f: string) => relTo(dir, f).replace(/\.md$/i, '').split('/').join(':');
  if (m.commands === undefined) {
    const dir = at('commands');
    for (const f of filesUnder(tree, dir).filter((x) => isMd(x) && !isDocFile(x))) {
      commandSpecs.push({ name: nestedName(dir, f), path: f });
    }
  } else {
    for (const item of toArray(m.commands)) {
      if (typeof item === 'string') {
        const rp = pluginPath(root, item);
        if (hasFile(tree, rp)) commandSpecs.push({ name: mdName(rp), path: rp });
        else if (hasDir(tree, rp)) {
          for (const f of filesUnder(tree, rp)) {
            if (isMd(f) && !isDocFile(f) && dirname(f) === rp) commandSpecs.push({ name: mdName(f), path: f });
          }
        } else notes.push(`Commands not found at ${item}`);
      } else if (isObj(item)) {
        for (const [cmdName, def] of Object.entries(item)) {
          const spec: CommandSpec = { name: cmdName };
          let source: string | undefined;
          if (typeof def === 'string') source = def;
          else if (isObj(def)) {
            spec.description = str(def.description);
            spec.argumentHint = str(def.argumentHint) ?? str(def['argument-hint']);
            if (typeof def.content === 'string') spec.content = def.content;
            else source = str(def.source) ?? str(def.path);
          } else continue;
          if (spec.content === undefined) {
            if (!source) {
              notes.push(`Command /${cmdName} has no source or content`);
              continue;
            }
            const rp = pluginPath(root, source);
            if (!hasFile(tree, rp)) {
              notes.push(`Command /${cmdName}: ${source} not found`);
              continue;
            }
            spec.path = rp;
          }
          commandSpecs.push(spec);
        }
      }
    }
  }

  // --- Agents: manifest file paths replace agents/ (subfolders → "folder:name") ----------------
  const agentSpecs: { path: string; prefix: string }[] = [];
  if (m.agents === undefined) {
    const dir = at('agents');
    for (const f of filesUnder(tree, dir).filter((x) => isMd(x) && !isDocFile(x))) {
      agentSpecs.push({ path: f, prefix: dirname(relTo(dir, f)).split('/').filter(Boolean).join(':') });
    }
  } else {
    for (const item of strings(m.agents)) {
      const rp = pluginPath(root, item);
      if (hasFile(tree, rp)) agentSpecs.push({ path: rp, prefix: '' });
      else if (hasDir(tree, rp)) {
        for (const f of filesUnder(tree, rp)) {
          if (isMd(f) && !isDocFile(f) && dirname(f) === rp) agentSpecs.push({ path: f, prefix: '' });
        }
      } else notes.push(`Agent not found at ${item}`);
    }
  }

  // --- Download skills, commands and agents (6 at a time, via ctx) ----------------------------
  const skillList = cap(skillFiles, 'skills');
  const commandList = cap(commandSpecs, 'commands');
  const agentList = cap(agentSpecs, 'agents');
  const [skillTexts, commandTexts, agentTexts] = await Promise.all([
    Promise.all(skillList.map(read)),
    Promise.all(commandList.map((c) => (c.path ? read(c.path) : Promise.resolve(c.content ?? '')))),
    Promise.all(agentList.map((a) => read(a.path))),
  ]);

  const skills: PluginSkill[] = [];
  skillList.forEach((path, i) => {
    const text = skillTexts[i];
    if (text === null) return;
    const { data, body } = parseFrontmatter(text);
    const dir = dirname(path);
    const skillName = fmString(data.name) ?? (dir === root ? name : basename(dir));
    if (skills.some((s) => s.name === skillName)) return;
    skills.push({ name: skillName, description: fmString(data.description) ?? firstLine(body), instructions: body.trim() });
  });

  const commands: PluginCommand[] = [];
  commandList.forEach((spec, i) => {
    const text = commandTexts[i];
    if (text === null) return;
    const cmdName = spec.name.trim().replace(/^\/+/, '').replace(/\s+/g, '-');
    if (!cmdName || commands.some((c) => c.name === cmdName)) return;
    const { data, raw, body } = parseFrontmatter(text);
    const command: PluginCommand = {
      name: cmdName,
      description: spec.description ?? fmString(data.description) ?? firstLine(body),
      content: body.trim(),
    };
    const hint = spec.argumentHint ?? str(raw['argument-hint']) ?? str(raw.argumentHint);
    if (hint) command.argumentHint = hint;
    commands.push(command);
  });

  const agents: PluginAgent[] = [];
  agentList.forEach((spec, i) => {
    const text = agentTexts[i];
    if (text === null) return;
    const { data, body } = parseFrontmatter(text);
    const base = fmString(data.name) ?? mdName(spec.path);
    const agentName = spec.prefix ? `${spec.prefix}:${base}` : base;
    if (agents.some((a) => a.name === agentName)) return;
    const agent: PluginAgent = { name: agentName, description: fmString(data.description) ?? firstLine(body), prompt: body.trim() };
    const model = fmString(data.model);
    if (model && model.toLowerCase() !== 'inherit') agent.model = model;
    agents.push(agent);
  });

  // --- MCP servers: .mcp.json first, then manifest entries (later names replace earlier) -------
  const mcpConfigs = new Map<string, unknown>();
  const addServers = (value: unknown, from: string) => {
    const map = isObj(value) && isObj(value.mcpServers) ? value.mcpServers : value;
    if (!isObj(map)) {
      notes.push(`MCP servers in ${from} couldn’t be read`);
      return;
    }
    for (const [k, cfg] of Object.entries(map)) {
      mcpConfigs.delete(k);
      mcpConfigs.set(k, cfg);
    }
  };
  const mcpJson = at('.mcp.json');
  if (hasFile(tree, mcpJson)) addServers(await readJson(ctx, tree, mcpJson), mcpJson);
  let bundles = 0;
  for (const item of toArray(m.mcpServers)) {
    if (typeof item === 'string') {
      const p = item.trim();
      if (/\.(mcpb|dxt)$/i.test(p.replace(/[?#].*$/, ''))) bundles++;
      else if (/^[a-z][\w+.-]*:\/\//i.test(p)) notes.push(`MCP servers from a URL (${p})`);
      else {
        const rp = pluginPath(root, p);
        if (hasFile(tree, rp)) addServers(await readJson(ctx, tree, rp), rp);
        else notes.push(`MCP config not found at ${p}`);
      }
    } else if (isObj(item)) addServers(item, pj ? pjPath : 'the marketplace entry');
  }

  const userConfig = parseUserConfig(m.userConfig);
  const mcpServers: PluginMcpServer[] = [];
  let stdio = 0;
  let websocket = 0;
  const needsLocalFiles = /\$\{CLAUDE_PLUGIN_(ROOT|DATA)\}/;
  // A phone has no environment: ${VAR} / ${VAR:-default} in a remote server's URL or headers
  // become plugin settings (${user_config.VAR}), filled in by the runtime like any userConfig value.
  // ${VAR} is required, ${VAR:-} optional with no default. Sensitivity ignores defaults: a token
  // with a fallback (often ${TOKEN:-}) is still a token and must never land in synced config.
  const envToConfig = (text: string, serverName: string, secretHint: boolean) =>
    text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, key: string, def: string | undefined) => {
      if (!userConfig.some((f) => f.key === key)) {
        const secret = secretHint || /token|key|secret|password|passwd|auth|credential|pat$/i.test(key);
        const field: PluginConfigField = {
          key,
          type: 'string',
          title: key.toLowerCase().replace(/_+/g, ' ').trim().replace(/^\w/, (c) => c.toUpperCase()),
          description: `Used by the “${serverName}” MCP server (the ${key} environment variable in Claude Code).`,
        };
        if (def === undefined) field.required = true;
        else if (def !== '') field.default = def;
        if (secret) field.sensitive = true;
        userConfig.push(field);
      }
      return `\${user_config.${key}}`;
    });
  for (const [serverName, cfg] of mcpConfigs) {
    if (!isObj(cfg)) continue;
    const type = str(cfg.type)?.toLowerCase();
    const url = str(cfg.url);
    if (type === 'stdio' || (!url && cfg.command !== undefined)) {
      stdio++;
      continue;
    }
    if (!url) {
      notes.push(`MCP server “${serverName}” (no URL)`);
      continue;
    }
    if (type === 'ws' || type === 'websocket' || /^wss?:/i.test(url)) {
      websocket++;
      continue;
    }
    if (type && !['http', 'sse', 'streamable-http', 'streamablehttp'].includes(type)) {
      notes.push(`MCP server “${serverName}” (${type} transport)`);
      continue;
    }
    const headers: Record<string, string> = {};
    if (isObj(cfg.headers)) {
      for (const [k, v] of Object.entries(cfg.headers)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') headers[k] = String(v);
      }
    }
    if (needsLocalFiles.test(url) || Object.values(headers).some((v) => needsLocalFiles.test(v))) {
      notes.push(`MCP server “${serverName}” (uses the plugin’s local files)`);
      continue;
    }
    if (cfg.headersHelper !== undefined) notes.push(`Header helper script for MCP server “${serverName}”`);
    for (const [k, v] of Object.entries(headers)) {
      headers[k] = envToConfig(v, serverName, /authorization|token|key|secret/i.test(k));
    }
    const server: PluginMcpServer = {
      name: serverName,
      url: envToConfig(url, serverName, false),
      transport: type === 'sse' ? 'sse' : 'http',
    };
    if (Object.keys(headers).length) server.headers = headers;
    mcpServers.push(server);
  }

  // --- Parts a phone can't run ---------------------------------------------------------------
  if (m.hooks !== undefined || hasFile(tree, at('hooks/hooks.json'))) unsupported.push('Hooks');
  if (stdio) unsupported.push(`${plural(stdio, 'local MCP server')} (stdio)`);
  if (websocket) unsupported.push(plural(websocket, 'WebSocket MCP server'));
  if (bundles) unsupported.push(bundles === 1 ? 'MCP bundle (.mcpb)' : `${bundles} MCP bundles (.mcpb)`);
  if (m.lspServers !== undefined || hasFile(tree, at('.lsp.json'))) unsupported.push('LSP servers');
  if (m.outputStyles !== undefined || hasDir(tree, at('output-styles'))) unsupported.push('Output styles');
  if (filesUnder(tree, at('bin')).length) unsupported.push('Executables (bin/)');
  if (m.workflows !== undefined) unsupported.push('Workflows');
  const experimental = toArray(m.experimental).filter(isObj);
  if (experimental.some((x) => x.themes !== undefined)) unsupported.push('Themes');
  if (experimental.some((x) => x.monitors !== undefined)) unsupported.push('Monitors');
  if (skippedLarge) unsupported.push(`${plural(skippedLarge, 'file')} over 200 KB skipped`);
  unsupported.push(...notes);

  const nothing = !skills.length && !commands.length && !agents.length && !mcpServers.length && !unsupported.length;
  if (nothing && !pj && !declaresComponents(entry)) {
    throw new Error(
      `No Claude Code plugin found in ${tree.owner}/${tree.repo}${root ? `/${root}` : ''}: no .claude-plugin/plugin.json, skills/, commands/, agents/ or .mcp.json.`,
    );
  }

  // --- Metadata -------------------------------------------------------------------------------
  // `config` only holds values the user sets; until then the runtime uses each field's default.
  const config: Plugin['config'] = {};
  const author = str(m.author) ?? (isObj(m.author) ? str(m.author.name) : undefined);
  const repoUrl = str(m.repository) ?? (isObj(m.repository) ? str(m.repository.url) : undefined);
  const homepage = str(m.homepage) ?? (repoUrl && /^https?:\/\//i.test(repoUrl) ? repoUrl : undefined);
  const now = Date.now();

  const plugin: Plugin = {
    id: `${name}@${input.idScope}`,
    name,
    description: str(m.description) ?? (skills.length === 1 ? skills[0].description : ''),
    source: input.source,
    enabled: m.defaultEnabled !== false,
    skills,
    commands,
    agents,
    mcpServers,
    userConfig,
    config,
    secrets: {},
    unsupported,
    installedAt: now,
    updatedAt: now,
  };
  const displayName = str(m.displayName);
  const version = str(m.version);
  if (displayName) plugin.displayName = displayName;
  if (version) plugin.version = version;
  if (author) plugin.author = author;
  if (homepage) plugin.homepage = homepage;
  if (input.marketplace) plugin.marketplace = input.marketplace;
  return plugin;
}

/** Folders with a plugin.json, SKILL.md, .mcp.json, hooks, or skills/commands/agents content. */
function looksLikePlugin(tree: RepoTree, dir: string): boolean {
  const at = (p: string) => joinPath(dir, p);
  return (
    hasFile(tree, at('.claude-plugin/plugin.json')) ||
    !!findFileCaseless(tree, dir, 'SKILL.md') ||
    hasFile(tree, at('.mcp.json')) ||
    hasFile(tree, at('hooks/hooks.json')) ||
    filesUnder(tree, at('skills')).some(isSkillMd) ||
    filesUnder(tree, at('commands')).some(isMd) ||
    filesUnder(tree, at('agents')).some(isMd)
  );
}

// ---------------------------------------------------------------------------------------------
// Marketplaces
// ---------------------------------------------------------------------------------------------

interface Target {
  owner: string;
  repo: string;
  /** Undefined → the repo's default branch. */
  ref?: string;
  path: string;
}

interface EntryRaw {
  entry: Obj;
  target?: Target;
  /** Listed from plugin.json files in a repo without marketplace.json. */
  synthetic?: boolean;
}

type Resolved = { target: Target } | { reason: string };

const OUTSIDE = 'Its folder is outside the marketplace (".." isn’t allowed).';

function fromGitUrl(url: string, ref?: string): Resolved {
  const u = url.trim();
  const ssh = u.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (ssh) return { target: { owner: ssh[1], repo: ssh[2], ref, path: '' } };
  if (/^(?:https?:\/\/)?(?:www\.)?github\.com\//i.test(u) || /^[\w.-]+\/[\w.-]+$/.test(u)) {
    const p = parseGithubLink(u);
    if (p && !p.file) {
      if (hasDotDot(p.path)) return { reason: OUTSIDE };
      return { target: { owner: p.owner, repo: p.repo, ref: ref ?? p.branch, path: joinPath(p.path) } };
    }
  }
  return { reason: 'Only GitHub repositories can be installed from the phone.' };
}

function resolveSource(source: unknown, tree: RepoTree, dir: string, pluginRoot?: string): Resolved {
  if (typeof source === 'string') {
    const s = source.trim();
    if (!s) return { reason: 'This entry has no source.' };
    if (/^(https?:\/\/|git@|ssh:\/\/)/i.test(s)) return fromGitUrl(s);
    if (hasDotDot(s) || (pluginRoot && hasDotDot(pluginRoot))) return { reason: OUTSIDE };
    const explicit = s === '.' || s.startsWith('./') || s.startsWith('/');
    const plain = joinPath(dir, s);
    const viaRoot = pluginRoot ? joinPath(dir, pluginRoot, s) : undefined;
    const candidates = viaRoot && viaRoot !== plain ? (explicit ? [plain, viaRoot] : [viaRoot, plain]) : [plain];
    const path = candidates.find((c) => hasDir(tree, c)) ?? (tree.truncated ? candidates[0] : undefined);
    if (path === undefined) return { reason: `The folder ${s} isn’t in the repository.` };
    return { target: { owner: tree.owner, repo: tree.repo, ref: tree.ref, path } };
  }
  if (!isObj(source)) return { reason: 'This entry has no source.' };
  const kind = str(source.source)?.toLowerCase();
  const ref = str(source.sha) ?? str(source.ref) ?? str(source.branch) ?? str(source.tag);
  const sub = str(source.path);
  if (sub && hasDotDot(sub)) return { reason: OUTSIDE };
  switch (kind) {
    case 'github': {
      const repo = str(source.repo)?.match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
      if (!repo) return { reason: 'Its GitHub repository is missing or invalid.' };
      return { target: { owner: repo[1], repo: repo[2], ref, path: sub ? joinPath(sub) : '' } };
    }
    case 'git-subdir':
    case 'url':
    case 'git': {
      const r = fromGitUrl(str(source.url) ?? str(source.repo) ?? '', ref);
      if ('target' in r && sub) r.target.path = joinPath(r.target.path, sub);
      return r;
    }
    case 'npm':
      return { reason: 'npm packages can’t be installed on a phone.' };
    case 'pip':
    case 'pypi':
      return { reason: 'Python packages can’t be installed on a phone.' };
    case 'archive':
    case 'zip':
    case 'tarball':
    case 'tar':
      return { reason: 'Archive downloads can’t be installed on a phone yet.' };
    case 'command':
      return { reason: 'This plugin is installed by running a command, which a phone can’t do.' };
    case 'local':
    case 'directory':
    case 'file':
      return { reason: 'Local folders aren’t available on a phone.' };
    default:
      return { reason: kind ? `Source type “${kind}” isn’t supported.` : 'This entry has no source.' };
  }
}

async function readMarketplace(ctx: Ctx, tree: RepoTree, dir: string, source: string): Promise<MarketplaceInfo> {
  const path = joinPath(dir, '.claude-plugin/marketplace.json');
  const json = await readJson(ctx, tree, path);
  if (!isObj(json)) throw new Error(`${path} should contain a JSON object.`);
  if (!Array.isArray(json.plugins)) throw new Error(`${path} has no "plugins" list.`);
  const metadata = isObj(json.metadata) ? json.metadata : {};
  const pluginRoot = str(metadata.pluginRoot) ?? str(json.pluginRoot);
  const entries: MarketplaceEntry[] = [];
  for (const e of json.plugins) {
    if (!isObj(e)) continue;
    const entryName = str(e.name);
    if (!entryName) continue;
    const resolved = resolveSource(e.source, tree, dir, pluginRoot);
    const entry: MarketplaceEntry = {
      name: entryName,
      supported: 'target' in resolved,
      raw: { entry: e, ...('target' in resolved ? { target: resolved.target } : {}) } satisfies EntryRaw,
    };
    const displayName = str(e.displayName);
    const description = str(e.description);
    const version = str(e.version);
    const category = str(e.category);
    if (displayName) entry.displayName = displayName;
    if (description) entry.description = description;
    if (version) entry.version = version;
    if (category) entry.category = category;
    if ('reason' in resolved) entry.reason = resolved.reason;
    entries.push(entry);
  }
  const info: MarketplaceInfo = { name: str(json.name) ?? tree.repo, source, entries };
  const description = str(json.description) ?? str(metadata.description);
  const owner = str(json.owner) ?? (isObj(json.owner) ? str(json.owner.name) : undefined);
  if (description) info.description = description;
  if (owner) info.owner = owner;
  return info;
}

function entryRaw(entry: MarketplaceEntry): (EntryRaw & { target: Target }) | undefined {
  const raw = entry.raw;
  if (!isObj(raw) || !isObj(raw.entry) || !isObj(raw.target)) return undefined;
  const t = raw.target;
  if (typeof t.owner !== 'string' || typeof t.repo !== 'string' || typeof t.path !== 'string') return undefined;
  return {
    entry: raw.entry,
    target: { owner: t.owner, repo: t.repo, path: t.path, ref: typeof t.ref === 'string' && t.ref ? t.ref : undefined },
    synthetic: raw.synthetic === true,
  };
}

async function installEntry(ctx: Ctx, marketplace: MarketplaceInfo, entry: MarketplaceEntry): Promise<Plugin> {
  const raw = entryRaw(entry);
  if (!entry.supported || !raw) {
    throw new Error(entry.reason ?? `${entry.displayName ?? entry.name} can’t be installed from the phone.`);
  }
  const { target } = raw;
  const tree = await ctx.tree(target.owner, target.repo, target.ref);
  await ctx.fill(tree, target.path);
  if (!hasDir(tree, target.path)) {
    throw new Error(`The folder ${target.path} isn’t in ${target.owner}/${target.repo}.`);
  }
  return parsePlugin(ctx, {
    tree,
    root: target.path,
    entry: raw.synthetic ? undefined : raw.entry,
    fallbackName: entry.name,
    fixedName: entry.name,
    idScope: marketplace.name,
    marketplace: raw.synthetic ? undefined : marketplace.name,
    source: marketplace.source,
  });
}

/** A link into a marketplace's plugin folder installs that entry (same id as installing it from the list). */
async function pluginFromParentMarketplace(ctx: Ctx, tree: RepoTree, dir: string, source: string): Promise<Plugin | null> {
  if (!dir) return null;
  const parts = dir.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const parent = parts.slice(0, i).join('/');
    if (!hasFile(tree, joinPath(parent, '.claude-plugin/marketplace.json'))) continue;
    let marketplace: MarketplaceInfo;
    try {
      marketplace = await readMarketplace(ctx, tree, parent, source);
    } catch {
      return null;
    }
    const entry = marketplace.entries.find((e) => {
      const t = entryRaw(e)?.target;
      return (
        e.supported &&
        !!t &&
        t.owner.toLowerCase() === tree.owner.toLowerCase() &&
        t.repo.toLowerCase() === tree.repo.toLowerCase() &&
        t.path === dir &&
        (!t.ref || t.ref === tree.ref)
      );
    });
    return entry ? installEntry(ctx, marketplace, entry) : null;
  }
  return null;
}

/** A repo without marketplace.json but with several plugin folders is offered as a list. */
async function discoverPlugins(ctx: Ctx, tree: RepoTree, dir: string, source: string): Promise<MarketplaceInfo | null> {
  const manifests = filesUnder(tree, dir)
    .filter((f) => f.endsWith('/.claude-plugin/plugin.json'))
    .slice(0, MAX_ITEMS);
  if (!manifests.length) return null;
  const entries = await Promise.all(
    manifests.map(async (f): Promise<MarketplaceEntry> => {
      const pluginDir = dirname(dirname(f));
      let pj: Obj = {};
      try {
        const json = await readJson(ctx, tree, f);
        if (isObj(json)) pj = json;
      } catch {
        // Still listed by folder name; the error shows up when it's installed.
      }
      const entryName = slug(str(pj.name)) ?? slug(basename(pluginDir), true) ?? 'plugin';
      const raw: EntryRaw = {
        entry: { name: entryName, source: `./${relTo(dir, pluginDir)}` },
        target: { owner: tree.owner, repo: tree.repo, ref: tree.ref, path: pluginDir },
        synthetic: true,
      };
      const entry: MarketplaceEntry = { name: entryName, supported: true, raw };
      const displayName = str(pj.displayName);
      const description = str(pj.description);
      const version = str(pj.version);
      if (displayName) entry.displayName = displayName;
      if (description) entry.description = description;
      if (version) entry.version = version;
      return entry;
    }),
  );
  return { name: `${tree.owner}/${tree.repo}`, owner: tree.owner, source, entries };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * Looks at a GitHub link: a marketplace (has .claude-plugin/marketplace.json) → its entries;
 * otherwise a single plugin (plugin.json and/or standard component folders) → the parsed plugin,
 * ready to save (enabled: true, no settings yet so defaults apply, unsupported parts listed).
 */
export async function inspectGithubSource(link: string, githubToken?: string): Promise<InstallTarget> {
  const ref = parseGithubLink(link);
  if (!ref) throw new Error('Paste a GitHub link, e.g. https://github.com/owner/repo or owner/repo.');
  const rawDir = ref.file ? dirname(ref.file) : ref.path;
  if (hasDotDot(rawDir)) throw new Error('That link points outside the repository.');
  let decoded = rawDir;
  try {
    decoded = decodeURIComponent(rawDir);
  } catch {
    // keep as typed
  }
  let dir = joinPath(decoded);
  if (basename(dir) === '.claude-plugin') dir = dirname(dir);

  const ctx = createCtx(githubToken || undefined);
  const tree = await ctx.tree(ref.owner, ref.repo, ref.branch);
  await ctx.fill(tree, dir);
  const source = cleanLink(link);
  if (!hasDir(tree, dir)) throw new Error(`Couldn’t find the folder “${dir}” in ${ref.owner}/${ref.repo}.`);

  if (hasFile(tree, joinPath(dir, '.claude-plugin/marketplace.json'))) {
    return { kind: 'marketplace', marketplace: await readMarketplace(ctx, tree, dir, source) };
  }
  if (looksLikePlugin(tree, dir)) {
    const fromMarketplace = await pluginFromParentMarketplace(ctx, tree, dir, source);
    if (fromMarketplace) return { kind: 'plugin', plugin: fromMarketplace };
    const plugin = await parsePlugin(ctx, {
      tree,
      root: dir,
      fallbackName: dir ? basename(dir) : ref.repo,
      idScope: `${ref.owner}/${ref.repo}`,
      source,
    });
    return { kind: 'plugin', plugin };
  }
  const discovered = await discoverPlugins(ctx, tree, dir, source);
  if (discovered) return { kind: 'marketplace', marketplace: discovered };
  const where = dir ? `${ref.owner}/${ref.repo}/${dir}` : `${ref.owner}/${ref.repo}`;
  throw new Error(
    `Nothing that looks like a Claude Code plugin in ${where}. A plugin has .claude-plugin/plugin.json or folders like skills/, commands/ and agents/; a marketplace has .claude-plugin/marketplace.json.`,
  );
}

/** Fetches and parses one marketplace entry into a Plugin. */
export async function installFromMarketplace(
  marketplace: MarketplaceInfo,
  entry: MarketplaceEntry,
  githubToken?: string,
): Promise<Plugin> {
  return installEntry(createCtx(githubToken || undefined), marketplace, entry);
}

/**
 * The settings to keep when an installed plugin is reinstalled or updated to `next`: values the
 * user set (not the old version's defaults) for keys `next` still declares. A value whose key became
 * sensitive moves to the device-only secrets; old secrets stay only for keys that are still sensitive.
 */
export function carryOverSettings(old: Plugin, next: Plugin): Pick<Plugin, 'config' | 'secrets'> {
  const config = { ...next.config };
  const secrets: Record<string, string> = { ...next.secrets };
  const text = (v: string | number | boolean | string[]) => (Array.isArray(v) ? v.join(',') : String(v));
  for (const f of next.userConfig) {
    const before = old.userConfig.find((o) => o.key === f.key);
    const value = old.config[f.key] as string | number | boolean | undefined;
    const userSet = value !== undefined && (before?.default === undefined || text(value) !== text(before.default));
    if (!f.sensitive) {
      if (userSet) config[f.key] = value;
    } else if (old.secrets?.[f.key]) {
      secrets[f.key] = old.secrets[f.key];
    } else if (userSet && text(value) !== '') {
      secrets[f.key] = text(value);
    }
  }
  return { config, secrets };
}
