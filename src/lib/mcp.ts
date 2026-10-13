import { fetch as streamingFetch } from 'expo/fetch';

import type { McpServer, McpTool } from './types';

/**
 * Minimal MCP client for remote servers. Speaks the Streamable HTTP transport (JSON-RPC over POST;
 * responses come back as JSON or as a short SSE stream) and the legacy HTTP+SSE transport
 * (protocol 2024-11-05: a long-lived GET event stream, plus POSTs to the endpoint it announces).
 */

const PROTOCOL_VERSION = '2025-06-18';
const LEGACY_PROTOCOL_VERSION = '2024-11-05';
const CONNECT_TIMEOUT = 30_000;
const REQUEST_TIMEOUT = 120_000;
const CLIENT_INFO = { name: 'TryChat', version: '1.0.0' };
const sessions = new Map<string, string | null>(); // server id -> Mcp-Session-Id
const versions = new Map<string, string>(); // server id -> negotiated protocol version
let nextId = 1;

/** The server's transport. When unset, a URL path ending in /sse means the legacy SSE transport. */
export function mcpTransport(server: Pick<McpServer, 'url' | 'transport'>): 'http' | 'sse' {
  return server.transport ?? (/^[^?#]*\/sse\/?(?:[?#]|$)/i.test(server.url) ? 'sse' : 'http');
}

/** The server's own headers plus its bearer token; sent on every request, whatever the transport. */
const authHeaders = (server: McpServer): Record<string, string> => ({
  ...(server.headers ?? {}),
  ...(server.token ? { Authorization: `Bearer ${server.token}` } : {}),
});

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

/** The URL to call: `url` with its secret {name} placeholders filled in from urlSecrets. */
function requestUrl(server: McpServer): string {
  const secrets = server.urlSecrets;
  return secrets ? server.url.replace(/\{([A-Za-z0-9_.-]+)\}/g, (m, key: string) => secrets[key] ?? m) : server.url;
}

async function post(
  server: McpServer,
  payload: object,
): Promise<{ status: number; messages: any[]; session?: string; type?: string }> {
  const session = sessions.get(server.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const res = await fetch(requestUrl(server), {
    signal: controller.signal,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      // The version the server agreed to; 2024-11-05 servers predate this header.
      ...(versions.get(server.id) !== '2024-11-05' ? { 'MCP-Protocol-Version': versions.get(server.id) ?? PROTOCOL_VERSION } : {}),
      ...authHeaders(server),
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text().finally(() => clearTimeout(timer));
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
    const first = messages[0];
    const msg =
      first?.error?.message ??
      first?.result?.content?.find((c: any) => c?.type === 'text')?.text ??
      text.slice(0, 300);
    const oauth = res.status === 401 && /resource_metadata/i.test(res.headers.get('www-authenticate') ?? '');
    throw Object.assign(
      new Error(`MCP ${res.status}: ${msg || res.statusText}${oauth ? ' (this server needs an OAuth sign-in or a token)' : ''}`),
      { status: res.status, sentSession: !!session },
    );
  }
  return { status: res.status, messages, session: res.headers.get('mcp-session-id') ?? undefined, type };
}

// One initialize at a time per server; concurrent first calls share it.
const initializing = new Map<string, Promise<void>>();

function initialize(server: McpServer): Promise<void> {
  const running = initializing.get(server.id);
  if (running) return running;
  const p = doInitialize(server).finally(() => initializing.delete(server.id));
  initializing.set(server.id, p);
  return p;
}

async function doInitialize(server: McpServer) {
  sessions.delete(server.id);
  versions.delete(server.id);
  const id = nextId++;
  const res = await post(server, {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  });
  const reply = res.messages.find((m) => m.id === id);
  if (!reply) throw new Error(`MCP: ${server.url} is not an MCP endpoint (got ${res.type || 'no reply'})`);
  if (reply.error) throw new Error(`MCP: ${reply.error.message}`);
  const version = reply.result?.protocolVersion;
  if (typeof version === 'string') versions.set(server.id, version);
  sessions.set(server.id, res.session ?? null);
  await post(server, { jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function httpRpc(server: McpServer, method: string, params: object): Promise<any> {
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
    // Only a 404 on a request that carried a session id means the session expired (MCP spec).
    // Anything else (e.g. a 400 for bad arguments) must not re-send the call.
    if (e?.status === 404 && e?.sentSession) {
      await initialize(server);
      return call();
    }
    throw e;
  }
}

// ---------- Legacy HTTP+SSE transport ----------
// GET the server URL as an event stream; its first `endpoint` event names the URL to POST JSON-RPC
// messages to, and replies arrive as `message` events on that stream. One stream per server.

interface Pending {
  resolve: (message: any) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface SseConnection {
  serverId: string;
  /** URL + auth it was opened with; a change opens a new connection. */
  key: string;
  url: string;
  headers: Record<string, string>;
  abort: AbortController;
  /** Where to POST messages (from the `endpoint` event). */
  endpoint?: string;
  /** Callers waiting for a reply, by JSON-RPC id (or "endpoint"). */
  pending: Map<string, Pending>;
  closed: boolean;
  error?: Error;
  /** Settles once the stream is open and the session is initialized. */
  ready: Promise<void>;
}

const connections = new Map<string, SseConnection>(); // server id -> open event stream

function closeConnection(conn: SseConnection, reason: unknown) {
  if (conn.closed) return;
  conn.closed = true;
  conn.error = reason instanceof Error ? reason : new Error(String(reason));
  if (connections.get(conn.serverId) === conn) connections.delete(conn.serverId);
  conn.abort.abort();
  for (const p of conn.pending.values()) {
    clearTimeout(p.timer);
    p.reject(conn.error);
  }
  conn.pending.clear();
}

/** The message that settles `key`. After `ms` it fails, and the connection is dropped. */
function wait(conn: SseConnection, key: string, ms?: number): Promise<any> {
  const promise = new Promise<any>((resolve, reject) => {
    if (conn.closed) {
      reject(conn.error);
      return;
    }
    const timer = ms
      ? setTimeout(() => {
          conn.pending.delete(key);
          reject(new Error(`MCP: no response from the server in ${ms / 1000}s`));
          // The stream may be silently dead; start over on the next call.
          closeConnection(conn, new Error('MCP: connection reset after a timeout'));
        }, ms)
      : undefined;
    conn.pending.set(key, { resolve, reject, timer });
  });
  promise.catch(() => {}); // whoever awaits it still gets the rejection
  return promise;
}

function settle(conn: SseConnection, key: string, message: unknown) {
  const p = conn.pending.get(key);
  if (!p) return;
  conn.pending.delete(key);
  clearTimeout(p.timer);
  p.resolve(message);
}

function onMessages(conn: SseConnection, data: any) {
  for (const m of Array.isArray(data) ? data : [data]) {
    if (!m || typeof m !== 'object' || m.id == null) continue;
    if (typeof m.method === 'string') {
      // A request from the server: answer pings, decline anything else.
      const reply = m.method === 'ping' ? { result: {} } : { error: { code: -32601, message: 'Method not found' } };
      ssePost(conn, { jsonrpc: '2.0', id: m.id, ...reply }).catch(() => {});
    } else settle(conn, String(m.id), m);
  }
}

function onSseEvent(conn: SseConnection, block: string) {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return;
  const payload = data.join('\n');
  if (event === 'endpoint') {
    let url: URL | undefined;
    try {
      url = new URL(payload.trim(), conn.url);
    } catch {
      url = undefined;
    }
    // Auth headers are sent there, so it must be on the server's own origin.
    if (!url || url.origin !== new URL(conn.url).origin) {
      closeConnection(conn, new Error('MCP: the server announced an endpoint on another origin'));
    } else settle(conn, 'endpoint', url.href);
  } else if (event === 'message') {
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    onMessages(conn, json);
  }
}

async function pump(conn: SseConnection, body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reason: unknown = new Error('MCP: the server closed the event stream');
  try {
    while (!conn.closed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Events end with a blank line. A trailing \r may be half of a \r\n, so it waits for the next chunk.
      const cut = buffer.endsWith('\r') ? buffer.length - 1 : buffer.length;
      const events = buffer.slice(0, cut).replace(/\r\n?/g, '\n').split('\n\n');
      buffer = events.pop()! + buffer.slice(cut);
      events.forEach((e) => onSseEvent(conn, e));
    }
  } catch (e) {
    reason = e;
  }
  closeConnection(conn, reason);
}

async function ssePost(conn: SseConnection, message: object): Promise<void> {
  const res = await fetch(conn.endpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...conn.headers },
    body: JSON.stringify(message),
  });
  const text = await res.text();
  if (!res.ok) {
    throw Object.assign(new Error(`MCP ${res.status}: ${text.slice(0, 300) || res.statusText}`), { status: res.status });
  }
  // Replies belong on the stream (the POST gets 202 Accepted), but take one from the body too.
  if (text.trim() && (res.headers.get('content-type') ?? '').includes('json')) {
    try {
      onMessages(conn, JSON.parse(text));
    } catch {
      // not JSON
    }
  }
}

async function sseRequest(conn: SseConnection, method: string, params: object): Promise<any> {
  const id = nextId++;
  // Registered before the POST: the reply can arrive on the stream before the POST returns.
  const reply = wait(conn, String(id), REQUEST_TIMEOUT);
  try {
    await ssePost(conn, { jsonrpc: '2.0', id, method, params });
  } catch (e) {
    clearTimeout(conn.pending.get(String(id))?.timer);
    conn.pending.delete(String(id));
    throw e;
  }
  const message = await reply;
  if (message.error) throw new Error(`MCP: ${message.error.message}`);
  return message.result;
}

async function connectSse(conn: SseConnection): Promise<void> {
  const timer = setTimeout(() => closeConnection(conn, new Error('MCP: timed out connecting to the server')), CONNECT_TIMEOUT);
  try {
    // expo/fetch can stream a response body on iOS and Android; React Native's built-in fetch can't.
    const res = await streamingFetch(conn.url, {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache', ...conn.headers },
      signal: conn.abort.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`MCP ${res.status}: ${text.slice(0, 300) || res.statusText}`), { status: res.status });
    }
    if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      throw new Error('MCP: the server did not open an SSE stream (is it a Streamable HTTP server?)');
    }
    const endpoint = wait(conn, 'endpoint');
    void pump(conn, res.body);
    conn.endpoint = await endpoint;
    await sseRequest(conn, 'initialize', { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
    await ssePost(conn, { jsonrpc: '2.0', method: 'notifications/initialized' });
  } finally {
    clearTimeout(timer);
  }
}

/** The server's open, initialized connection; opens (or reopens) one when needed. */
async function sseConnection(server: McpServer): Promise<SseConnection> {
  const key = JSON.stringify([requestUrl(server), server.token ?? '', server.headers ?? {}]);
  const existing = connections.get(server.id);
  if (existing && existing.key === key && !existing.closed) {
    await existing.ready;
    return existing;
  }
  if (existing) closeConnection(existing, new Error('MCP: server settings changed'));
  const conn: SseConnection = {
    serverId: server.id,
    key,
    url: requestUrl(server),
    headers: authHeaders(server),
    abort: new AbortController(),
    pending: new Map(),
    closed: false,
    ready: Promise.resolve()
      .then(() => connectSse(conn))
      .catch((e) => {
        closeConnection(conn, e);
        throw conn.error;
      }),
  };
  connections.set(server.id, conn);
  await conn.ready;
  return conn;
}

async function sseRpc(server: McpServer, method: string, params: object): Promise<any> {
  const conn = await sseConnection(server);
  try {
    return await sseRequest(conn, method, params);
  } catch (e: any) {
    if (e?.status === 404) {
      closeConnection(conn, e); // session expired: reconnect and re-initialize
      return sseRequest(await sseConnection(server), method, params);
    }
    throw e;
  }
}

function rpc(server: McpServer, method: string, params: object): Promise<any> {
  if (mcpTransport(server) === 'sse') return sseRpc(server, method, params);
  const stale = connections.get(server.id);
  if (stale) closeConnection(stale, new Error('MCP: switched to Streamable HTTP'));
  return httpRpc(server, method, params);
}

export async function listMcpTools(server: McpServer): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 50; page++) {
    const result = await rpc(server, 'tools/list', cursor ? { cursor } : {});
    tools.push(...(result?.tools ?? []));
    cursor = result?.nextCursor;
    // Stop on a repeated cursor too, so a misbehaving server can't loop forever.
    if (!cursor || seen.has(cursor) || tools.length >= 500) break;
    seen.add(cursor);
  }
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
