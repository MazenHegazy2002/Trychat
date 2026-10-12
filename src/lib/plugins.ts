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

/** Plugin skills as regular skills, named "plugin:skill" like in Claude Code. */
export function pluginSkills(plugins: Plugin[]): Skill[] {
  return enabled(plugins).flatMap((p) =>
    p.skills.map((s) => ({
      id: `plugin:${p.id}:skill:${s.name}`,
      name: `${p.name}:${s.name}`,
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
  return enabled(plugins).flatMap((p) =>
    p.mcpServers.map((m) => ({
      id: `plugin:${p.id}:mcp:${m.name}`,
      name: `${p.name}-${m.name}`,
      url: substituteConfig(m.url, p, true),
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
  return enabled(plugins).flatMap((p) =>
    p.agents.map((a) => ({
      name: `${p.name}:${a.name}`,
      description: substituteConfig(a.description, p),
      prompt: substituteConfig(a.prompt, p),
      model: a.model,
    })),
  );
}

export interface SlashCommand extends PluginCommand {
  /** "plugin:command" — always accepted. */
  fullName: string;
  pluginId: string;
  pluginName: string;
}

/** Commands from enabled plugins. `/name` works when unambiguous, `/plugin:name` always. */
export function slashCommands(plugins: Plugin[]): SlashCommand[] {
  return enabled(plugins).flatMap((p) =>
    p.commands.map((c) => ({
      ...c,
      description: substituteConfig(c.description, p),
      content: substituteConfig(c.content, p),
      fullName: `${p.name}:${c.name}`,
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
 * Matches "/plugin:name args" exactly, or "/name args" when only one plugin has that command.
 */
export function resolveSlashCommand(text: string, commands: SlashCommand[]): { prompt: string; command: SlashCommand } | null {
  // Names may be namespaced more than once, e.g. "/plugin:folder:command".
  const m = text.trim().match(/^\/([\w.-]+(?::[\w./-]+)*)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const [, name, args = ''] = m;
  const exact = commands.find((c) => c.fullName === name);
  const short = commands.filter((c) => c.name === name);
  const command = exact ?? (short.length === 1 ? short[0] : undefined);
  if (!command) return null;
  return { prompt: expandCommand(command, args), command };
}
