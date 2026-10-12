import { callMcpTool, mcpToolName } from './mcp';
import { normalizeLanguage, runCode } from './runner';
import type { McpServer, McpTool, Settings, Skill, ToolCall } from './types';

/**
 * Tools the model can use: GitHub (REST API with a personal access token) and the
 * user's laptop (via bridge/trychat-bridge.mjs). The model calls a tool by writing
 *   <tool name="github.read_file">{"repo":"owner/name","path":"README.md"}</tool>
 * which works with any OpenAI-compatible server, even ones without native tool calling.
 */

type Kind = 'read' | 'write' | 'command' | 'code' | 'agent' | 'mcp';
export type Service = 'github' | 'laptop' | 'code' | 'agents' | 'skills' | 'mcp';

/** Everything a tool may need at run time. */
export interface ToolContext {
  settings: Settings;
  skills: Skill[];
  mcpServers: McpServer[];
  /** Tools discovered on each MCP server, by server id. */
  mcpTools: Record<string, McpTool[]>;
  /** Provided by the store; runs helper agents in parallel and returns their combined answers. */
  runSubAgents?: (tasks: { task: string; model?: string }[]) => Promise<string>;
}

interface ToolDef {
  service: Service;
  kind: Kind;
  description: string;
  params: string;
  /** Short human label shown in the chat, e.g. "Read README.md on GitHub". */
  label: (args: Args) => string;
  run: (ctx: ToolContext, args: Args) => Promise<unknown>;
  /** For MCP tools: the server they belong to. */
  server?: McpServer;
}

type Args = Record<string, any>;

const MAX_RESULT_CHARS = 12000;

// ---------- GitHub ----------

async function gh(settings: Settings, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${settings.githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${json?.message ?? text}`);
  return json;
}

const encodePath = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function githubWhoAmI(settings: Settings): Promise<string> {
  const user = await gh(settings, '/user');
  return user.login;
}

// ---------- Laptop bridge ----------

async function bridge(settings: Settings, path: string, body?: unknown) {
  const base = settings.bridgeUrl.replace(/\/+$/, '');
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${settings.bridgeToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Laptop ${res.status}: ${json?.error ?? res.statusText}`);
  return json;
}

export async function laptopInfo(settings: Settings): Promise<{ hostname: string; platform: string; root: string }> {
  return bridge(settings, '/health');
}

// ---------- Tool table ----------

const STATIC_TOOLS: Record<string, Omit<ToolDef, 'run'> & { run: (s: Settings, args: Args) => Promise<unknown> }> = {
  'github.list_repos': {
    service: 'github',
    kind: 'read',
    description: "List the user's repositories (most recently updated first).",
    params: '{}',
    label: () => 'Listed your GitHub repositories',
    run: async (s) => {
      const repos = await gh(s, '/user/repos?per_page=50&sort=updated');
      return repos.map((r: any) => `${r.full_name}${r.private ? ' (private)' : ''} — ${r.description ?? ''}`).join('\n');
    },
  },
  'github.list_files': {
    service: 'github',
    kind: 'read',
    description: 'List files in a folder of a repository.',
    params: '{"repo":"owner/name","path":"optional/folder","ref":"optional branch"}',
    label: (a) => `Listed ${a.path || '/'} in ${a.repo}`,
    run: async (s, a) => {
      const q = a.ref ? `?ref=${encodeURIComponent(a.ref)}` : '';
      const items = await gh(s, `/repos/${a.repo}/contents/${encodePath(a.path ?? '')}${q}`);
      return Array.isArray(items) ? items.map((i: any) => (i.type === 'dir' ? i.path + '/' : i.path)).join('\n') : items.path;
    },
  },
  'github.read_file': {
    service: 'github',
    kind: 'read',
    description: 'Read a file from a repository.',
    params: '{"repo":"owner/name","path":"file/path","ref":"optional branch"}',
    label: (a) => `Read ${a.path} on GitHub`,
    run: async (s, a) => {
      const q = a.ref ? `?ref=${encodeURIComponent(a.ref)}` : '';
      const file = await gh(s, `/repos/${a.repo}/contents/${encodePath(a.path)}${q}`);
      if (Array.isArray(file)) throw new Error(`${a.path} is a folder; use github.list_files`);
      return base64ToUtf8(file.content ?? '');
    },
  },
  'github.write_file': {
    service: 'github',
    kind: 'write',
    description: 'Create or update a file in a repository (commits directly to the branch).',
    params: '{"repo":"owner/name","path":"file/path","content":"full new file content","message":"commit message","branch":"optional"}',
    label: (a) => `Commit ${a.path} to ${a.repo}${a.branch ? `@${a.branch}` : ''}`,
    run: async (s, a) => {
      const url = `/repos/${a.repo}/contents/${encodePath(a.path)}`;
      let sha: string | undefined;
      try {
        sha = (await gh(s, url + (a.branch ? `?ref=${encodeURIComponent(a.branch)}` : ''))).sha;
      } catch {
        sha = undefined; // new file
      }
      const res = await gh(s, url, {
        method: 'PUT',
        body: { message: a.message || `Update ${a.path}`, content: utf8ToBase64(a.content ?? ''), sha, branch: a.branch },
      });
      return `Committed ${res.commit?.sha?.slice(0, 7)}: ${res.commit?.html_url}`;
    },
  },
  'github.list_issues': {
    service: 'github',
    kind: 'read',
    description: 'List issues of a repository.',
    params: '{"repo":"owner/name","state":"open|closed|all"}',
    label: (a) => `Listed issues in ${a.repo}`,
    run: async (s, a) => {
      const issues = await gh(s, `/repos/${a.repo}/issues?state=${a.state ?? 'open'}&per_page=30`);
      return issues.map((i: any) => `#${i.number} ${i.title}${i.pull_request ? ' (PR)' : ''}`).join('\n') || 'No issues.';
    },
  },
  'github.create_issue': {
    service: 'github',
    kind: 'write',
    description: 'Open a new issue.',
    params: '{"repo":"owner/name","title":"...","body":"..."}',
    label: (a) => `Open issue “${a.title}” in ${a.repo}`,
    run: async (s, a) => {
      const issue = await gh(s, `/repos/${a.repo}/issues`, { method: 'POST', body: { title: a.title, body: a.body } });
      return `Opened #${issue.number}: ${issue.html_url}`;
    },
  },
  'laptop.list_files': {
    service: 'laptop',
    kind: 'read',
    description: 'List files in a folder on the laptop (paths are relative to the bridge root).',
    params: '{"path":"optional/folder"}',
    label: (a) => `Listed ${a.path || 'files'} on your laptop`,
    run: async (s, a) => {
      const r = await bridge(s, '/list', { path: a.path ?? '.' });
      return r.entries.join('\n') || '(empty folder)';
    },
  },
  'laptop.read_file': {
    service: 'laptop',
    kind: 'read',
    description: 'Read a text file on the laptop.',
    params: '{"path":"file/path"}',
    label: (a) => `Read ${a.path} on your laptop`,
    run: async (s, a) => (await bridge(s, '/read', { path: a.path })).content,
  },
  'laptop.write_file': {
    service: 'laptop',
    kind: 'write',
    description: 'Create or overwrite a text file on the laptop.',
    params: '{"path":"file/path","content":"full file content"}',
    label: (a) => `Write ${a.path} on your laptop`,
    run: async (s, a) => {
      const r = await bridge(s, '/write', { path: a.path, content: a.content ?? '' });
      return `Wrote ${r.bytes} bytes to ${r.path}`;
    },
  },
  'laptop.run': {
    service: 'laptop',
    kind: 'command',
    description: 'Run a shell command on the laptop and get its output.',
    params: '{"command":"npm test","cwd":"optional/folder"}',
    label: (a) => `Run \`${a.command}\` on your laptop`,
    run: async (s, a) => {
      const r = await bridge(s, '/run', { command: a.command, cwd: a.cwd ?? '.' });
      return [
        `exit code: ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}`,
        r.stdout && `stdout:\n${r.stdout}`,
        r.stderr && `stderr:\n${r.stderr}`,
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
};

export const githubConnected = (s: Settings) => !!s.githubToken;
export const laptopConnected = (s: Settings) => !!s.bridgeUrl && !!s.bridgeToken;

/** All tools available right now, given connections, settings, skills and MCP servers. */
export function getTools(ctx: ToolContext): Record<string, ToolDef> {
  const s = ctx.settings;
  const tools: Record<string, ToolDef> = {};
  for (const [name, t] of Object.entries(STATIC_TOOLS)) {
    if ((t.service === 'github' && githubConnected(s)) || (t.service === 'laptop' && laptopConnected(s))) {
      tools[name] = { ...t, run: (c, a) => t.run(c.settings, a) };
    }
  }

  if (s.codeExecution) {
    tools['code.run'] = {
      service: 'code',
      kind: 'code',
      description:
        'Run JavaScript or Python on the phone and get the printed output (sandboxed; Python has numpy/pandas via Pyodide; no access to the user\'s files). Use it to calculate, test code, or check data.',
      params: '{"language":"python|javascript","code":"print(2**10)"}',
      label: (a) => `Ran ${normalizeLanguage(a.language ?? '') ?? 'code'}`,
      run: async (_c, a) => {
        const lang = normalizeLanguage(a.language ?? '');
        if (!lang) throw new Error('language must be "python" or "javascript"');
        return runCode(lang, String(a.code ?? ''));
      },
    };
  }

  const enabledSkills = ctx.skills.filter((k) => k.enabled);
  if (enabledSkills.length) {
    tools['skills.read'] = {
      service: 'skills',
      kind: 'read',
      description: 'Load the full instructions of one of the user\'s skills before doing a task it covers.',
      params: '{"name":"skill name"}',
      label: (a) => `Loaded the “${a.name}” skill`,
      run: async (_c, a) => {
        const skill = enabledSkills.find((k) => k.name.toLowerCase() === String(a.name ?? '').toLowerCase());
        if (!skill) throw new Error(`No skill named "${a.name}". Available: ${enabledSkills.map((k) => k.name).join(', ')}`);
        return skill.instructions;
      },
    };
  }

  if (s.subAgents && ctx.runSubAgents) {
    const runSubAgents = ctx.runSubAgents;
    tools['agents.run'] = {
      service: 'agents',
      kind: 'agent',
      description:
        'Send up to 5 sub-agents to work in parallel. Each gets one self-contained task (include all context it needs), can use the read-only tools and code.run, and returns its answer. Use for research, comparing options, or splitting big jobs.',
      params: '{"tasks":[{"task":"...","model":"optional model id"}]}',
      label: (a) => {
        const n = Array.isArray(a.tasks) ? a.tasks.length : 0;
        return `Sent ${n} sub-agent${n === 1 ? '' : 's'}`;
      },
      run: async (_c, a) => {
        const tasks = (Array.isArray(a.tasks) ? a.tasks : [])
          .map((t: any) => (typeof t === 'string' ? { task: t } : t))
          .filter((t: any) => t?.task)
          .slice(0, 5);
        if (!tasks.length) throw new Error('Give at least one task: {"tasks":[{"task":"..."}]}');
        return runSubAgents(tasks);
      },
    };
  }

  for (const server of ctx.mcpServers) {
    if (!server.enabled) continue;
    for (const tool of ctx.mcpTools[server.id] ?? []) {
      tools[mcpToolName(server, tool.name)] = {
        service: 'mcp',
        kind: 'mcp',
        server,
        description: `[${server.name}] ${(tool.description ?? '').slice(0, 300)}`,
        params: schemaHint(tool.inputSchema),
        label: () => `Used ${tool.name} on ${server.name}`,
        run: (_c, a) => callMcpTool(server, tool.name, a),
      };
    }
  }
  return tools;
}

/** Compact '{"arg":"type"}' summary of a JSON schema so the prompt stays short. */
function schemaHint(schema: any): string {
  const props = schema?.properties ?? {};
  const required: string[] = schema?.required ?? [];
  const entries = Object.entries(props).map(
    ([k, v]: [string, any]) => `"${k}${required.includes(k) ? '' : '?'}":"${v?.type ?? 'any'}"`,
  );
  return `{${entries.join(',')}}`;
}

export function toolInstructions(ctx: ToolContext, only?: (name: string, t: ToolDef) => boolean): string | null {
  const tools = Object.entries(getTools(ctx)).filter(([n, t]) => !only || only(n, t));
  const parts: string[] = [];
  if (tools.length) {
    parts.push(`You can use tools. To use one, write ONE tool block at the end of your reply and then stop writing:
<tool name="TOOL_NAME">{"arg":"value"}</tool>
The arguments must be valid JSON. The result is sent back to you in the next message; then continue the task.
Use one tool at a time. Briefly say what you're about to do before the tool block. Never invent tool results.
Available tools:
${tools.map(([name, t]) => `- ${name} ${t.params} — ${t.description}`).join('\n')}`);
  }
  const skills = ctx.skills.filter((k) => k.enabled);
  if (skills.length && tools.some(([n]) => n === 'skills.read')) {
    parts.push(
      `The user has these skills. When a task matches one, load it with skills.read first and follow it:\n${skills
        .map((k) => `- ${k.name}: ${k.description}`)
        .join('\n')}`,
    );
  }
  if (ctx.settings.repos.length && githubConnected(ctx.settings)) {
    parts.push(`The user's main GitHub repositories: ${ctx.settings.repos.join(', ')}. Prefer these when they ask about "my repo".`);
  }
  return parts.length ? parts.join('\n\n') : null;
}

const TOOL_RE = /<tool\s+name="([\w.\-]+)"\s*>([\s\S]*?)<\/tool>/i;

/** Finds the first complete tool block in the model's reply. */
export function parseToolCall(text: string, ctx: ToolContext): { call: ToolCall | null; before: string } {
  const m = text.match(TOOL_RE);
  if (!m) return { call: null, before: text };
  let args: Args = {};
  let parseError: string | undefined;
  try {
    args = m[2].trim() ? JSON.parse(m[2]) : {};
  } catch {
    parseError = 'Tool arguments were not valid JSON.';
  }
  const known = getTools(ctx)[m[1]];
  const call: ToolCall = {
    name: m[1],
    args,
    status: known && !parseError ? 'pending' : 'error',
    result: !known ? `Unknown or unavailable tool "${m[1]}".` : parseError,
  };
  return { call, before: text.slice(0, m.index).trim() };
}

/** Removes tool blocks, including one still streaming, from text shown to the user. */
export function stripToolTags(text: string): string {
  return text.replace(/<tool\s[\s\S]*?(<\/tool>|$)/gi, '').trim();
}

const SERVICE_OF_PREFIX: Record<string, Service> = {
  github: 'github',
  laptop: 'laptop',
  code: 'code',
  agents: 'agents',
  skills: 'skills',
  mcp: 'mcp',
};

export function toolService(call: ToolCall): Service | null {
  return SERVICE_OF_PREFIX[call.name.split('.')[0]] ?? null;
}

export function toolLabel(call: ToolCall, ctx?: ToolContext): string {
  const def = ctx ? getTools(ctx)[call.name] : STATIC_TOOLS[call.name];
  try {
    if (def) return def.label(call.args);
  } catch {
    // fall through
  }
  if (call.name.startsWith('mcp.')) return `Used ${call.name.split('.').slice(2).join('.')} (${call.name.split('.')[1]})`;
  if (call.name === 'code.run') return `Ran ${call.args.language ?? 'code'}`;
  if (call.name === 'agents.run') return 'Sent sub-agents';
  return call.name;
}

export function needsApproval(call: ToolCall, ctx: ToolContext): boolean {
  const def = getTools(ctx)[call.name];
  const s = ctx.settings;
  switch (def?.kind) {
    case 'command':
      return s.confirmCommands;
    case 'write':
      return s.confirmWrites;
    case 'mcp':
      return def.server?.confirm ?? true;
    case 'code':
    case 'agent':
      return false;
    default:
      return s.confirmReads;
  }
}

export async function runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const def = getTools(ctx)[call.name];
  if (!def) throw new Error(`Unknown or unavailable tool "${call.name}"`);
  const out = await def.run(ctx, call.args);
  const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
  return text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + '\n…[truncated]' : text;
}

/** Re-serialises a call so the model sees its own earlier tool use in the history. */
export function formatToolCall(call: ToolCall): string {
  return `<tool name="${call.name}">${JSON.stringify(call.args)}</tool>`;
}

export function formatToolResult(call: ToolCall): string {
  const outcome =
    call.status === 'denied' ? 'The user denied this action.' : call.status === 'error' ? `Error: ${call.result}` : call.result;
  return `[Tool result: ${call.name}]\n${outcome}`;
}
