import { BUILTIN_MARKETPLACES, BUILTIN_SKILL_REPOS, bestRemote, buildRemote, displayName, remoteFields, remoteTransport, searchRegistry } from './catalog';
import type { RegistryRemote, RegistryServer } from './catalog';
import { uid } from './id';
import { mcpToolName } from './mcp';
import { inspectGithubSource, installFromMarketplace } from './pluginInstaller';
import type { MarketplaceEntry, MarketplaceInfo } from './pluginInstaller';
import { missingConfig, pluginAgents, pluginSkills, slashCommands } from './plugins';
import { findSkills, importSkill, parseSkillMarkdown } from './skills';
import type { SkillCandidate } from './skills';
import type { Args, ToolContext, ToolDef } from './tools';
import type { InstallItem, McpServer, Plugin, Skill, ToolCall } from './types';

/**
 * store.search finds plugins, skills and MCP servers that aren't installed (the live MCP Registry, the
 * built-in and user plugin marketplaces, Anthropic's skills repo); store.install installs one after the
 * user approves it in the install card (components/InstallCard.tsx), which also previews it with
 * previewInstall(). Refs are stable across sessions:
 *   mcp:<registry name>   plugin:<marketplace owner/repo>#<entry name>   skill:<owner/repo>/<path to SKILL.md>
 */

export type StoreKind = 'plugin' | 'skill' | 'mcp';

/** A value the user can (or must) enter before installing: an API key, a URL variable, a plugin setting. */
export interface InstallField {
  key: string;
  label: string;
  description?: string;
  /** Typed into a secure field; passed only to the install run, never kept in the chat. */
  secret: boolean;
  required: boolean;
  type: 'string' | 'number' | 'boolean';
  defaultValue?: string;
  choices?: string[];
}

/** What the install card shows. */
export interface InstallPreview {
  ref: string;
  kind: StoreKind;
  name: string;
  /** Where it comes from, e.g. "claude-plugins-official · anthropics/claude-plugins-official". */
  source: string;
  description: string;
  version?: string;
  /** One line per thing it adds, e.g. "3 skills: pdf, docx, xlsx". */
  adds: string[];
  /** Hosts its MCP servers talk to. */
  hosts: string[];
  /** What does and doesn't work on a phone. */
  notes: string[];
  worksOnPhone: boolean;
  fields: InstallField[];
}

const SOURCE_TIMEOUT = 25_000;
const REGISTRY_TTL = 10 * 60_000;
const SECOND_PAGE_GRACE = 2_500;
/** A source that failed isn't asked again for this long (saves GitHub's 60 requests an hour without a token). */
const RETRY_AFTER = 3 * 60_000;
const DEFAULT_LIMIT = 8;
const KIND_LABEL: Record<StoreKind, string> = { plugin: 'plugin', skill: 'skill', mcp: 'MCP server' };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.+$/, '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Host of a URL (placeholders kept), e.g. "mcp.notion.com". */
export function hostOf(url: string): string {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]+)/i);
  return m ? m[1] : url;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} didn’t answer in time`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Caches a promise; a failed one is kept for `retryAfter` ms (0: forgotten at once) and then retried. */
function cached<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>, retryAfter = 0): Promise<T> {
  let p = map.get(key);
  if (!p) {
    const made = make();
    map.set(key, made);
    made.catch(() => {
      if (retryAfter) setTimeout(() => map.get(key) === made && map.delete(key), retryAfter);
      else if (map.get(key) === made) map.delete(key);
    });
    p = made;
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Session caches (module level, so the Store search, the install card and store.install share them)
// ---------------------------------------------------------------------------------------------

const marketplaces = new Map<string, Promise<MarketplaceInfo>>();
const skillLists = new Map<string, Promise<SkillCandidate[]>>();
const skillTexts = new Map<string, Promise<string>>();
const registryTerms = new Map<string, { at: number; pages: Promise<RegistryServer[]>[] }>();
/** Every registry server seen in a search, by name. */
const registryServers = new Map<string, RegistryServer>();
const loads = new Map<string, Promise<Loaded>>();
const previews = new Map<string, Promise<InstallPreview>>();

function marketplace(repo: string, token?: string): Promise<MarketplaceInfo> {
  return cached(marketplaces, repo.toLowerCase(), async () => {
    const target = await inspectGithubSource(repo, token);
    if (target.kind !== 'marketplace') throw new Error(`${repo} is a single plugin, not a marketplace.`);
    return target.marketplace;
  }, RETRY_AFTER);
}

const skillList = (repo: string, token?: string) => cached(skillLists, repo.toLowerCase(), () => findSkills(repo, token), RETRY_AFTER);

function skillText(c: SkillCandidate, token?: string): Promise<string> {
  return cached(skillTexts, c.rawUrl, async () => {
    const res = await fetch(c.rawUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error(`Couldn’t download ${c.path} (${res.status}).`);
    return res.text();
  });
}

/** Registry search for one term: the first two pages, each its own promise so a slow second page can be skipped. */
function registryTerm(term: string): Promise<RegistryServer[]>[] {
  const hit = registryTerms.get(term);
  if (hit && Date.now() - hit.at < REGISTRY_TTL) return hit.pages;
  const first = searchRegistry(term);
  const remember = (servers: RegistryServer[]) => {
    for (const s of servers) registryServers.set(s.name, s);
    return servers;
  };
  const pages = [
    first.then((r) => remember(r.servers)),
    first.then((r) => (r.nextCursor ? searchRegistry(term, r.nextCursor).then((n) => remember(n.servers)) : [])),
  ];
  const entry = { at: Date.now(), pages };
  registryTerms.set(term, entry);
  pages[0].catch(() => registryTerms.get(term) === entry && registryTerms.delete(term));
  pages[1].catch(() => undefined);
  return pages;
}

/** The fulfilled values of the promises that settle before `ms`. */
async function settledWithin<T>(promises: Promise<T>[], ms: number): Promise<{ values: T[]; errors: string[] }> {
  const values: T[] = [];
  const errors: string[] = [];
  await Promise.all(
    promises.map((p) =>
      withTimeout(p, ms, 'The MCP Registry').then(
        (v) => void values.push(v),
        (e) => void errors.push(errorText(e)),
      ),
    ),
  );
  return { values, errors };
}

async function registryServer(name: string): Promise<RegistryServer> {
  const known = registryServers.get(name);
  if (known) return known;
  const { servers } = await withTimeout(searchRegistry(name), SOURCE_TIMEOUT, 'The MCP Registry');
  for (const s of servers) registryServers.set(s.name, s);
  const found = servers.find((s) => s.name === name);
  if (!found) throw new Error(`No server named “${name}” in the MCP Registry.`);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Query terms and relevance
// ---------------------------------------------------------------------------------------------

const STOP = new Set(
  ('a an the to for from with and or of in on at by my me i we our your it its is are be can could would should want need ' +
    'needs please some any that this these those how what which using use via into about tool tools app apps mcp server servers ' +
    'plugin plugins skill skills integration integrations something thing things able allow let lets do does new also all way ' +
    'connect connector access help me support')
    .split(' '),
);
/** Words that say what to do rather than with what; they only count in descriptions. */
const VERBS = new Set(
  ('send read write make create get edit fill query list manage post update delete open build generate convert run check ' +
    'track schedule book analyze analyse view see show add remove upload download sync fetch search_for look find')
    .split(' '),
);
const SYNONYMS: string[][] = [
  ['powerpoint', 'pptx', 'presentation', 'slides', 'deck'],
  ['excel', 'xlsx', 'spreadsheet'],
  ['docx', 'word'],
  ['postgres', 'postgresql'],
  ['email', 'gmail', 'mail'],
  ['database', 'sql'],
  ['image', 'picture', 'photo'],
];
/** Words that are part of many registry namespaces ("io.github.user/…"), searched as "/word" and "word/". */
const NAMESPACE_WORDS = new Set(['github', 'io', 'com', 'ai', 'dev', 'app', 'co', 'org', 'net']);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

const words = (text: string): string[] =>
  (text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);

interface Term {
  word: string;
  /** Stems to look for, with their weight (synonyms count less). */
  forms: [string, number][];
  verb: boolean;
}

function parseQuery(query: string): Term[] {
  const raw = query.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? [];
  const seen = new Set<string>();
  const terms: Term[] = [];
  for (const w0 of raw) {
    const w = w0.replace(/[.-]+$/, '');
    if (!w || STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    const group = SYNONYMS.find((g) => g.includes(w)) ?? [];
    const forms: [string, number][] = [[stem(w), 1], ...group.filter((s) => s !== w).map((s): [string, number] => [stem(s), 0.6])];
    terms.push({ word: w, forms, verb: VERBS.has(w) });
  }
  return terms;
}

/** 1 for a whole word, less for a prefix or substring, 0 for no match. */
function matchQuality(form: string, fieldWords: string[], flat: string): number {
  if (fieldWords.includes(form)) return 1;
  if (form.length >= 3 && fieldWords.some((w) => w.startsWith(form) || (w.length >= 5 && form.startsWith(w)))) return 0.7;
  if (form.length >= 4 && flat.includes(form)) return 0.4;
  return 0;
}

interface Fields {
  name: string;
  description: string;
  extra?: string;
}

/** Relevance of an item to the query (0 = doesn't match any of its main words). */
function relevance(terms: Term[], f: Fields): number {
  const fields = [f.name, f.description, f.extra ?? ''].map((t) => ({ words: words(t), flat: words(t).join('') }));
  const [name, desc, extra] = fields;
  const key = terms.filter((t) => !t.verb);
  const main = key.length ? key : terms;
  let score = 0;
  let matched = 0;
  for (const t of terms) {
    let best = 0;
    for (const [form, weight] of t.forms) {
      const s = t.verb && key.length
        ? 1.5 * matchQuality(form, desc.words, desc.flat)
        : 10 * matchQuality(form, name.words, name.flat) + 3 * matchQuality(form, desc.words, desc.flat) + 2 * matchQuality(form, extra.words, extra.flat);
      best = Math.max(best, s * weight);
    }
    score += best;
    if (best > 0 && main.includes(t)) matched++;
  }
  if (!matched) return 0;
  const coverage = matched / main.length;
  const exact = main.some((t) => words(f.name).join(' ') === stem(t.word)) ? 4 : 0;
  return score * (0.3 + 0.7 * coverage * coverage) + exact;
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

interface Hit {
  ref: string;
  kind: StoreKind;
  name: string;
  source: string;
  description: string;
  score: number;
  phone: boolean;
  phoneNote: string;
  needs: string;
  installed: boolean;
  /** For de-duplication. */
  key: string;
}

/** Ids of installed plugins: from ctx.plugins, else from the ids of their skills and MCP servers. */
function installedPluginIds(ctx: ToolContext): Set<string> {
  if (ctx.plugins) return new Set(ctx.plugins.map((p) => p.id));
  const ids = new Set<string>();
  for (const k of ctx.skills) {
    const m = k.id.match(/^plugin:(.+):skill:/);
    if (m) ids.add(m[1]);
  }
  for (const s of ctx.mcpServers) if (s.pluginId) ids.add(s.pluginId);
  return ids;
}

const skillInstalled = (skills: Skill[], repo: string, path: string) =>
  skills.some((k) => !k.id.startsWith('plugin:') && !!k.source?.includes(repo) && k.source.endsWith(path));

const serverInstalled = (servers: McpServer[], s: RegistryServer) => {
  const remote = bestRemote(s);
  return servers.some((m) => m.registryName === s.name || (!!remote && m.url === remote.url));
};

function needsText(fields: { label: string; secret: boolean; required: boolean }[]): string {
  const required = fields.filter((f) => f.required);
  if (!required.length) return fields.length ? 'nothing required' : 'nothing listed';
  return required.map((f) => `${f.label}${f.secret ? ' (secret)' : ''}`).join(', ');
}

/** The publisher part of a registry name: "com.notion" → "notion", "dev.pages.scrapemole" → "scrapemole", io.github.* → none. */
function publisher(s: RegistryServer): string {
  const labels = s.name.split('/')[0].toLowerCase().split('.');
  if (labels[0] === 'io' && labels[1] === 'github') return '';
  return labels.length > 1 ? labels[labels.length - 1] : '';
}

const registryNameText = (s: RegistryServer) => [s.title ?? '', s.name.split('/')[1] ?? '', publisher(s)].join(' ');

/** Published by the service itself: its domain is one of the query words ("com.notion/mcp" for "notion"). */
function officialServer(s: RegistryServer, terms: Term[]): boolean {
  const pub = publisher(s);
  return !!pub && terms.some((t) => !t.verb && stem(t.word) === stem(pub));
}

async function searchRegistryHits(ctx: ToolContext, terms: Term[]): Promise<{ hits: Hit[]; errors: string[] }> {
  const keyTerms = terms.filter((t) => !t.verb).slice(0, 3);
  const lookups = new Set<string>();
  for (const t of keyTerms.length ? keyTerms : terms.slice(0, 2)) {
    if (NAMESPACE_WORDS.has(t.word)) {
      lookups.add(`/${t.word}`);
      lookups.add(`${t.word}/`);
    } else lookups.add(t.word);
  }
  // A product name with a well-known synonym ("powerpoint" → "pptx") is searched both ways.
  for (const t of keyTerms) {
    if (lookups.size >= 4) break;
    const syn = SYNONYMS.find((g) => g.includes(t.word))?.find((s) => s !== t.word && !lookups.has(s));
    if (syn) lookups.add(syn);
  }
  const pages = [...lookups].map(registryTerm);
  // First pages get the full time; second pages only a short grace after them, so one slow page doesn't hold up the answer.
  const first = await settledWithin(pages.map((p) => p[0]), SOURCE_TIMEOUT);
  const second = await settledWithin(pages.map((p) => p[1]), first.values.length ? SECOND_PAGE_GRACE : 1);
  const values = [...first.values, ...second.values];
  const errors = first.errors;
  const byName = new Map<string, RegistryServer>();
  for (const s of values.flat()) byName.set(s.name, s);
  const hits: Hit[] = [];
  for (const s of byName.values()) {
    let score = relevance(terms, { name: registryNameText(s), description: s.description });
    if (!score) continue;
    const remote = bestRemote(s);
    if (officialServer(s, terms)) score += 6;
    if (!remote) score *= 0.3;
    hits.push({
      ref: `mcp:${s.name}`,
      kind: 'mcp',
      name: displayName(s),
      source: `MCP Registry (${s.name})`,
      description: s.description,
      score,
      phone: !!remote,
      phoneNote: remote ? `remote server at ${hostOf(remote.url)}` : `no — runs on a computer (${s.localPackages.join(', ') || 'local package'})`,
      needs: remote ? needsText(remoteFields(remote)) : '',
      installed: serverInstalled(ctx.mcpServers, s),
      key: remote ? `url:${remote.url}` : `mcp:${s.name}`,
    });
  }
  // Only report a failure when nothing came back at all (a slow second page isn't worth mentioning).
  return { hits, errors: values.length ? [] : errors.slice(0, 1) };
}

function marketplaceHits(ctx: ToolContext, terms: Term[], repo: string, market: MarketplaceInfo): Hit[] {
  const installed = installedPluginIds(ctx);
  const official = /^anthropics\//i.test(repo) ? (/claude-plugins-official/i.test(repo) ? 4 : 3) : 0;
  const hits: Hit[] = [];
  for (const e of market.entries) {
    let score = relevance(terms, { name: `${e.name} ${e.displayName ?? ''}`, description: e.description ?? '', extra: e.category });
    if (!score) continue;
    score += official;
    if (!e.supported) score *= 0.3;
    hits.push({
      ref: `plugin:${repo}#${e.name}`,
      kind: 'plugin',
      name: e.displayName ?? e.name,
      source: `${market.name} marketplace (${repo})`,
      description: e.description ?? '',
      score,
      phone: e.supported,
      phoneNote: e.supported ? 'yes (installs from GitHub; parts a phone can’t run are listed on the install card)' : `no — ${e.reason ?? 'can’t be installed on a phone'}`,
      needs: 'shown on the install card',
      installed: installed.has(`${e.name}@${market.name}`),
      key: `plugin:${e.name.toLowerCase()}`,
    });
  }
  return hits;
}

async function skillHits(ctx: ToolContext, terms: Term[], repo: string, token?: string): Promise<Hit[]> {
  const list = (await skillList(repo, token)).filter((c) => c.isSkillFile).slice(0, 80);
  const texts = await Promise.all(list.map((c) => skillText(c, token).catch(() => '')));
  const hits: Hit[] = [];
  list.forEach((c, i) => {
    const parsed = texts[i] ? parseSkillMarkdown(texts[i], c.name) : { name: c.name, description: '', instructions: '' };
    let score = relevance(terms, { name: `${parsed.name} ${c.name}`, description: parsed.description, extra: c.path });
    if (!score) return;
    if (/^anthropics\//i.test(repo)) score += 3;
    hits.push({
      ref: `skill:${repo}/${c.path}`,
      kind: 'skill',
      name: parsed.name,
      source: `${repo} (${c.path})`,
      description: parsed.description,
      score,
      phone: true,
      phoneNote: 'yes (instructions; scripts it mentions don’t run on the phone)',
      needs: 'nothing',
      installed: skillInstalled(ctx.skills, repo, c.path),
      key: `skill:${repo}/${c.path}`,
    });
  });
  return hits;
}

function normalizeKind(kind: unknown): StoreKind | 'any' {
  const k = String(kind ?? 'any').toLowerCase();
  if (/mcp|server|connector/.test(k)) return 'mcp';
  if (/plugin/.test(k)) return 'plugin';
  if (/skill/.test(k)) return 'skill';
  return 'any';
}

async function search(ctx: ToolContext, args: Args): Promise<string> {
  const query = String(args.query ?? '').trim();
  const terms = parseQuery(query);
  if (!terms.length) throw new Error('Give a few keywords, e.g. {"query":"slack"} or {"query":"postgres database"}.');
  const kind = normalizeKind(args.kind);
  const limit = Math.min(15, Math.max(1, Number(args.limit) || DEFAULT_LIMIT));
  const token = ctx.settings.githubToken || undefined;

  const jobs: { label: string; run: () => Promise<{ hits: Hit[]; errors?: string[] }> }[] = [];
  if (kind === 'any' || kind === 'mcp') jobs.push({ label: 'MCP Registry', run: () => searchRegistryHits(ctx, terms) });
  if (kind === 'any' || kind === 'plugin') {
    const repos = [...BUILTIN_MARKETPLACES.map((m) => m.repo), ...ctx.settings.marketplaces];
    for (const repo of [...new Set(repos.map((r) => r.trim()).filter(Boolean))]) {
      jobs.push({
        label: `${repo} marketplace`,
        run: async () => ({ hits: marketplaceHits(ctx, terms, repo, await withTimeout(marketplace(repo, token), SOURCE_TIMEOUT, repo)) }),
      });
    }
  }
  if (kind === 'any' || kind === 'skill') {
    for (const src of BUILTIN_SKILL_REPOS) {
      jobs.push({ label: `${src.repo} skills`, run: async () => ({ hits: await withTimeout(skillHits(ctx, terms, src.repo, token), SOURCE_TIMEOUT, src.repo) }) });
    }
  }

  const results = await Promise.all(
    jobs.map((j) =>
      j.run().then(
        (r) => ({ label: j.label, hits: r.hits, errors: r.errors ?? [] }),
        (e) => ({ label: j.label, hits: [] as Hit[], errors: [errorText(e)] }),
      ),
    ),
  );

  // Best first; the same plugin from two marketplaces or the same remote URL from two registry entries shows once.
  const best = new Map<string, Hit>();
  for (const h of results.flatMap((r) => r.hits)) {
    const old = best.get(h.key);
    if (!old || h.score > old.score) best.set(h.key, h);
  }
  const hits = [...best.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
  const failed = results.filter((r) => r.errors.length).map((r) => `${r.label}: ${r.errors[0]}`);

  const lines: string[] = [];
  if (!hits.length) {
    lines.push(`Nothing in the Store matches “${query}”. Try other keywords (a product name like "slack" or a file type like "pdf").`);
  } else {
    lines.push(`Store results for “${query}” (best first):`);
    hits.forEach((h, i) => {
      lines.push(
        `${i + 1}. ${h.name} — ${KIND_LABEL[h.kind]}${h.installed ? ' — ALREADY INSTALLED' : ''}\n` +
          `   ref: ${h.ref}\n` +
          `   from: ${h.source} · works on phone: ${h.phoneNote}${h.needs ? ` · needs: ${h.needs}` : ''}\n` +
          (h.description ? `   ${clip(oneLine(h.description), 200)}` : ''),
      );
    });
    lines.push(
      'To install one: store.install {"ref":"<ref>","reason":"<why the task needs it>"}. The user approves it and types any keys into the install card — don’t ask for keys in the chat. Prefer items that work on the phone and need no keys. Remote MCP servers that need an account sign-in (OAuth) can’t connect yet.',
    );
  }
  if (failed.length) lines.push(`(Couldn’t search ${failed.join('; ')}.)`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Loading and installing one item
// ---------------------------------------------------------------------------------------------

type Ref =
  | { kind: 'mcp'; name: string }
  | { kind: 'plugin'; repo: string; entry: string }
  | { kind: 'skill'; repo: string; path: string };

export function parseRef(ref: unknown): Ref | null {
  const r = String(ref ?? '').trim().replace(/^["'`]|["'`]$/g, '');
  let m = r.match(/^mcp:(\S+)$/i);
  if (m) return { kind: 'mcp', name: m[1] };
  m = r.match(/^plugin:([\w.-]+\/[\w.-]+)#(.+)$/i);
  if (m) return { kind: 'plugin', repo: m[1], entry: m[2].trim() };
  m = r.match(/^skill:([\w.-]+\/[\w.-]+)\/(.+)$/i);
  if (m && !m[2].split('/').includes('..')) return { kind: 'skill', repo: m[1], path: m[2] };
  return null;
}

type Loaded =
  | { kind: 'mcp'; server: RegistryServer; remote?: RegistryRemote }
  | { kind: 'plugin'; plugin: Plugin; market: MarketplaceInfo; entry: MarketplaceEntry; repo: string }
  | { kind: 'skill'; skill: Skill; repo: string; path: string };

const BAD_REF = 'Use a ref from store.search, e.g. "mcp:com.notion/mcp", "plugin:anthropics/claude-plugins-official#github" or "skill:anthropics/skills/skills/pdf/SKILL.md".';

function load(refText: string, token?: string): Promise<Loaded> {
  const ref = parseRef(refText);
  if (!ref) return Promise.reject(new Error(`“${refText}” isn’t a Store ref. ${BAD_REF}`));
  return cached(loads, refText.trim(), async (): Promise<Loaded> => {
    if (ref.kind === 'mcp') {
      const server = await registryServer(ref.name);
      return { kind: 'mcp', server, remote: bestRemote(server) };
    }
    if (ref.kind === 'plugin') {
      const market = await withTimeout(marketplace(ref.repo, token), SOURCE_TIMEOUT * 2, ref.repo);
      const entry = market.entries.find((e) => e.name === ref.entry) ?? market.entries.find((e) => e.name.toLowerCase() === ref.entry.toLowerCase());
      if (!entry) throw new Error(`The ${market.name} marketplace has no plugin named “${ref.entry}”.`);
      if (!entry.supported) throw new Error(`${entry.displayName ?? entry.name} can’t be installed on a phone: ${entry.reason ?? 'unsupported source'}.`);
      const plugin = await installFromMarketplace(market, entry, token);
      return { kind: 'plugin', plugin, market, entry, repo: ref.repo };
    }
    const candidate = (await skillList(ref.repo, token)).find((c) => c.path === ref.path);
    if (!candidate) throw new Error(`No skill at ${ref.path} in ${ref.repo}.`);
    const skill = await importSkill(candidate, `https://github.com/${ref.repo}`, token);
    return { kind: 'skill', skill, repo: ref.repo, path: ref.path };
  });
}

function pluginFields(plugin: Plugin): InstallField[] {
  return plugin.userConfig.map((f) => ({
    key: f.key,
    label: f.title || f.key,
    description: f.description || undefined,
    secret: !!f.sensitive,
    required: !!f.required,
    type: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string',
    defaultValue: f.default === undefined ? undefined : Array.isArray(f.default) ? f.default.join(',') : String(f.default),
    choices: f.options,
  }));
}

const listNames = (names: string[], max = 6) => `${names.slice(0, max).join(', ')}${names.length > max ? `, +${names.length - max} more` : ''}`;

function toPreview(refText: string, item: Loaded): InstallPreview {
  if (item.kind === 'mcp') {
    const { server: s, remote } = item;
    return {
      ref: refText,
      kind: 'mcp',
      name: displayName(s),
      source: `MCP Registry · ${s.name}`,
      description: s.description,
      version: s.version,
      adds: [`MCP server “${displayName(s)}” — its tools are listed once it connects; each tool call asks you first`],
      hosts: remote ? [hostOf(remote.url)] : [],
      notes: remote
        ? [`Remote server${remote.type === 'sse' ? ' (older SSE transport)' : ''} — works on your phone. Servers that need an account sign-in (OAuth) can’t connect yet.`]
        : [`Runs on a computer only (${s.localPackages.join(', ') || 'local package'}) — can’t be used from the phone.`],
      worksOnPhone: !!remote,
      fields: remote ? remoteFields(remote).map((f) => ({ ...f, type: 'string' as const })) : [],
    };
  }
  if (item.kind === 'plugin') {
    const p = item.plugin;
    const adds = [
      p.skills.length && `${plural(p.skills.length, 'skill')}: ${listNames(p.skills.map((x) => x.name))}`,
      p.commands.length && `${plural(p.commands.length, 'slash command')}: ${listNames(p.commands.map((x) => `/${x.name}`))}`,
      p.agents.length && `${plural(p.agents.length, 'agent')}: ${listNames(p.agents.map((x) => x.name))}`,
      p.mcpServers.length && `${plural(p.mcpServers.length, 'MCP server')}: ${listNames(p.mcpServers.map((x) => `${x.name} (${hostOf(x.url)})`))}`,
    ].filter((x): x is string => !!x);
    const works = adds.length > 0;
    return {
      ref: refText,
      kind: 'plugin',
      name: p.displayName ?? p.name,
      source: `${item.market.name} · ${item.repo}`,
      description: p.description,
      version: p.version,
      adds: adds.length ? adds : ['Nothing a phone can use'],
      hosts: [...new Set(p.mcpServers.map((x) => hostOf(x.url)))],
      notes: [
        ...(p.unsupported.length ? [`Not available on a phone: ${p.unsupported.join(', ')}`] : []),
        ...(p.author ? [`By ${p.author}`] : []),
      ],
      worksOnPhone: works,
      fields: pluginFields(p),
    };
  }
  const k = item.skill;
  return {
    ref: refText,
    kind: 'skill',
    name: k.name,
    source: `${item.repo} · ${item.path}`,
    description: k.description,
    adds: [`Skill “${k.name}” — instructions the assistant loads when a task needs them`],
    hosts: [],
    notes: /\.(py|sh|js|ts)\b|scripts\//i.test(k.instructions)
      ? ['It mentions scripts; those can’t run on the phone, but the instructions still apply.']
      : [],
    worksOnPhone: true,
    fields: [],
  };
}

/** Fetches what a ref installs, for the install card (cached for the session). */
export function previewInstall(ref: string, githubToken?: string): Promise<InstallPreview> {
  return cached(previews, ref.trim(), async () => toPreview(ref.trim(), await load(ref, githubToken || undefined)));
}

/** Best-effort name for a ref without fetching anything. */
export function refName(refText: unknown): string {
  const ref = parseRef(refText);
  if (!ref) return String(refText ?? 'item');
  if (ref.kind === 'mcp') {
    const s = registryServers.get(ref.name);
    return s ? displayName(s) : ref.name;
  }
  if (ref.kind === 'plugin') return ref.entry;
  const parts = ref.path.split('/');
  return /^skill\.md$/i.test(parts[parts.length - 1]) && parts.length > 1 ? parts[parts.length - 2] : parts[parts.length - 1];
}

/** Labels for store.* calls (ToolCallCard has no tool context to look them up). */
export function storeToolLabel(call: ToolCall): string | null {
  if (call.name === 'store.search') return `Searched the Store for “${String(call.args.query ?? '')}”`;
  if (call.name === 'store.install') return `Install ${refName(call.args.ref)}`;
  return null;
}

/** Text values for each field: the card's secrets, then config from the args, then defaults. */
function fieldValues(fields: InstallField[], config: Record<string, unknown>, secrets: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of fields) {
    const v = secrets[f.key] ?? config[f.key] ?? f.defaultValue;
    if (v !== undefined && v !== null && String(v).trim() !== '') values[f.key] = String(v).trim();
  }
  return values;
}

const missingText = (fields: InstallField[]) => fields.map((f) => `${f.label}${f.secret ? ' (secret)' : ''}`).join(', ');

async function install(ctx: ToolContext, args: Args): Promise<string> {
  const refText = String(args.ref ?? '').trim();
  if (!ctx.install) throw new Error('Installing from the chat isn’t available here.');
  const token = ctx.settings.githubToken || undefined;
  const item = await load(refText, token);
  const preview = toPreview(refText, item);
  const config: Record<string, unknown> = args.config && typeof args.config === 'object' ? args.config : {};
  const secrets = ctx.approval?.secrets ?? {};
  const values = fieldValues(preview.fields, config, secrets);

  let installItem: InstallItem;
  if (item.kind === 'mcp') {
    if (!item.remote) throw new Error(`${preview.name} runs on a computer only, so it can’t be used from the phone. Pick a remote server from store.search.`);
    const missing = preview.fields.filter((f) => f.required && !values[f.key]);
    if (missing.length) throw new Error(`Not installed: ${preview.name} needs ${missingText(missing)}, which the user didn’t enter. Call store.install again so they can fill it in on the card.`);
    const { url, headers, urlSecrets } = buildRemote(item.remote, values);
    const existing = ctx.mcpServers.find((m) => !m.pluginId && m.registryName === item.server.name);
    installItem = {
      kind: 'mcp',
      server: {
        id: existing?.id ?? uid(),
        name: displayName(item.server),
        url,
        transport: remoteTransport(item.remote),
        ...(existing?.token ? { token: existing.token } : {}),
        headers: Object.keys(headers).length ? headers : undefined,
        urlSecrets: Object.keys(urlSecrets).length ? urlSecrets : undefined,
        enabled: true,
        confirm: existing?.confirm ?? true,
        updatedAt: 0,
        registryName: item.server.name,
      },
    };
  } else if (item.kind === 'plugin') {
    const plugin: Plugin = { ...item.plugin, config: { ...item.plugin.config }, secrets: { ...(item.plugin.secrets ?? {}) } };
    for (const f of plugin.userConfig) {
      const v = secrets[f.key] ?? config[f.key];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      const s = String(v).trim();
      if (f.sensitive) plugin.secrets![f.key] = s;
      else if (f.type === 'number') {
        if (Number.isFinite(Number(s))) plugin.config[f.key] = Number(s);
      } else if (f.type === 'boolean') plugin.config[f.key] = (v as unknown) === true || s.toLowerCase() === 'true';
      else plugin.config[f.key] = s;
    }
    installItem = { kind: 'plugin', plugin };
  } else {
    const existing = ctx.skills.find((k) => !k.id.startsWith('plugin:') && !!k.source?.includes(item.repo) && k.source.endsWith(item.path));
    installItem = { kind: 'skill', skill: { ...item.skill, id: existing?.id ?? uid(), enabled: true, updatedAt: Date.now() } };
  }

  const summary = await ctx.install(installItem);
  return [summary, ...available(ctx, installItem), 'Now continue with the user’s task.'].join('\n');
}

/** What the model can use now, so it carries on with the task. */
function available(ctx: ToolContext, item: InstallItem): string[] {
  if (item.kind === 'skill') return [`Load it with skills.read {"name":"${item.skill.name}"} and follow it.`];
  if (item.kind === 'mcp') {
    const lines = [`Its tools are in your tool list now as ${mcpToolName(item.server, '')}<tool name>; each call asks the user first.`];
    return lines;
  }
  const plugin = { ...item.plugin, enabled: true };
  const others = (ctx.plugins ?? []).filter((p) => p.id !== plugin.id);
  const mine = (id: string) => id.startsWith(`plugin:${plugin.id}:`);
  const skills = pluginSkills([...others, plugin]).filter((k) => mine(k.id)).map((k) => k.name);
  const commands = slashCommands([...others, plugin]).filter((c) => c.pluginId === plugin.id).map((c) => `/${c.fullName}`);
  const agents = pluginAgents([plugin]).map((a) => a.name);
  const lines: string[] = [];
  if (skills.length) lines.push(`Skills (load with skills.read): ${skills.join(', ')}`);
  if (agents.length) lines.push(`Agents for agents.run: ${agents.join(', ')}`);
  if (commands.length) lines.push(`Slash commands the user can type: ${commands.join(', ')}`);
  if (plugin.mcpServers.length) lines.push('Its MCP tools are in your tool list now (each call asks the user first).');
  if (plugin.unsupported.length) lines.push(`Not available on the phone: ${plugin.unsupported.join(', ')}`);
  const missing = missingConfig(plugin);
  if (missing.length) lines.push(`Still needs settings: ${missing.join(', ')} (the user can set them in Settings › Plugins).`);
  const old = ctx.plugins?.find((p) => p.id === plugin.id);
  if (old && !old.enabled) lines.push('It was already installed but is turned off; the user can turn it on in Settings › Plugins.');
  return lines;
}

/** Tools to find plugins, skills and MCP servers that aren’t installed, and install them with the user’s OK. */
export function storeTools(_ctx: ToolContext): Record<string, ToolDef> {
  return {
    'store.search': {
      service: 'store',
      kind: 'read',
      description:
        'Find plugins, skills and MCP servers that aren’t installed yet (MCP Registry, plugin marketplaces, Anthropic skills). Use short keywords, e.g. "slack", "postgres", "pptx", "pdf forms". Returns refs for store.install.',
      params: '{"query":"keywords","kind":"any|plugin|skill|mcp"}',
      label: (a) => `Searched the Store for “${String(a.query ?? '')}”`,
      run: (ctx, a) => search(ctx, a),
    },
    'store.install': {
      service: 'store',
      kind: 'install',
      description:
        'Install a store.search result. The user approves it on an install card and types any keys there (never ask for keys in the chat). Returns the new tools/skills.',
      params: '{"ref":"ref from store.search","reason":"why the task needs it","config":{"optional non-secret setting":"value"}}',
      label: (a) => `Install ${refName(a.ref)}`,
      run: (ctx, a) => install(ctx, a),
    },
  };
}
