import type { Settings, ToolCall } from './types';

/**
 * Tools the model can use: GitHub (REST API with a personal access token) and the
 * user's laptop (via bridge/trychat-bridge.mjs). The model calls a tool by writing
 *   <tool name="github.read_file">{"repo":"owner/name","path":"README.md"}</tool>
 * which works with any OpenAI-compatible server, even ones without native tool calling.
 */

type Kind = 'read' | 'write' | 'command';

interface ToolDef {
  service: 'github' | 'laptop';
  kind: Kind;
  description: string;
  params: string;
  /** Short human label shown in the chat, e.g. "Read README.md on GitHub". */
  label: (args: Args) => string;
  run: (settings: Settings, args: Args) => Promise<unknown>;
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

const TOOLS: Record<string, ToolDef> = {
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

function available(s: Settings): [string, ToolDef][] {
  return Object.entries(TOOLS).filter(
    ([, t]) => (t.service === 'github' && githubConnected(s)) || (t.service === 'laptop' && laptopConnected(s)),
  );
}

export function toolInstructions(s: Settings): string | null {
  const tools = available(s);
  if (!tools.length) return null;
  return `You can use tools to work with the user's ${[
    githubConnected(s) && 'GitHub account',
    laptopConnected(s) && 'laptop',
  ]
    .filter(Boolean)
    .join(' and ')}.
To use a tool, write ONE tool block at the end of your reply and then stop writing:
<tool name="TOOL_NAME">{"arg":"value"}</tool>
The arguments must be valid JSON. The result is sent back to you in the next message, then continue the task.
Use one tool at a time. Explain briefly what you're about to do before the tool block. Never invent tool results.
Available tools:
${tools.map(([name, t]) => `- ${name} ${t.params} — ${t.description}`).join('\n')}`;
}

const TOOL_RE = /<tool\s+name="([\w.]+)"\s*>([\s\S]*?)<\/tool>/i;

/** Finds the first complete tool block in the model's reply. */
export function parseToolCall(text: string): { call: ToolCall | null; before: string } {
  const m = text.match(TOOL_RE);
  if (!m) return { call: null, before: text };
  let args: Args = {};
  let parseError: string | undefined;
  try {
    args = m[2].trim() ? JSON.parse(m[2]) : {};
  } catch {
    parseError = 'Tool arguments were not valid JSON.';
  }
  const known = TOOLS[m[1]];
  const call: ToolCall = {
    name: m[1],
    args,
    status: known && !parseError ? 'pending' : 'error',
    result: !known ? `Unknown tool "${m[1]}".` : parseError,
  };
  return { call, before: text.slice(0, m.index).trim() };
}

/** Removes tool blocks, including one still streaming, from text shown to the user. */
export function stripToolTags(text: string): string {
  return text.replace(/<tool\s[\s\S]*?(<\/tool>|$)/gi, '').trim();
}

export function toolLabel(call: ToolCall): string {
  const def = TOOLS[call.name];
  try {
    return def ? def.label(call.args) : call.name;
  } catch {
    return call.name;
  }
}

export function toolService(call: ToolCall): 'github' | 'laptop' | null {
  return TOOLS[call.name]?.service ?? null;
}

export function needsApproval(call: ToolCall, s: Settings): boolean {
  const kind = TOOLS[call.name]?.kind;
  if (kind === 'command') return s.confirmCommands;
  if (kind === 'write') return s.confirmWrites;
  return s.confirmReads;
}

export async function runTool(call: ToolCall, s: Settings): Promise<string> {
  const def = TOOLS[call.name];
  if (!def) throw new Error(`Unknown tool "${call.name}"`);
  const out = await def.run(s, call.args);
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
