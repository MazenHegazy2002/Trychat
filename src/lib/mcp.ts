import type { McpServer, McpTool } from './types';

/**
 * Minimal MCP client for remote servers using the Streamable HTTP transport
 * (JSON-RPC over POST; responses come back as JSON or as a short SSE stream).
 */

const PROTOCOL_VERSION = '2025-06-18';
const sessions = new Map<string, string | null>(); // server id -> Mcp-Session-Id
let nextId = 1;

function parseSse(text: string): any[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n'),
    )
    .filter(Boolean)
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function post(server: McpServer, payload: object): Promise<{ status: number; messages: any[]; session?: string }> {
  const session = sessions.get(server.id);
  const res = await fetch(server.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...(server.token ? { Authorization: `Bearer ${server.token}` } : {}),
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  let messages: any[] = [];
  if (type.includes('text/event-stream')) messages = parseSse(text);
  else if (text.trim()) {
    try {
      const json = JSON.parse(text);
      messages = Array.isArray(json) ? json : [json];
    } catch {
      messages = [];
    }
  }
  if (!res.ok && res.status !== 202) {
    const msg = messages[0]?.error?.message ?? text.slice(0, 300);
    throw Object.assign(new Error(`MCP ${res.status}: ${msg || res.statusText}`), { status: res.status });
  }
  return { status: res.status, messages, session: res.headers.get('mcp-session-id') ?? undefined };
}

async function initialize(server: McpServer) {
  sessions.delete(server.id);
  const id = nextId++;
  const res = await post(server, {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'TryChat', version: '1.0.0' } },
  });
  const reply = res.messages.find((m) => m.id === id);
  if (reply?.error) throw new Error(`MCP: ${reply.error.message}`);
  sessions.set(server.id, res.session ?? null);
  await post(server, { jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function rpc(server: McpServer, method: string, params: object): Promise<any> {
  if (!sessions.has(server.id)) await initialize(server);
  const call = async () => {
    const id = nextId++;
    const res = await post(server, { jsonrpc: '2.0', id, method, params });
    const reply = res.messages.find((m) => m.id === id);
    if (!reply) throw new Error('MCP: no response from server');
    if (reply.error) throw new Error(`MCP: ${reply.error.message}`);
    return reply.result;
  };
  try {
    return await call();
  } catch (e: any) {
    if (e?.status === 404 || e?.status === 400) {
      await initialize(server); // session expired
      return call();
    }
    throw e;
  }
}

export async function listMcpTools(server: McpServer): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const result = await rpc(server, 'tools/list', cursor ? { cursor } : {});
    tools.push(...(result?.tools ?? []));
    cursor = result?.nextCursor;
  } while (cursor && tools.length < 500);
  return tools;
}

export async function callMcpTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await rpc(server, 'tools/call', { name, arguments: args });
  const parts = (result?.content ?? []).map((c: any) => {
    if (c.type === 'text') return c.text;
    if (c.type === 'resource') return c.resource?.text ?? `[resource ${c.resource?.uri}]`;
    if (c.type === 'image') return `[image ${c.mimeType}]`;
    return JSON.stringify(c);
  });
  if (result?.structuredContent && !parts.length) parts.push(JSON.stringify(result.structuredContent, null, 2));
  const text = parts.join('\n') || '(no output)';
  if (result?.isError) throw new Error(text);
  return text;
}

/** Tool name the model sees, e.g. "mcp.docs.search". */
export function mcpToolName(server: McpServer, tool: string): string {
  const slug = server.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || server.id;
  return `mcp.${slug}.${tool}`;
}
