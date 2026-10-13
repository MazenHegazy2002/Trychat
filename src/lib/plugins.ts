import { parseGithubLink } from './skills';
import type { McpServer, Plugin, PluginCommand, Skill } from './types';

/**
 * Runtime side of plugins: turns enabled plugins into the skills, MCP servers, agents and slash
 * commands the rest of the app already understands. Installing/parsing lives in pluginInstaller.ts.
 */

const USER_CONFIG_RE = /\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Value of a userConfig field: saved value, else the field's default. */
function configValue(plugin: Plugin, key: string, includeSensitive: boolean): string | undefined {
  const field = plugin.userConfig.find((f) => f.key === key);
  if (field?.sensitive && !includeSensitive) return undefined;
  const v = (field?.sensitive ? plugin.secrets?.[key] : plugin.config[key]) ?? field?.default;
  if (v === undefined || v === null) return undefined;
  return Array.isArray(v) ? v.join(',') : String(v);
}

/**
 * Replaces ${user_config.KEY}. Like Claude Code, sensitive values are only substituted where
 * `includeSensitive` (MCP URLs/headers) — in prompts they become a placeholder.
 */
export function substituteConfig(text: string, plugin: Plugin, includeSensitive = false): string {
  return text.replace(USER_CONFIG_RE, (_m, key: string) => {
    const v = configValue(plugin, key, includeSensitive);
    if (v !== undefined) return v;
    const field = plugin.userConfig.find((f) => f.key === key);
    if (includeSensitive && field && !field.required) return ''; // an optional value left unset, like ${VAR:-}
    return field?.sensitive && !includeSensitive ? `[${key} (hidden)]` : `[${key} not set]`;
  });
}

/** userConfig fields marked required that have no value yet. */
export function missingConfig(plugin: Plugin): string[] {
  return plugin.userConfig
    .filter((f) => f.required)
    .filter((f) => (f.sensitive ? !plugin.secrets?.[f.key] : (plugin.config[f.key] ?? f.default) === undefined || plugin.config[f.key] === ''))
    .map((f) => f.title || f.key);
}

const enabled = (plugins: Plugin[]) => plugins.filter((p) => p.enabled);

/**
 * An installed plugin with the same name as `candidate` but a different id — the same plugin from another
 * marketplace or repo. Installing both would make their commands, skills, agents and tools ambiguous.
 */
export function findNameConflict(plugins: Plugin[], candidate: Pick<Plugin, 'id' | 'name'>): Plugin | undefined {
  const name = candidate.name.toLowerCase();
  return plugins.find((p) => p.id !== candidate.id && p.name.toLowerCase() === name);
}

/**
 * Where a plugin came from, for messages: the part of its id after "@" (an Anthropic marketplace's name, else the
 * "owner/repo" it came from), else its marketplace or link. Not the marketplace's self-chosen name: any marketplace
 * could call itself "claude-plugins-official".
 */
export function pluginOrigin(p: Plugin): string {
  const at = p.id.indexOf('@');
  return at > 0 ? p.id.slice(at + 1) : (p.marketplace ?? p.source);
}

/** "scheme://host[:port]" of a URL or URL template, lowercased. Uses indexOf, so long input stays cheap. */
export function urlOrigin(url: string | undefined): string {
  const s = (url ?? '').trim();
  const scheme = s.indexOf('://');
  const start = scheme < 0 ? 0 : scheme + 3;
  let end = s.length;
  for (const c of ['/', '\\', '?', '#']) {
    const i = s.indexOf(c, start);
    if (i >= 0 && i < end) end = i;
  }
  return s.slice(0, end).toLowerCase();
}

/** "owner/repo" (lowercase) of a plugin's GitHub source link. */
function sourceRepo(source: string | undefined): string | undefined {
  if (!source || source.length > 4096) return undefined;
  const ref = parseGithubLink(source);
  return ref ? `${ref.owner}/${ref.repo}`.toLowerCase() : undefined;
}

/**
 * Where a plugin sends setting `key`: the origins of its MCP servers whose URL or headers use ${user_config.key}.
 * The other settings are filled into the URL first, so a changed host setting or default is a different origin.
 */
function destinations(plugin: Plugin, key: string): Set<string> {
  const ref = `\${user_config.${key}}`;
  const out = new Set<string>();
  for (const m of plugin.mcpServers ?? []) {
    if (m.url.includes(ref) || Object.values(m.headers ?? {}).some((v) => v.includes(ref))) {
      out.add(urlOrigin(substituteConfig(m.url, { ...plugin, userConfig: plugin.userConfig ?? [], config: plugin.config ?? {} })));
    }
  }
  return out;
}

/**
 * Which of `secrets` (the device-only sensitive settings of `old`) may stay when `old` becomes `next` — an update,
 * a reinstall, or a copy changed on another device: only when both come from the same GitHub repo, and only the
 * secrets `next` sends to no origin `old` didn't already send them to. The rest are dropped, and the user enters
 * them again. Otherwise a plugin that took over an id, or a synced copy whose MCP server points somewhere new,
 * would send the user's tokens to a host they never gave them to.
 */
export function secretsToKeep(old: Plugin, next: Plugin, secrets: Record<string, string> | undefined = old.secrets): Record<string, string> {
  const kept: Record<string, string> = {};
  const repo = sourceRepo(old.source);
  if (!secrets || !repo || repo !== sourceRepo(next.source)) return kept;
  for (const [key, value] of Object.entries(secrets)) {
    const before = destinations(old, key);
    if ([...destinations(next, key)].every((origin) => before.has(origin))) kept[key] = value;
  }
  return kept;
}

/**
 * Enabled plugins, each with the prefix of its runtime names ("prefix:skill", "/prefix:command", …). Names aren't
 * unique (the same plugin from two marketplaces, or both synced from another device), so only the one installed
 * first uses its plain name; the others add where they came from, e.g. "commit-commands@claude-plugins-official".
 * Every name stays reachable, and which plugin gets the plain name doesn't depend on list order.
 */
function enabledWithPrefix(plugins: Plugin[]): [Plugin, string][] {
  const on = enabled(plugins);
  const taken = new Set<string>();
  const prefixes = new Map<string, string>();
  for (const p of [...on].sort((a, b) => a.installedAt - b.installedAt || (a.id < b.id ? -1 : 1))) {
    const qualified = `${p.name}@${pluginOrigin(p).replace(/[^\w./-]+/g, '-')}`;
    let prefix = taken.has(p.name.toLowerCase()) ? qualified : p.name;
    for (let n = 2; taken.has(prefix.toLowerCase()); n++) prefix = `${qualified}-${n}`;
    taken.add(prefix.toLowerCase());
    prefixes.set(p.id, prefix);
  }
  return on.map((p) => [p, prefixes.get(p.id) ?? p.name]);
}

/** Plugin skills as regular skills, named "plugin:skill" like in Claude Code. */
export function pluginSkills(plugins: Plugin[]): Skill[] {
  return enabledWithPrefix(plugins).flatMap(([p, prefix]) =>
    p.skills.map((s) => ({
      id: `plugin:${p.id}:skill:${s.name}`,
      name: `${prefix}:${s.name}`,
      description: substituteConfig(s.description, p),
      instructions: substituteConfig(s.instructions, p),
      enabled: true,
      source: `Plugin ${p.displayName ?? p.name}`,
      updatedAt: p.updatedAt,
    })),
  );
}

/** Remote MCP servers from enabled plugins, ready for the MCP client. */
export function pluginMcpServers(plugins: Plugin[]): McpServer[] {
  return enabledWithPrefix(plugins).flatMap(([p, prefix]) =>
    p.mcpServers.map((m) => ({
      id: `plugin:${p.id}:mcp:${m.name}`,
      name: `${prefix}-${m.name}`,
      url: substituteConfig(m.url, p, true),
      transport: m.transport,
      headers: m.headers
        ? Object.fromEntries(Object.entries(m.headers).map(([k, v]) => [k, substituteConfig(v, p, true)]))
        : undefined,
      enabled: true,
      confirm: true,
      updatedAt: p.updatedAt,
      pluginId: p.id,
    })),
  );
}

export interface AgentProfile {
  /** "plugin:agent" — what the model passes as `agent` in agents.run. */
  name: string;
  description: string;
  prompt: string;
  model?: string;
}

export function pluginAgents(plugins: Plugin[]): AgentProfile[] {
  return enabledWithPrefix(plugins).flatMap(([p, prefix]) =>
    p.agents.map((a) => ({
      name: `${prefix}:${a.name}`,
      description: substituteConfig(a.description, p),
      prompt: substituteConfig(a.prompt, p),
      model: a.model,
    })),
  );
}

export interface SlashCommand extends PluginCommand {
  /** "plugin:command" (or "plugin@marketplace:command" for a second plugin of that name) — unique, always accepted. */
  fullName: string;
  pluginId: string;
  pluginName: string;
}

/** Commands from enabled plugins. `/name` works when unambiguous, `/plugin:name` always. */
export function slashCommands(plugins: Plugin[]): SlashCommand[] {
  return enabledWithPrefix(plugins).flatMap(([p, prefix]) =>
    p.commands.map((c) => ({
      ...c,
      description: substituteConfig(c.description, p),
      content: substituteConfig(c.content, p),
      fullName: `${prefix}:${c.name}`,
      pluginId: p.id,
      pluginName: p.displayName ?? p.name,
    })),
  );
}

/** Splits arguments like a shell would for $1…$9 (quotes group words). */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Expands a command body like Claude Code: $ARGUMENTS → all args, $ARGUMENTS[N] and $N → the
 * 0-based Nth arg. An indexed placeholder with no arg at its position stays as literal text.
 */
export function expandCommand(cmd: PluginCommand, args: string): string {
  const all = args.trim();
  const positional = splitArgs(all);
  let received = false;
  // One pass with a function replacer: what the user typed is never re-scanned or read as `$&`.
  const body = cmd.content.replace(/\$ARGUMENTS\[(\d+)\]|\$ARGUMENTS\b|\$(\d+)\b/g, (m, idx?: string, n?: string) => {
    if (idx === undefined && n === undefined) {
      received = true;
      return all;
    }
    const v = positional[Number(idx ?? n)];
    if (v === undefined) return m;
    received = true;
    return v;
  });
  // Arguments no placeholder received are still passed on, appended.
  return (all && !received ? `${body.trim()}\n\nARGUMENTS: ${all}` : body).trim();
}

/**
 * If `text` starts with a known slash command, returns the expanded prompt and the command.
 * Matches "/plugin:name args", or "/name args" when only one plugin has that command. Case doesn't matter,
 * but a match in the exact case wins: "/plugin:name" first, then "/name", then the same ignoring case.
 */
export function resolveSlashCommand(text: string, commands: SlashCommand[]): { prompt: string; command: SlashCommand } | null {
  // The name is everything up to the first space: names can hold any character the menu shows ("pr+check",
  // "résumé"), be namespaced more than once ("/plugin:folder:command"), and the plugin may carry its
  // marketplace or repo ("/plugin@marketplace:command", "/plugin@owner/repo:command").
  const m = text.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const [, name, args = ''] = m;
  const lower = name.toLowerCase();
  const only = (list: SlashCommand[]) => (list.length === 1 ? list[0] : undefined);
  const command =
    commands.find((c) => c.fullName === name) ??
    only(commands.filter((c) => c.name === name)) ??
    only(commands.filter((c) => c.fullName.toLowerCase() === lower)) ??
    only(commands.filter((c) => c.name.toLowerCase() === lower));
  if (!command) return null;
  return { prompt: expandCommand(command, args), command };
}
