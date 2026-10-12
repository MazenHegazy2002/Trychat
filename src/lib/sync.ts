import type { Account, Conversation, McpServer, Memory, Plugin, Project, Settings, Skill } from './types';

/**
 * Cross-device sync with the TryChat server (server/trychat-server.mjs).
 * Every syncable thing is an item keyed "collection/id" with an updatedAt; the last write wins.
 * A local snapshot of what the server last confirmed lets us spot local edits and deletions.
 */

export interface SyncState {
  memories: Memory[];
  conversations: Conversation[];
  skills: Skill[];
  mcpServers: McpServer[];
  projects: Project[];
  plugins: Plugin[];
  settings: Settings;
}

export type Collection = 'memories' | 'conversations' | 'skills' | 'mcpServers' | 'projects' | 'plugins' | 'prefs';

export interface SyncItem {
  collection: Collection;
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data: any;
}

/** Preferences that follow the account. Secrets and device-specific addresses stay on the device. */
export const SYNCED_PREFS = [
  'baseUrl',
  'model',
  'systemPrompt',
  'builderMode',
  'memoryEnabled',
  'stream',
  'temperature',
  'contextMessages',
  'confirmCommands',
  'confirmWrites',
  'confirmReads',
  'repos',
  'subAgents',
  'codeExecution',
  'marketplaces',
] as const satisfies readonly (keyof Settings)[];

const key = (i: { collection: string; id: string }) => `${i.collection}/${i.id}`;

export function localItems(state: SyncState): SyncItem[] {
  const prefs: Record<string, unknown> = {};
  for (const k of SYNCED_PREFS) prefs[k] = state.settings[k];
  return [
    ...state.memories.map((m) => ({ collection: 'memories' as const, id: m.id, updatedAt: m.updatedAt ?? m.createdAt, data: m })),
    ...state.conversations.map((c) => ({ collection: 'conversations' as const, id: c.id, updatedAt: c.updatedAt, data: c })),
    ...state.skills.map((s) => ({ collection: 'skills' as const, id: s.id, updatedAt: s.updatedAt, data: s })),
    ...state.projects.map((p) => ({ collection: 'projects' as const, id: p.id, updatedAt: p.updatedAt, data: p })),
    // Plugin secrets (sensitive settings) stay on the device.
    ...state.plugins.map(({ secrets: _secrets, ...p }) => ({ collection: 'plugins' as const, id: p.id, updatedAt: p.updatedAt, data: p })),
    // Tokens and headers (API keys) stay on the device.
    ...state.mcpServers.map(({ token: _secret, headers: _headers, ...s }) => ({
      collection: 'mcpServers' as const,
      id: s.id,
      updatedAt: s.updatedAt,
      data: s,
    })),
    ...(state.settings.prefsUpdatedAt
      ? [{ collection: 'prefs' as const, id: 'prefs', updatedAt: state.settings.prefsUpdatedAt, data: prefs }]
      : []),
  ];
}

/** Local items that are new or changed since the last sync, plus tombstones for local deletions. */
export function pendingChanges(state: SyncState, snapshot: Record<string, number>): SyncItem[] {
  const items = localItems(state);
  const present = new Set(items.map(key));
  const changes = items.filter((i) => snapshot[key(i)] === undefined || i.updatedAt > snapshot[key(i)]);
  for (const k of Object.keys(snapshot)) {
    if (present.has(k) || k === 'prefs/prefs') continue;
    const [collection, ...rest] = k.split('/');
    changes.push({ collection: collection as Collection, id: rest.join('/'), updatedAt: Date.now(), deleted: true, data: null });
  }
  return changes;
}

/** Merges server items for one collection into a local list (last write wins). */
export function mergeList<T extends { id: string }>(
  list: T[],
  items: SyncItem[],
  collection: Collection,
  updatedAtOf: (x: T) => number,
  fromServer: (data: any, local?: T) => T = (d) => d,
): T[] {
  const relevant = items.filter((i) => i.collection === collection);
  if (!relevant.length) return list;
  const byId = new Map(list.map((x) => [x.id, x]));
  for (const item of relevant) {
    const local = byId.get(item.id);
    if (item.deleted) byId.delete(item.id);
    else if (!local || item.updatedAt >= updatedAtOf(local)) byId.set(item.id, fromServer(item.data, local));
  }
  return [...byId.values()];
}

export function mergePrefs(settings: Settings, items: SyncItem[]): Settings {
  const item = items.find((i) => i.collection === 'prefs' && !i.deleted);
  if (!item || (settings.prefsUpdatedAt ?? 0) > item.updatedAt) return settings;
  const next = { ...settings, prefsUpdatedAt: item.updatedAt };
  for (const k of SYNCED_PREFS) if (item.data?.[k] !== undefined) (next as any)[k] = item.data[k];
  return next;
}

export function nextSnapshot(snapshot: Record<string, number>, sent: SyncItem[], received: SyncItem[]) {
  const next = { ...snapshot };
  // The server echoes back everything it stored. A sent item it didn't store (e.g. a collection an
  // older server doesn't know yet) stays pending and is sent again on the next sync.
  const stored = new Set(received.map(key));
  for (const i of [...sent.filter((s) => stored.has(key(s))), ...received]) {
    if (i.deleted) delete next[key(i)];
    else next[key(i)] = Math.max(next[key(i)] ?? 0, i.updatedAt);
  }
  return next;
}

// ---------- HTTP ----------

async function request(serverUrl: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(serverUrl.replace(/\/+$/, '') + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(json?.error ?? `Server error ${res.status}`), { status: res.status });
  return json;
}

export async function signIn(
  serverUrl: string,
  mode: 'signin' | 'signup',
  form: { email: string; password: string; name?: string },
): Promise<Account> {
  const { token, user } = await request(serverUrl, `/auth/${mode}`, form);
  return { serverUrl: serverUrl.replace(/\/+$/, ''), token, user, cursor: 0 };
}

export async function signOut(account: Account): Promise<void> {
  await request(account.serverUrl, '/auth/signout', {}, account.token).catch(() => {});
}

export async function pushPull(
  account: Account,
  changes: SyncItem[],
): Promise<{ cursor: number; items: SyncItem[] }> {
  return request(account.serverUrl, '/sync', { since: account.cursor, changes }, account.token);
}
