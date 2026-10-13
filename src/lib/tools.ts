import { callMcpTool, mcpToolName } from './mcp';
import { normalizeLanguage, runCode } from './runner';
import { fileTools } from './fileTools';
import { phoneTools } from './phoneTools';
import type { AgentProfile } from './plugins';
import { socialTools } from './socialTools';
import { storeTools } from './storeTools';
import type { Account, Attachment, InstallItem, McpServer, McpTool, Settings, Skill, ToolCall } from './types';
import { webTools } from './webTools';
import { FILES } from './toolResult';

/**
 * Tools the model can use: GitHub (REST API with a personal access token) and the
 * user's laptop (via bridge/trychat-bridge.mjs). The model calls a tool by writing
 *   <tool name="github.read_file">{"repo":"owner/name","path":"README.md"}</tool>
 * which works with any OpenAI-compatible server, even ones without native tool calling.
 */

/** 'install' always asks the user first. */
export type Kind = 'read' | 'write' | 'command' | 'code' | 'agent' | 'mcp' | 'install';
export type Service = 'github' | 'laptop' | 'code' | 'agents' | 'skills' | 'mcp' | 'files' | 'friends' | 'store' | 'phone' | 'web';

/** Everything a tool may need at run time. */
export interface ToolContext {
  settings: Settings;
  skills: Skill[];
  mcpServers: McpServer[];
  /** Tools discovered on each MCP server, by server id. */
  mcpTools: Record<string, McpTool[]>;
  /** Provided by the store; runs helper agents in parallel and returns their combined answers. */
  runSubAgents?: (tasks: { task: string; model?: string; agent?: string }[]) => Promise<string>;
  /** Custom agents from plugins that sub-agents can run as. */
  agentProfiles?: AgentProfile[];
  /** The signed-in account (for friends and shared files). */
  account?: Account | null;
  /** Provided by the store: saves an approved plugin, skill or MCP server and makes it usable right away. */
  install?: (item: InstallItem) => Promise<string>;
  /** Values the user typed into the approval card (e.g. API keys). Never stored in the chat. */
  approval?: { secrets?: Record<string, string> };
}

export interface ToolDef {
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

export type Args = Record<string, any>;



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

/** The bridge address with http:// added when the scheme is missing and no trailing slashes. */
export function normalizeBridgeUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return !u || /^[a-z][a-z\d+.-]*:\/\//i.test(u) ? u : `http://${u}`;
}

/** Bytes of a laptop file read at a time; with the note it fits in MAX_RESULT_CHARS. */
const LAPTOP_READ_BYTES = 10_000;
/** Characters of command output (stdout + stderr) shown to the model. */
const RUN_OUTPUT_CHARS = 11_000;

/** Keeps the start and end of `text` within `budget` characters, never splitting a surrogate pair. */
function clipMiddle(text: string, budget: number, totalBytes?: number): string {
  if (text.length <= budget) return text;
  let head = Math.floor(budget / 3);
  let tail = text.length - (budget - head);
  if (/[\ud800-\udbff]/.test(text[head - 1] ?? '')) head--;
  if (/[\udc00-\udfff]/.test(text[tail] ?? '')) tail++;
  const total = totalBytes ? `; ${totalBytes} bytes in total` : '';
  return `${text.slice(0, head)}\n…[${tail - head} chars omitted${total}]…\n${text.slice(tail)}`;
}

async function bridge(settings: Settings, path: string, body?: unknown) {
  const base = normalizeBridgeUrl(settings.bridgeUrl);
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
      const list = r.entries.join('\n') || '(empty folder)';
      return r.more ? `${list}\n…and ${r.more} more not shown (list a subfolder, or use laptop.run to search)` : list;
    },
  },
  'laptop.read_file': {
    service: 'laptop',
    kind: 'read',
    description: `Read a text file on the laptop, up to ${LAPTOP_READ_BYTES} bytes at a time. For more of a long file pass "offset" (bytes to skip); a negative offset counts from the end, e.g. -${LAPTOP_READ_BYTES} for the end of a log.`,
    params: '{"path":"file/path","offset":"optional byte offset"}',
    label: (a) => `Read ${a.path} on your laptop`,
    run: async (s, a) => {
      const offset = a.offset === undefined || a.offset === null ? undefined : Number(a.offset);
      if (offset !== undefined && !Number.isSafeInteger(offset)) throw new Error('"offset" must be a whole number of bytes');
      const r = await bridge(s, '/read', { path: a.path, offset, length: LAPTOP_READ_BYTES });
      if (r.binary) return `${r.path} is a binary file (${r.size} bytes), so it can't be shown as text.`;
      if (typeof r.size !== 'number' || (r.offset === 0 && r.end >= r.size)) return r.content;
      const next = r.end < r.size ? `"offset": ${r.end} reads on from here` : 'this is the end of the file';
      return `${r.content}\n…[truncated: showed bytes ${r.offset}–${r.end} of ${r.size}; ${next}${r.offset > 0 ? ', "offset": 0 reads from the start' : ''}]`;
    },
  },
  'laptop.write_file': {
    service: 'laptop',
    kind: 'write',
    description: 'Create or overwrite a text file on the laptop.',
    params: '{"path":"file/path","content":"full file content"}',
    label: (a) => `Write ${a.path} on your laptop`,
    run: async (s, a) => {
      // A missing "content" must not wipe the file.
      if (typeof a.content !== 'string') throw new Error('"content" is required: the full new file content as a string');
      const r = await bridge(s, '/write', { path: a.path, content: a.content });
      return `Wrote ${r.bytes} bytes to ${r.path}`;
    },
  },
  'laptop.run': {
    service: 'laptop',
    kind: 'command',
    description:
      'Run a shell command on the laptop and get its output. It is stopped (with everything it started) after the bridge timeout; to leave a server running, redirect its output, e.g. "nohup npm run dev > dev.log 2>&1 &".',
    params: '{"command":"npm test","cwd":"optional/folder"}',
    label: (a) => `Run \`${a.command}\` on your laptop`,
    run: async (s, a) => {
      const r = await bridge(s, '/run', { command: a.command, cwd: a.cwd ?? '.' });
      const how = r.timedOut
        ? ` (timed out${r.timeoutMs ? ` after ${r.timeoutMs / 1000}s` : ''}; it and its child processes were stopped)`
        : r.outputLimit
          ? ` (stopped after printing more than ${Math.round(r.outputLimit / 1048576)} MB)`
          : r.signal
            ? ` (killed by signal ${r.signal})`
            : '';
      // stderr usually holds the error, so it gets its share first; stdout keeps its start and its end.
      const out: string = r.stdout ?? '';
      const err: string = r.stderr ?? '';
      const errBudget = Math.min(err.length, Math.max(RUN_OUTPUT_CHARS / 2, RUN_OUTPUT_CHARS - out.length));
      return [
        `exit code: ${r.exitCode ?? 'none'}${how}`,
        out && `stdout:\n${clipMiddle(out, RUN_OUTPUT_CHARS - errBudget, r.stdoutBytes)}`,
        err && `stderr:\n${clipMiddle(err, errBudget, r.stderrBytes)}`,
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
      params: ctx.agentProfiles?.length
        ? '{"tasks":[{"task":"...","agent":"optional agent name","model":"optional model id"}]}'
        : '{"tasks":[{"task":"...","model":"optional model id"}]}',
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
        // An agent name that isn't installed runs as a general sub-agent rather than failing the batch.
        const known = new Set((ctx.agentProfiles ?? []).map((p) => p.name));
        const unknown = [...new Set(tasks.map((t: any) => t.agent).filter((n: any) => n && !known.has(n)))];
        const result = await runSubAgents(tasks.map((t: any) => (t.agent && !known.has(t.agent) ? { ...t, agent: undefined } : t)));
        return unknown.length
          ? `${result}\n\n(No agent named ${unknown.join(', ')}; ran as general sub-agents. Available: ${[...known].join(', ') || 'none'}.)`
          : result;
      },
    };
  }

  // Files sent to the user, the phone folder, friends & shared files, the Store, and the web.
  Object.assign(tools, fileTools(ctx), phoneTools(ctx), socialTools(ctx), storeTools(ctx), webTools(ctx));

  // Servers whose names slug alike (a user's "Linear API" and plugin linear's "api") would get the same tool names,
  // and the later one would silently replace the earlier one's tools. The first keeps the plain names (user servers
  // come first); later ones are named like "Linear API 2", so every tool name maps to exactly one server.
  const namespaces = new Set<string>();
  for (const server of ctx.mcpServers) {
    if (!server.enabled) continue;
    let named = server;
    for (let n = 2; namespaces.has(mcpToolName(named, '')) && n <= namespaces.size + 1; n++) {
      named = { ...server, name: `${server.name} ${n}` };
    }
    namespaces.add(mcpToolName(named, ''));
    for (const tool of ctx.mcpTools[server.id] ?? []) {
      tools[mcpToolName(named, tool.name)] = {
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
  const agents = ctx.agentProfiles ?? [];
  if (agents.length && tools.some(([n]) => n === 'agents.run')) {
    parts.push(
      `Specialist agents you can delegate to with agents.run (set "agent" to the name):\n${agents
        .map((a) => `- ${a.name}: ${a.description}`)
        .join('\n')}`,
    );
  }
  if (ctx.settings.repos.length && githubConnected(ctx.settings)) {
    parts.push(`The user's main GitHub repositories: ${ctx.settings.repos.join(', ')}. Prefer these when they ask about "my repo".`);
  }
  return parts.length ? parts.join('\n\n') : null;
}

interface ToolBlock {
  start: number;
  end: number;
  name: string;
  body: string;
  /** False for a block still being streamed (or a "<tool …" tag at the very end). */
  closed: boolean;
}

/** Fenced code, inline code, a tool opening tag, or a tool tag cut off at the very end (while streaming). */
const SCAN_RE = /(^|\n) {0,3}(`{3,}|~{3,})[^\n]*|`+|<tool\s+name\s*=\s*(["'])([\w.\-]+)\3\s*>|<t(?:o(?:o(?:l(?:\s[^<>]*)?)?)?)?$/gi;
const OPEN_RE = /<tool\s+name\s*=\s*(["'])[\w.\-]+\1\s*>/gi;

/** Parses a tool block's body; `syntaxOk` says whether it was valid JSON at all (so the block really ends there). */
function parseArgs(body: string): { args?: Args; error?: string; syntaxOk: boolean } {
  let src = body.trim();
  const fenced = src.match(/^```[\w-]*[ \t]*\n?([\s\S]*?)\n?[ \t]*```$/);
  if (fenced) src = fenced[1].trim();
  if (!src) return { args: {}, syntaxOk: true };
  let value: unknown;
  try {
    value = JSON.parse(src);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return {
      syntaxOk: false,
      error: `Tool arguments were not valid JSON (${why}). Write one JSON object, e.g. {"path":"src"}, with double quotes and \\n for newlines inside strings.`,
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const what = value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`;
    return { syntaxOk: true, error: `Tool arguments must be a JSON object like {"arg":"value"}, not ${what}.` };
  }
  return { args: value as Args, syntaxOk: true };
}

/** Finds the tool blocks in a reply, skipping ones inside ``` fences or `inline code` (examples, not calls). */
function scanToolBlocks(text: string): ToolBlock[] {
  const blocks: ToolBlock[] = [];
  const re = new RegExp(SCAN_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[2]) {
      // Fenced code: skip to the closing fence; an unclosed fence runs to the end.
      const close = new RegExp(`\\n {0,3}${m[2][0]}{${m[2].length},}[ \\t]*(?=\\n|$)`, 'g');
      close.lastIndex = re.lastIndex;
      const c = close.exec(text);
      if (!c) break;
      re.lastIndex = c.index + c[0].length;
    } else if (m[0][0] === '`') {
      // Inline code: a backtick run of the same length on the same line closes it; otherwise it's plain text.
      const lineEnd = text.indexOf('\n', re.lastIndex);
      const limit = lineEnd === -1 ? text.length : lineEnd;
      for (let i = re.lastIndex; i < limit; ) {
        const j = text.indexOf('`', i);
        if (j === -1 || j >= limit) break;
        let k = j;
        while (text[k] === '`') k++;
        if (k - j === m[0].length) {
          re.lastIndex = k;
          break;
        }
        i = k;
      }
    } else if (m[4]) {
      const bodyStart = re.lastIndex;
      // The block ends at the first </tool> after which the body is valid JSON, so "</tool>" inside a JSON string
      // works; if none parses, at the first </tool> before the next opening tag (to report the JSON error).
      const closeRe = /<\/tool\s*>/gi;
      closeRe.lastIndex = bodyStart;
      let first: RegExpExecArray | null = null;
      let chosen: RegExpExecArray | null = null;
      for (let c = closeRe.exec(text); c; c = closeRe.exec(text)) {
        first ??= c;
        if (parseArgs(text.slice(bodyStart, c.index)).syntaxOk) {
          chosen = c;
          break;
        }
      }
      OPEN_RE.lastIndex = bodyStart;
      const nextOpen = OPEN_RE.exec(text)?.index ?? text.length;
      const close = chosen ?? (first && first.index < nextOpen ? first : null);
      if (close) {
        const end = close.index + close[0].length;
        blocks.push({ start: m.index, end, name: m[4], body: text.slice(bodyStart, close.index), closed: true });
        re.lastIndex = end;
      } else if (nextOpen === text.length) {
        blocks.push({ start: m.index, end: text.length, name: m[4], body: text.slice(bodyStart), closed: false });
        break;
      }
      // Otherwise it's prose mentioning the syntax ("<tool name=…>") before a real block: keep scanning after it.
    } else {
      blocks.push({ start: m.index, end: text.length, name: '', body: '', closed: false });
    }
  }
  return blocks;
}

/** Finds the first complete tool block in the model's reply. */
export function parseToolCall(text: string, ctx: ToolContext): { call: ToolCall | null; before: string } {
  const blocks = scanToolBlocks(text).filter((b) => b.closed);
  const block = blocks[0];
  if (!block) return { call: null, before: text };
  const { args = {}, error } = parseArgs(block.body);
  const known = getTools(ctx)[block.name];
  const call: ToolCall = {
    name: block.name,
    args,
    status: known && !error ? 'pending' : 'error',
    result: !known ? `Unknown or unavailable tool "${block.name}".` : error,
  };
  if (blocks.length > 1) {
    call.note = `Only the first tool block was run (you wrote ${blocks.length}). Use one tool at a time; send the next one now if you still need it.`;
  }
  return { call, before: text.slice(0, block.start).trim() };
}

/** Removes tool blocks, including one still streaming, from text shown to the user. Examples in code are kept. */
export function stripToolTags(text: string): string {
  let out = '';
  let pos = 0;
  for (const b of scanToolBlocks(text)) {
    // An unclosed block is hidden only while it looks like a call being streamed, not prose mentioning "<tool name=…>".
    if (!b.closed && b.name && !/^\s*([{`]|$)/.test(b.body)) continue;
    out += text.slice(pos, b.start);
    pos = b.end;
  }
  return (out + text.slice(pos)).trim();
}

const SERVICE_OF_PREFIX: Record<string, Service> = {
  github: 'github',
  laptop: 'laptop',
  code: 'code',
  agents: 'agents',
  skills: 'skills',
  mcp: 'mcp',
  // Tool name prefixes of the feature tool sets: files.*, phone.*, friends.* / shared.*, store.*, web.*
  files: 'files',
  phone: 'phone',
  friends: 'friends',
  shared: 'friends',
  store: 'store',
  web: 'web',
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

/** Network access from the runner's WebView (or obvious ways to reach it indirectly), in either language. */
const NETWORK_ANY = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon|WebTransport|RTCPeerConnection|loadPyodide|pyodide\w*|ReactNativeWebView)\b|\bimport\s*\(/;
const NETWORK_JS =
  /\bnavigator\b|\bnew\s+Image\b|\blocation\b|\bopen\s*\(|\b(?:globalThis|window|self|frames|opener|document|eval|Function|Reflect|atob|fromCharCode|Worker|SharedWorker|serviceWorker)\b|\.\s*constructor\b|['"`]constructor['"`]|\[\s*(['"`])[^'"`\]]*\1\s*\+/;
const NETWORK_PY =
  /\b(pyfetch|open_url|urlopen|urllib\d*|requests|httpx|aiohttp|socket|ssl|micropip|importlib|builtins|__builtins__|__import__|__subclasses__|__globals__)\b|\bhttp\.client\b|\b(import|from)\s+js\b|\bjs\.|\bsys\.modules\b|\b(exec|eval|compile|globals)\s*\(/;

/**
 * Whether code for code.run may use the network. The runner's WebView can reach any host, so such code (or code
 * that hides what it calls) needs the user's OK — text from a plugin or a web page could otherwise get the model
 * to send the user's data anywhere. Plain computation runs without asking. A heuristic, not a sandbox.
 */
export function codeUsesNetwork(language: string, code: string): boolean {
  const lang = normalizeLanguage(language);
  if (NETWORK_ANY.test(code)) return true;
  return (lang !== 'python' && NETWORK_JS.test(code)) || (lang !== 'javascript' && NETWORK_PY.test(code));
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
    case 'install':
      return true;
    case 'code':
      return codeUsesNetwork(String(call.args.language ?? ''), String(call.args.code ?? ''));
    case 'agent':
      return false;
    default:
      return s.confirmReads;
  }
}

/** Runs a tool; `files` are any files it sent to the user. */
export async function runToolCall(call: ToolCall, ctx: ToolContext): Promise<{ result: string; files?: Attachment[] }> {
  const def = getTools(ctx)[call.name];
  if (!def) throw new Error(`Unknown or unavailable tool "${call.name}"`);
  const out: any = await def.run(ctx, call.args);
  const files: Attachment[] | undefined = out && typeof out === 'object' && out[FILES] ? out.files : undefined;
  const value = files ? out.text : out;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  let cut = MAX_RESULT_CHARS;
  if (/[\ud800-\udbff]/.test(text[cut - 1] ?? '')) cut--; // never split a surrogate pair
  const result =
    text.length > MAX_RESULT_CHARS ? `${text.slice(0, cut)}\n…[truncated: showed the first ${cut} of ${text.length} characters]` : text;
  return files?.length ? { result, files } : { result };
}

export async function runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  return (await runToolCall(call, ctx)).result;
}

/** Re-serialises a call so the model sees its own earlier tool use in the history. */
export function formatToolCall(call: ToolCall): string {
  return `<tool name="${call.name}">${JSON.stringify(call.args)}</tool>`;
}

export function formatToolResult(call: ToolCall): string {
  const outcome =
    call.status === 'denied' ? 'The user denied this action.' : call.status === 'error' ? `Error: ${call.result}` : call.result;
  return `[Tool result: ${call.name}]\n${outcome}${call.note ? `\n\n${call.note}` : ''}`;
}
