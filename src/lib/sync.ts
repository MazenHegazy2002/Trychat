import { secretsToKeep, urlOrigin } from './plugins';
import type { Account, Conversation, McpServer, Memory, Plugin, Project, Settings, Skill } from './types';

/**
 * Cross-device sync with the TryChat server (server/trychat-server.mjs).
 * Every syncable thing is an item keyed "collection/id" with an updatedAt; the last write wins
 * (preferences merge key by key). A local snapshot of what the server last confirmed lets us spot
 * local edits and deletions.
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
/** Sent with every sync so the server only sends (and accepts) what this build can store. */
export const COLLECTIONS: Collection[] = ['memories', 'conversations', 'skills', 'mcpServers', 'projects', 'plugins', 'prefs'];
/** What a cursor saved by a build that didn't send `collections` covers (the server's legacy set). */
const LEGACY_COLLECTIONS: string[] = ['memories', 'conversations', 'skills', 'mcpServers', 'projects', 'prefs'];

/** Changes go up in requests of about this size; a bigger item goes alone. */
const BATCH_BYTES = 4_000_000;
/** Above this an item can't be uploaded at all (the server takes at most 20 MB per request). */
const MAX_ITEM_BYTES = 20 * 1024 * 1024 - 128 * 1024;

export interface SyncItem {
  collection: Collection;
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data: any;
  /** Chats only: the changed tail of the messages on top of the server copy at `base`. */
  patch?: { base: number; keep: number; messages: unknown[] };
  /** Client-side: fields of the local copy to keep when merging (a chat with a reply in progress). */
  keep?: string[];
}

/** Ack for an item the server stored from this request. */
export interface StoredAck {
  collection: Collection;
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

/**
 * Sync state persisted next to the snapshot: when each local deletion really happened, and per chat
 * the message fingerprints of the copy the server confirmed (to upload only the changed tail).
 */
export interface SyncMeta {
  deletedAt: Record<string, number>;
  messages: Record<string, { at: number; h: string[] }>;
}
export const EMPTY_META: SyncMeta = { deletedAt: {}, messages: {} };

/** A timestamp for an edit: never earlier than the previous one, even if this device's clock is behind. */
export const stamp = (prev?: number) => Math.max(Date.now(), (prev ?? 0) + 1);

/** Preferences that follow the account. Secrets and device-specific addresses stay on the device. */
export const SYNCED_PREFS = [
  'baseUrl',
  'webAccess',
  'model',
  'systemPrompt',
  'builderMode',
  'memoryEnabled',
  'stream',
  'temperature',
  'transcriptionModel',
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
const PREF_TIMES = 'updatedAtByKey';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Records deletions with the time they happened (sent as the tombstone's time). */
export function noteDeleted(meta: SyncMeta, collection: Collection, ids: string[]): SyncMeta {
  const now = Date.now();
  const deletedAt = { ...meta.deletedAt };
  for (const id of ids) deletedAt[`${collection}/${id}`] = now;
  return { ...meta, deletedAt };
}

/** New timestamps after changing these settings keys (only synced preferences count). */
export function touchPrefs(settings: Settings, keys: string[]): Pick<Settings, 'prefsUpdatedAt' | 'prefsKeyUpdatedAt'> | null {
  const touched = keys.filter((k) => (SYNCED_PREFS as readonly string[]).includes(k));
  if (!touched.length) return null;
  const t = stamp(settings.prefsUpdatedAt);
  const times = { ...settings.prefsKeyUpdatedAt };
  for (const k of touched) times[k] = t;
  return { prefsUpdatedAt: t, prefsKeyUpdatedAt: times };
}

export function localItems(state: SyncState): SyncItem[] {
  const prefs: Record<string, unknown> = {};
  const times: Record<string, number> = {};
  for (const k of SYNCED_PREFS) {
    prefs[k] = state.settings[k];
    times[k] = state.settings.prefsKeyUpdatedAt?.[k] ?? state.settings.prefsUpdatedAt ?? 0;
  }
  prefs[PREF_TIMES] = times;
  return [
    ...state.memories.map((m) => ({ collection: 'memories' as const, id: m.id, updatedAt: m.updatedAt ?? m.createdAt, data: m })),
    ...state.conversations.map((c) => ({ collection: 'conversations' as const, id: c.id, updatedAt: c.updatedAt, data: c })),
    ...state.skills.map((s) => ({ collection: 'skills' as const, id: s.id, updatedAt: s.updatedAt, data: s })),
    ...state.projects.map((p) => ({ collection: 'projects' as const, id: p.id, updatedAt: p.updatedAt, data: p })),
    // Plugin secrets (sensitive settings) stay on the device.
    ...state.plugins.map(({ secrets: _secrets, ...p }) => ({ collection: 'plugins' as const, id: p.id, updatedAt: p.updatedAt, data: p })),
    // Tokens, headers and secret URL values (API keys) stay on the device.
    ...state.mcpServers.map(({ token: _secret, headers: _headers, urlSecrets: _urlSecrets, ...s }) => ({
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

/**
 * Local items that are new or changed since the last sync, plus tombstones for local deletions,
 * stamped with when the deletion happened (`deletedAt`) but always later than the confirmed copy.
 */
export function pendingChanges(state: SyncState, snapshot: Record<string, number>, deletedAt: Record<string, number> = {}): SyncItem[] {
  const items = localItems(state);
  const present = new Set(items.map(key));
  const changes = items.filter((i) => snapshot[key(i)] === undefined || i.updatedAt > snapshot[key(i)]);
  for (const k of Object.keys(snapshot)) {
    if (present.has(k) || k === 'prefs/prefs') continue;
    const [collection, ...rest] = k.split('/');
    const updatedAt = Math.max(deletedAt[k] ?? Date.now(), snapshot[k] + 1);
    changes.push({ collection: collection as Collection, id: rest.join('/'), updatedAt, deleted: true, data: null });
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
    if (item.deleted) {
      // A local copy edited after the deletion survives (and is uploaded again).
      if (local && item.updatedAt >= updatedAtOf(local)) byId.delete(item.id);
    } else if (!local || item.updatedAt >= updatedAtOf(local)) {
      let next = fromServer(item.data, local);
      if (local && item.keep) {
        // Keep these local fields (a chat's messages while a reply is in progress) and make the merged
        // copy newer than the server's, so it is uploaded once the reply is done.
        const kept: Record<string, unknown> = {};
        for (const f of item.keep) kept[f] = (local as any)[f];
        next = { ...next, ...kept, updatedAt: Math.max(updatedAtOf(local), item.updatedAt + 1) };
      }
      byId.set(item.id, next);
    }
  }
  return [...byId.values()];
}

/**
 * A plugin from the server. Its secrets never sync; this device's stay only where the synced copy still sends them
 * to the same origins (see secretsToKeep), so a change made elsewhere can't redirect a device-only token.
 */
export function syncedPlugin(data: Plugin, local?: Plugin): Plugin {
  return { ...data, secrets: local ? secretsToKeep(local, data) : undefined };
}

/**
 * An MCP server from the server. Its token, headers and secret URL values never sync; this device's are kept only
 * while the URL's origin is unchanged. A server new to this device, or whose origin changed, asks before every tool call.
 */
export function syncedMcpServer(data: McpServer, local?: McpServer): McpServer {
  const { token: _token, headers: _headers, urlSecrets: _urlSecrets, ...rest } = data;
  if (!local || urlOrigin(data.url) !== urlOrigin(local.url)) return { ...rest, confirm: true };
  return { ...rest, token: local.token, headers: local.headers, urlSecrets: local.urlSecrets };
}

/** Merges the server's preferences key by key: the most recently changed value of each wins. */
export function mergePrefs(settings: Settings, items: SyncItem[]): Settings {
  const item = items.find((i) => i.collection === 'prefs' && !i.deleted);
  if (!item) return settings;
  const remote = item.data ?? {};
  const remoteTimes: Record<string, number> = remote[PREF_TIMES] ?? {};
  const base = settings.prefsUpdatedAt ?? 0;
  const next: any = { ...settings };
  const times: Record<string, number> = { ...settings.prefsKeyUpdatedAt };
  let changed = false;
  let localNewer = false;
  for (const k of SYNCED_PREFS) {
    if (remote[k] === undefined) continue;
    const r = remoteTimes[k] ?? item.updatedAt;
    const l = settings.prefsKeyUpdatedAt?.[k] ?? base;
    if (r >= l) {
      if (!same(settings[k], remote[k]) || settings.prefsKeyUpdatedAt?.[k] !== r) changed = true;
      next[k] = remote[k];
      times[k] = r;
    } else if (!same(settings[k], remote[k])) localNewer = true;
  }
  // Newer local values the server doesn't have yet: make sure they are uploaded (the server merges them).
  const updatedAt = localNewer ? Math.max(base, item.updatedAt + 1) : Math.max(base, item.updatedAt);
  if (!changed && updatedAt === base) return settings;
  return { ...next, prefsUpdatedAt: updatedAt, prefsKeyUpdatedAt: times };
}

export function nextSnapshot(snapshot: Record<string, number>, sent: SyncItem[], received: SyncItem[], stored: StoredAck[] = []) {
  const next = { ...snapshot };
  // Newer servers ack what they stored; older ones echo it back. A sent item that is neither acked nor
  // echoed (e.g. a collection an older server doesn't know yet) stays pending and is sent again.
  const echoed = new Set(received.map(key));
  for (const i of [...sent.filter((s) => echoed.has(key(s))), ...stored, ...received]) {
    if (i.deleted) delete next[key(i)];
    else next[key(i)] = Math.max(next[key(i)] ?? 0, i.updatedAt);
  }
  return next;
}

// ---------- Uploading only what changed in a chat ----------

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + s.length.toString(36);
}
const messageHashes = (messages: unknown[] | undefined) => (messages ?? []).map((m) => hash(JSON.stringify(m)));

/** A chat whose server copy we know (by message fingerprints) goes up as just the changed tail. */
function asPatch(change: SyncItem, snapshot: Record<string, number>, meta: SyncMeta): SyncItem {
  if (change.collection !== 'conversations' || change.deleted || !Array.isArray(change.data?.messages)) return change;
  const known = meta.messages[change.id];
  const base = snapshot[key(change)];
  if (!known || base === undefined || known.at !== base) return change;
  const local = messageHashes(change.data.messages);
  let keep = 0;
  while (keep < local.length && keep < known.h.length && local[keep] === known.h[keep]) keep++;
  if (keep === 0) return change;
  const { messages, ...rest } = change.data;
  return { ...change, data: rest, patch: { base, keep, messages: messages.slice(keep) } };
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** How the user knows an item: a chat's title, a memory's text, a skill's name… */
export function describeItem(item: { collection: string; id: string }, state?: SyncState): string {
  const list = state && item.collection !== 'prefs' ? ((state as any)[item.collection] as any[] | undefined) : undefined;
  const x = list?.find((i) => i.id === item.id);
  const label = String(x?.title ?? x?.name ?? x?.text ?? item.id);
  const kinds: Record<string, string> = { conversations: 'Chat', memories: 'Memory', skills: 'Skill', projects: 'Project', plugins: 'Plugin', mcpServers: 'MCP server', prefs: 'Settings' };
  return `${kinds[item.collection] ?? 'Item'} “${label.length > 40 ? label.slice(0, 39) + '…' : label}”`;
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
  return { serverUrl: serverUrl.replace(/\/+$/, ''), token, user, cursor: 0, collections: COLLECTIONS };
}

export async function signOut(account: Account): Promise<void> {
  await request(account.serverUrl, '/auth/signout', {}, account.token).catch(() => {});
}

export interface SyncResponse {
  cursor: number;
  items: SyncItem[];
  stored?: StoredAck[];
  errors?: { collection: Collection; id: string; error: string; code?: string }[];
  collections?: string[];
  patches?: boolean;
  reset?: boolean;
}

export async function pushPull(account: Account, changes: SyncItem[], full: Collection[] = []): Promise<SyncResponse> {
  return request(
    account.serverUrl,
    '/sync',
    { since: account.cursor, collections: COLLECTIONS, ...(full.length ? { full } : {}), changes },
    account.token,
  );
}

/** What the sync loop needs from the app (store.tsx). */
export interface SyncHost {
  /** The latest local data, chats with a reply in progress, and when local deletions happened. */
  read(): { state: SyncState; busy: Record<string, boolean>; deletedAt: Record<string, number> };
  /** False once this account was signed out (or replaced): nothing more is merged or saved. */
  current(): boolean;
  /** Merges server items into the local data. */
  apply(items: SyncItem[]): void | Promise<void>;
  /** Persists what the server confirmed and the new cursor (after every request). */
  save(snapshot: Record<string, number>, meta: SyncMeta, account: Account): Promise<void>;
}

/**
 * One sync: uploads local changes in requests of a few MB at most (saving the cursor and snapshot after
 * each) and merges what other devices changed. Returns null when the account was signed out meanwhile,
 * otherwise the updated account and the items that couldn't be uploaded (named, for the user).
 */
export async function runSync(
  account: Account,
  snapshotIn: Record<string, number>,
  metaIn: SyncMeta,
  host: SyncHost,
): Promise<{ account: Account; problems: string[] } | null> {
  // Collections this build syncs that the saved cursor never covered (an upgrade from an older build):
  // fetch them in full once, and send this phone's own items in them again.
  const covered = account.collections ?? LEGACY_COLLECTIONS;
  let full = COLLECTIONS.filter((c) => !covered.includes(c));
  let snapshot = Object.fromEntries(Object.entries(snapshotIn).filter(([k]) => !full.includes(k.split('/')[0] as Collection)));
  let meta: SyncMeta = { deletedAt: metaIn.deletedAt ?? {}, messages: { ...metaIn.messages } };
  let acct = account;
  let limit = BATCH_BYTES;
  const attempted = new Set<string>();
  const problems: string[] = [];
  for (let first = true; ; ) {
    const { state, busy, deletedAt } = host.read();
    const busyKeys = new Set(Object.keys(busy).filter((id) => busy[id]).map((id) => `conversations/${id}`));
    const atStart = new Set(localItems(state).map(key));
    const pending = pendingChanges(state, snapshot, deletedAt).filter((c) => !busyKeys.has(key(c)) && !attempted.has(key(c)));
    const sized = pending
      .map((c) => {
        const change = acct.patches ? asPatch(c, snapshot, meta) : c;
        return { change, whole: c, bytes: utf8Length(JSON.stringify(change)) };
      })
      .sort((a, b) => a.bytes - b.bytes);
    const batch: typeof sized = [];
    let total = 0;
    for (const s of sized) {
      if (s.bytes > MAX_ITEM_BYTES) {
        attempted.add(key(s.change));
        problems.push(`${describeItem(s.change, state)} is too large to sync (${(s.bytes / 1e6).toFixed(1)} MB).`);
        continue;
      }
      if (batch.length && total + s.bytes > limit) break;
      batch.push(s);
      total += s.bytes;
    }
    if (!first && !batch.length) break;
    const changes = batch.map((b) => b.change);
    let res: SyncResponse;
    try {
      res = await pushPull(acct, changes, first ? full : []);
    } catch (e: any) {
      if (e?.status !== 413 || !batch.length) throw e;
      // The server (or a proxy in front of it) takes less: smaller requests, or skip an item that alone is too big.
      if (batch.length > 1) limit = Math.max(1, Math.floor(total / 2));
      else {
        attempted.add(key(changes[0]));
        problems.push(`${describeItem(changes[0], state)} is too large to sync (${(total / 1e6).toFixed(1)} MB).`);
      }
      continue;
    }
    if (!host.current()) return null;
    for (const c of changes) attempted.add(key(c));
    for (const e of res.errors ?? []) {
      if (e.code === 'resend') {
        delete meta.messages[e.id]; // the server's copy moved on: send the whole chat
        attempted.delete(key(e));
      } else problems.push(`${describeItem(e, state)}: ${e.error}`);
    }
    if (res.reset) snapshot = {}; // the server lost data: send everything again
    const received = res.items ?? [];
    const now = host.read();
    const nowKeys = new Set(localItems(now.state).map(key));
    const toMerge = received
      // Deleted here while the request was in flight: don't bring it back (the tombstone goes next).
      .filter((i) => i.deleted || !atStart.has(key(i)) || nowKeys.has(key(i)))
      // A chat with a reply in progress keeps its messages; the merged chat is uploaded after the reply.
      .map((i) => (i.collection === 'conversations' && !i.deleted && now.busy[i.id] ? { ...i, keep: ['messages'] } : i));
    await host.apply(toMerge);
    if (!host.current()) return null;
    snapshot = nextSnapshot(snapshot, changes, received, res.stored);
    const messages = { ...meta.messages };
    for (const a of res.stored ?? []) {
      if (a.collection !== 'conversations') continue;
      const sent = batch.find((b) => b.change.collection === a.collection && b.change.id === a.id);
      if (a.deleted || !sent) delete messages[a.id];
      else messages[a.id] = { at: a.updatedAt, h: messageHashes(sent.whole.data?.messages) };
    }
    for (const i of received) {
      if (i.collection !== 'conversations') continue;
      if (i.deleted) delete messages[i.id];
      else messages[i.id] = { at: i.updatedAt, h: messageHashes(i.data?.messages) };
    }
    for (const id of Object.keys(messages)) if (snapshot[`conversations/${id}`] !== messages[id].at) delete messages[id];
    meta = { deletedAt: meta.deletedAt, messages };
    acct = { ...acct, cursor: res.cursor, ...(res.collections ? { collections: res.collections } : {}), patches: res.patches === true };
    await host.save(snapshot, meta, acct);
    first = false;
    full = [];
  }
  return { account: acct, problems };
}
