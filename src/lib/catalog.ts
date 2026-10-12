/**
 * The Store's catalogs: Anthropic's plugin marketplaces and skills collection on GitHub, plus the
 * official MCP Registry (registry.modelcontextprotocol.io).
 */

export interface CatalogSource {
  /** GitHub "owner/repo". */
  repo: string;
  title: string;
  description: string;
  publisher: string;
  /** Added by the user (can be removed), as opposed to built in. */
  custom?: boolean;
}

/** Marketplaces from Anthropic's docs (code.claude.com/docs/en/plugins/anthropic-marketplaces). */
export const BUILTIN_MARKETPLACES: CatalogSource[] = [
  {
    repo: 'anthropics/claude-plugins-official',
    title: 'Official plugins',
    description: 'Plugins Anthropic maintains, plus plugins from partners and other authors.',
    publisher: 'Anthropic',
  },
  {
    repo: 'anthropics/claude-plugins-community',
    title: 'Community plugins',
    description: 'Third-party plugins their authors submitted to Anthropic.',
    publisher: 'Anthropic',
  },
  {
    repo: 'anthropics/knowledge-work-plugins',
    title: 'Knowledge work plugins',
    description: 'Plugins for everyday knowledge work.',
    publisher: 'Anthropic',
  },
  {
    repo: 'anthropics/skills',
    title: 'Agent skills',
    description: 'Anthropic’s skills, packaged as plugins.',
    publisher: 'Anthropic',
  },
  {
    repo: 'anthropics/claude-code',
    title: 'Demo plugins',
    description: 'A small set of example plugins that show what a plugin can contain.',
    publisher: 'Anthropic',
  },
];

/** Repos of standalone skills (SKILL.md folders) shown in the Store's Skills tab. */
export const BUILTIN_SKILL_REPOS: CatalogSource[] = [
  {
    repo: 'anthropics/skills',
    title: 'Anthropic skills',
    description: 'Documents, design, development and more — each a SKILL.md you can add on its own.',
    publisher: 'Anthropic',
  },
];

// ---------- MCP Registry ----------

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0.1';

export interface RegistryInput {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  /** For headers: a template such as "Bearer {api_key}"; for variables: the default value. */
  value?: string;
  default?: string;
  choices?: string[];
}

export interface RegistryRemote {
  /** "streamable-http" or "sse". */
  type: string;
  /** May contain {variable} placeholders. */
  url: string;
  headers: RegistryInput[];
  variables: RegistryInput[];
}

export interface RegistryServer {
  /** Reverse-DNS id, e.g. "com.notion/mcp". */
  name: string;
  title?: string;
  description: string;
  version?: string;
  repositoryUrl?: string;
  websiteUrl?: string;
  remotes: RegistryRemote[];
  /** Has packages (npm/pypi/oci…) that run on a computer — not usable from a phone. */
  localPackages: string[];
}

function toInputs(raw: unknown): RegistryInput[] {
  if (Array.isArray(raw)) return raw.filter((h) => h && typeof h.name === 'string');
  // `variables` is an object keyed by name.
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, Omit<RegistryInput, 'name'>>).map(([name, v]) => ({ name, ...v }));
  }
  return [];
}

function toServer(entry: any): RegistryServer | null {
  const s = entry?.server ?? entry;
  if (!s?.name) return null;
  return {
    name: s.name,
    title: s.title,
    description: s.description ?? '',
    version: s.version,
    repositoryUrl: s.repository?.url,
    websiteUrl: s.websiteUrl,
    remotes: (s.remotes ?? [])
      .filter((r: any) => r?.url)
      .map((r: any) => ({ type: r.type ?? 'streamable-http', url: r.url, headers: toInputs(r.headers), variables: toInputs(r.variables) })),
    localPackages: (s.packages ?? []).map((p: any) => p?.registryType ?? p?.registry_name ?? 'package'),
  };
}

/** Searches the registry (latest version of each server). */
export async function searchRegistry(
  query: string,
  cursor?: string,
): Promise<{ servers: RegistryServer[]; nextCursor?: string }> {
  const params = new URLSearchParams({ limit: '30', version: 'latest' });
  if (query.trim()) params.set('search', query.trim());
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${REGISTRY}/servers?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`MCP Registry error ${res.status}`);
  const json = await res.json();
  const servers = (json.servers ?? []).map(toServer).filter(Boolean) as RegistryServer[];
  return { servers, nextCursor: json.metadata?.nextCursor || undefined };
}

/** The remote a phone should use: Streamable HTTP first, SSE as a fallback. */
export function bestRemote(server: RegistryServer): RegistryRemote | undefined {
  return server.remotes.find((r) => r.type === 'streamable-http') ?? server.remotes.find((r) => r.type === 'sse');
}

/** Placeholders like {api_key} inside a header template or URL. */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map((m) => m[1]))];
}

/** Everything the user must fill in before adding a remote: URL variables and header placeholders. */
export interface RemoteField {
  key: string;
  label: string;
  description?: string;
  secret: boolean;
  required: boolean;
  defaultValue?: string;
  choices?: string[];
}

export function remoteFields(remote: RegistryRemote): RemoteField[] {
  const fields: RemoteField[] = [];
  const seen = new Set<string>();
  const add = (f: RemoteField) => {
    if (!seen.has(f.key)) {
      seen.add(f.key);
      fields.push(f);
    }
  };
  for (const key of placeholders(remote.url)) {
    const v = remote.variables.find((x) => x.name === key);
    add({ key, label: key, description: v?.description, secret: !!v?.isSecret, required: v?.isRequired ?? true, defaultValue: v?.default, choices: v?.choices });
  }
  for (const h of remote.headers) {
    const keys = h.value ? placeholders(h.value) : [];
    if (keys.length) {
      for (const key of keys) {
        add({ key, label: key, description: h.description, secret: h.isSecret ?? /key|token|secret|auth/i.test(key), required: h.isRequired ?? true });
      }
    } else if (!h.value) {
      // A header with no template: the user types the whole value.
      add({ key: `header:${h.name}`, label: h.name, description: h.description, secret: h.isSecret ?? true, required: h.isRequired ?? false });
    }
  }
  return fields;
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (m, key) => values[key] ?? m);

/** Builds the URL and headers for a remote from the user's answers. Empty optional headers are left out. */
export function buildRemote(remote: RegistryRemote, values: Record<string, string>): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  for (const h of remote.headers) {
    const v = h.value ? fill(h.value, values) : values[`header:${h.name}`];
    if (v && !/\{[A-Za-z0-9_.-]+\}/.test(v)) headers[h.name] = v;
  }
  return { url: fill(remote.url, values), headers };
}

/** "com.notion/mcp" → "Notion"; prefers the registry title. */
export function displayName(server: RegistryServer): string {
  if (server.title) return server.title;
  const [ns, rest = ''] = server.name.split('/');
  const base = rest && rest !== 'mcp' && rest !== 'server' ? rest : ns.split('.').filter((p) => !['com', 'io', 'ai', 'dev', 'org', 'net', 'app', 'co'].includes(p)).pop() ?? ns;
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
