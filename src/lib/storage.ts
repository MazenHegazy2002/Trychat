import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { docStore } from './docStore';
import { EMPTY_META } from './sync';
import type { SyncMeta } from './sync';
import type { Account, Conversation, McpServer, Memory, Plugin, Project, Settings, Skill } from './types';

/**
 * Small values (settings, sync snapshot) live in AsyncStorage; secrets in SecureStore. Collections live
 * in JSON files (docStore.ts): one file per chat plus an order index, one file per other collection.
 * They used to be single AsyncStorage keys, which Android can't read back past ~2 MB (SQLite
 * CursorWindow) inside a 6 MB database (AsyncStorage_db_size_in_MB), so they are migrated on load.
 *
 * Data that exists but can't be read is never overwritten: saving that collection is refused, the sync
 * snapshot hides its entries so no deletions are pushed for it, and the problem is reported through
 * getStorageIssues() for the UI.
 */

const KEYS = {
  settings: 'trychat.settings',
  account: 'trychat.account',
  syncSnapshot: 'trychat.syncSnapshot',
};

export type StoredCollection = 'conversations' | 'memories' | 'skills' | 'projects' | 'plugins' | 'mcpServers';
const COLLECTIONS: StoredCollection[] = ['conversations', 'memories', 'skills', 'projects', 'plugins', 'mcpServers'];

/** Where collections were kept before they moved to files. Removed once their contents are saved as files. */
const LEGACY_KEYS: Record<StoredCollection, string> = {
  conversations: 'trychat.conversations',
  memories: 'trychat.memories',
  skills: 'trychat.skills',
  projects: 'trychat.projects',
  plugins: 'trychat.plugins',
  mcpServers: 'trychat.mcpServers',
};

const LABELS: Record<StoredCollection, string> = {
  conversations: 'chats',
  memories: 'memories',
  skills: 'skills',
  projects: 'projects',
  plugins: 'plugins',
  mcpServers: 'MCP servers',
};

// Settings fields kept in the device's secure storage instead of AsyncStorage.
const SECRET_FIELDS = ['apiKey', 'githubToken', 'bridgeToken'] as const;
type SecretField = (typeof SECRET_FIELDS)[number];
const secretKey = (field: SecretField) => `trychat.${field}`;

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://169.58.133.158:20128/v1',
  apiKey: process.env.EXPO_PUBLIC_API_KEY ?? '',
  model: process.env.EXPO_PUBLIC_DEFAULT_MODEL ?? '',
  systemPrompt: 'You are a helpful, knowledgeable assistant. Answer clearly and use Markdown when it helps.',
  builderMode: true,
  memoryEnabled: true,
  stream: true,
  temperature: 0.7,
  transcriptionModel: 'whisper-1',
  contextMessages: 40,
  githubToken: '',
  bridgeUrl: '',
  bridgeToken: '',
  confirmCommands: true,
  confirmWrites: true,
  confirmReads: false,
  repos: [],
  subAgents: true,
  codeExecution: true,
  webAccess: true,
  marketplaces: [],
  phoneFolder: null,
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (e) {
    console.warn(`[storage] couldn't read ${key}:`, e);
    return fallback;
  }
}

function writeJson(key: string, value: unknown): Promise<void> {
  return AsyncStorage.setItem(key, JSON.stringify(value));
}

// SecureStore is native-only; fall back to AsyncStorage on web.
async function readSecret(field: SecretField): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(secretKey(field));
  return SecureStore.getItemAsync(secretKey(field));
}

async function writeSecret(field: SecretField, value: string): Promise<void> {
  if (Platform.OS === 'web') return AsyncStorage.setItem(secretKey(field), value);
  return SecureStore.setItemAsync(secretKey(field), value);
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(KEYS.settings, {});
  const settings: Settings = { ...DEFAULT_SETTINGS, ...stored };
  for (const field of SECRET_FIELDS) {
    const value = await readSecret(field);
    if (value !== null) settings[field] = value;
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const rest: Partial<Settings> = { ...settings };
  for (const field of SECRET_FIELDS) delete rest[field];
  await Promise.all([
    writeJson(KEYS.settings, rest),
    ...SECRET_FIELDS.map((field) => writeSecret(field, settings[field])),
  ]);
}

// ---------- Problems shown to the user ----------

export type StorageIssueKind = 'unreadable' | 'legacy-unreadable' | 'save-failed';

export interface StorageIssue {
  key: string;
  collection: StoredCollection;
  kind: StorageIssueKind;
  title: string;
  message: string;
  detail: string;
  /** A fix the user can choose; run it with resolveStorageIssue(key) after showing `confirm`. */
  action?: { label: string; confirm: string; destructive?: boolean };
}

let issues: StorageIssue[] = [];
const listeners = new Set<() => void>();

/** Current problems (a new array whenever they change; for useSyncExternalStore). */
export const getStorageIssues = () => issues;

export function subscribeStorageIssues(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setIssues(next: StorageIssue[]) {
  issues = next;
  listeners.forEach((l) => l());
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function report(collection: StoredCollection, kind: StorageIssueKind, error: unknown, count?: number) {
  const label = LABELS[collection];
  const detail = errorText(error);
  const issue: StorageIssue = { key: `${collection}:${kind}`, collection, kind, title: '', message: '', detail };
  if (kind === 'unreadable') {
    issue.title = count
      ? `${count} chat${count === 1 ? '' : 's'} couldn't be loaded`
      : `Your ${label} couldn't be loaded`;
    issue.message = count
      ? "They're kept on this device and won't be deleted here or on your other devices. Restart the app to try again."
      : `Nothing was deleted: TryChat won't save over them or sync their removal to your other devices. New changes to ${label} aren't saved until this is fixed. Restart the app to try again.`;
    issue.action = {
      label: 'Set aside & continue',
      confirm: `The unreadable ${label} are moved to a recovery folder on this device and TryChat continues without them. Copies on your other devices and your account are kept.`,
    };
  } else if (kind === 'legacy-unreadable') {
    issue.title = `Some saved ${label} couldn't be loaded`;
    issue.message = `They were saved by an older version of TryChat and can't be read on this device. They're kept and won't be deleted here or on your other devices; everything else is saved normally.`;
    issue.action = {
      label: 'Delete old data',
      destructive: true,
      confirm: `This permanently deletes the unreadable ${label} from this device (it frees space). Copies on your other devices and your account are kept.`,
    };
  } else {
    issue.title = `Couldn't save your ${label}`;
    issue.message = 'TryChat will try again with your next change.';
  }
  if (kind !== 'save-failed') console.warn(`[storage] ${issue.title}:`, error);
  setIssues([...issues.filter((i) => i.key !== issue.key), issue]);
}

function clearIssue(collection: StoredCollection, kind: StorageIssueKind) {
  const key = `${collection}:${kind}`;
  if (issues.some((i) => i.key === key)) setIssues(issues.filter((i) => i.key !== key));
}

/** Some stored data of this collection couldn't be read, so its absence must not become a deletion. */
const incomplete = (c: StoredCollection) =>
  issues.some((i) => i.collection === c && (i.kind === 'unreadable' || i.kind === 'legacy-unreadable'));

// ---------- Collection state ----------

type Item = { id: string };

interface CollectionState {
  /** What's stored couldn't be read: saves are refused so it isn't overwritten. */
  blocked: boolean;
  /** The latest refused save, written once the problem is resolved. */
  pending?: Item[];
  /** Ids loaded or saved this session. Other ids in the sync snapshot may be in data we couldn't read. */
  seen: Set<string>;
  /** The legacy key was read and merged in; it's removed after the next successful save. */
  legacyMerged: boolean;
  /** Fingerprint of the saved file (single-file collections). */
  saved?: string;
}

const states = {} as Record<StoredCollection, CollectionState>;
for (const c of COLLECTIONS) states[c] = { blocked: false, seen: new Set(), legacyMerged: false };

/** Cheap 53-bit hash (cyrb53) plus length, to skip writing unchanged data. */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${4294967296 * (2097151 & h2) + (h1 >>> 0)}`;
}

function checkList(value: any) {
  if (!Array.isArray(value) || !value.every((x) => x && typeof x === 'object' && typeof x.id === 'string')) {
    throw new Error('Stored data is not a list of items');
  }
}

const updatedAtOf = (x: any): number => x.updatedAt ?? x.createdAt ?? 0;

/** Adds `extra` items to `base`; for the same id the newer one wins (base on a tie). */
function mergeById<T extends Item>(base: T[], extra: T[]): T[] {
  const byId = new Map(base.map((x) => [x.id, x]));
  for (const x of extra) {
    const have = byId.get(x.id);
    if (!have || updatedAtOf(x) > updatedAtOf(have)) byId.set(x.id, x);
  }
  return [...byId.values()];
}

type LegacyResult<T> = { status: 'missing' } | { status: 'ok'; value: T[] } | { status: 'unreadable'; error: unknown };

async function readLegacy<T>(c: StoredCollection): Promise<LegacyResult<T>> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_KEYS[c]);
    if (!raw) return { status: 'missing' };
    const value = JSON.parse(raw);
    checkList(value);
    return { status: 'ok', value };
  } catch (error) {
    // e.g. Android "Row too big to fit into CursorWindow" for values over ~2 MB. The key is kept.
    return { status: 'unreadable', error };
  }
}

async function dropLegacy(c: StoredCollection) {
  const st = states[c];
  if (!st.legacyMerged) return;
  try {
    await AsyncStorage.removeItem(LEGACY_KEYS[c]);
    st.legacyMerged = false;
  } catch {
    // Tried again after the next save; merging it again is harmless.
  }
}

/** Runs one save at a time per collection; saves queued meanwhile collapse into the latest one. */
const locks = {} as Record<StoredCollection, Promise<void>>;
function locked(c: StoredCollection, fn: () => Promise<void>): Promise<void> {
  const run = (locks[c] ?? Promise.resolve()).then(fn).catch((e) => console.warn(`[storage] ${c}:`, e));
  locks[c] = run;
  return run;
}

function saver<T extends Item>(c: StoredCollection, write: (list: T[]) => Promise<void>) {
  let queued: T[] | null = null;
  let waiting: Promise<void> | null = null;
  return (list: T[]): Promise<void> => {
    queued = list;
    if (!waiting) {
      waiting = locked(c, async () => {
        const next = queued!;
        queued = null;
        waiting = null;
        await write(next);
      });
    }
    return waiting;
  };
}

// ---------- Single-file collections ----------

async function writeList(c: StoredCollection, list: Item[]) {
  const st = states[c];
  for (const x of list) st.seen.add(x.id);
  if (st.blocked) {
    st.pending = list;
    return;
  }
  const text = JSON.stringify(list);
  const fp = fingerprint(text);
  if (fp !== st.saved) {
    try {
      await docStore.write(`${c}.json`, text);
    } catch (e) {
      report(c, 'save-failed', e);
      return;
    }
    st.saved = fp;
  }
  clearIssue(c, 'save-failed');
  await dropLegacy(c);
}

async function loadList<T extends Item>(c: StoredCollection): Promise<T[]> {
  const st = states[c];
  let items: T[] = [];
  const file = await docStore.read<T[]>(`${c}.json`, checkList);
  if (file.status === 'ok') {
    items = file.value;
    st.saved = fingerprint(file.text);
  } else if (file.status === 'unreadable') {
    st.blocked = true;
    report(c, 'unreadable', file.error);
  }
  const legacy = await readLegacy<T>(c);
  if (legacy.status === 'ok') {
    items = mergeById(items, legacy.value);
    st.legacyMerged = true;
    await writeList(c, items); // the old key is removed only once this is saved
  } else if (legacy.status === 'unreadable') {
    report(c, 'legacy-unreadable', legacy.error);
  }
  for (const x of items) st.seen.add(x.id);
  return items;
}

const listSavers = {
  memories: saver<Memory>('memories', (l) => writeList('memories', l)),
  skills: saver<Skill>('skills', (l) => writeList('skills', l)),
  projects: saver<Project>('projects', (l) => writeList('projects', l)),
  plugins: saver<Plugin>('plugins', (l) => writeList('plugins', l)),
  mcpServers: saver<McpServer>('mcpServers', (l) => writeList('mcpServers', l)),
};

// ---------- Conversations: one file each ----------

const CONV_DIR = 'conversations';
const CONV_INDEX = 'conversations.index.json';
const convName = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, (ch) => `~${ch.charCodeAt(0).toString(16).padStart(4, '0')}`) + '.json';
const convId = (name: string) => name.slice(0, -5).replace(/~([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const convPath = (id: string) => `${CONV_DIR}/${convName(id)}`;

/** Chat files on disk (loaded or written this session): the object last written and its fingerprint. */
const convFiles = new Map<string, { ref: Conversation; fp?: string }>();
/** Chat files that exist but couldn't be read. They are never deleted or overwritten without being set aside. */
const brokenConvs = new Map<string, unknown>();
let savedOrder = '';

function reportBrokenConvs() {
  if (brokenConvs.size) report('conversations', 'unreadable', [...brokenConvs.values()][0], brokenConvs.size);
  else if (!states.conversations.blocked) clearIssue('conversations', 'unreadable');
}

async function writeConversations(list: Conversation[]) {
  const st = states.conversations;
  for (const c of list) st.seen.add(c.id);
  if (st.blocked) {
    st.pending = list;
    return;
  }
  let failure: unknown = null;
  const keep = new Set<string>();
  for (const c of list) {
    keep.add(c.id);
    const known = convFiles.get(c.id);
    if (known?.ref === c) continue; // state is immutable: same object, same contents
    const text = JSON.stringify(c);
    const fp = fingerprint(text);
    if (known?.fp === fp) {
      known.ref = c;
      continue;
    }
    try {
      if (brokenConvs.has(c.id)) {
        // A readable copy (e.g. from sync) replaces an unreadable file; the old bytes are kept.
        await docStore.setAside(convPath(c.id));
        brokenConvs.delete(c.id);
        reportBrokenConvs();
      }
      await docStore.write(convPath(c.id), text);
      convFiles.set(c.id, { ref: c, fp });
    } catch (e) {
      failure ??= e;
    }
  }
  // Only files this session knows about are deleted; unreadable or unknown ones are left alone.
  for (const id of [...convFiles.keys()]) {
    if (keep.has(id)) continue;
    try {
      await docStore.remove(convPath(id));
      convFiles.delete(id);
    } catch (e) {
      failure ??= e;
    }
  }
  const order = list.map((c) => c.id);
  const orderText = JSON.stringify(order);
  if (orderText !== savedOrder) {
    try {
      await docStore.write(CONV_INDEX, JSON.stringify({ v: 1, order }));
      savedOrder = orderText;
    } catch (e) {
      failure ??= e;
    }
  }
  if (failure) {
    report('conversations', 'save-failed', failure);
    return;
  }
  clearIssue('conversations', 'save-failed');
  await dropLegacy('conversations');
}

export async function loadConversations(): Promise<Conversation[]> {
  const st = states.conversations;
  let items: Conversation[] = [];
  let names: string[] = [];
  try {
    names = await docStore.list(CONV_DIR);
  } catch (e) {
    st.blocked = true;
    report('conversations', 'unreadable', e);
  }
  for (let i = 0; i < names.length; i += 8) {
    await Promise.all(
      names.slice(i, i + 8).map(async (name) => {
        const id = convId(name);
        const r = await docStore.read<Conversation>(`${CONV_DIR}/${name}`, (v) => {
          if (!v || v.id !== id || !Array.isArray(v.messages)) throw new Error(`${name} is not a saved chat`);
        });
        if (r.status === 'ok') {
          items.push(r.value);
          convFiles.set(id, { ref: r.value });
        } else if (r.status === 'unreadable') {
          brokenConvs.set(id, r.error);
        }
      }),
    );
  }
  reportBrokenConvs();

  // Saved order; chats missing from the index (e.g. written just before a crash) go first, newest first.
  const index = await docStore.read<{ order: string[] }>(CONV_INDEX);
  const order = index.status === 'ok' && Array.isArray(index.value?.order) ? index.value.order : [];
  savedOrder = JSON.stringify(order);
  const rank = new Map(order.map((id, n) => [id, n]));
  items.sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1) || b.updatedAt - a.updatedAt);

  const legacy = await readLegacy<Conversation>('conversations');
  if (legacy.status === 'ok') {
    items = mergeById(items, legacy.value);
    st.legacyMerged = true;
    await writeConversations(items); // writes only new/changed chats; the old key is removed once all are saved
  } else if (legacy.status === 'unreadable') {
    report('conversations', 'legacy-unreadable', legacy.error);
  }
  for (const c of items) st.seen.add(c.id);
  return items;
}

const saveConversationsQueued = saver<Conversation>('conversations', writeConversations);

export const saveConversations = (c: Conversation[]) => saveConversationsQueued(c);

export const loadMemories = () => loadList<Memory>('memories');
export const saveMemories = (m: Memory[]) => listSavers.memories(m);

export const loadPlugins = () => loadList<Plugin>('plugins');
export const savePlugins = (p: Plugin[]) => listSavers.plugins(p);

export const loadProjects = () => loadList<Project>('projects');
export const saveProjects = (p: Project[]) => listSavers.projects(p);

export const loadSkills = () => loadList<Skill>('skills');
export const saveSkills = (s: Skill[]) => listSavers.skills(s);

export const loadMcpServers = () => loadList<McpServer>('mcpServers');
export const saveMcpServers = (s: McpServer[]) => listSavers.mcpServers(s);

// ---------- Fixing problems ----------

/**
 * Runs an issue's action: unreadable data is moved to a recovery folder (or, for unreadable legacy
 * data, deleted) and saving resumes. Its entries are dropped from the sync snapshot without sending
 * deletions, so other devices and the account keep their copies.
 */
export function resolveStorageIssue(key: string): Promise<void> {
  const issue = issues.find((i) => i.key === key);
  if (!issue?.action) return Promise.resolve();
  const c = issue.collection;
  let error: unknown = null;
  return locked(c, async () => {
    try {
      const st = states[c];
      if (issue.kind === 'legacy-unreadable') {
        await AsyncStorage.removeItem(LEGACY_KEYS[c]);
      } else if (c === 'conversations' && !st.blocked) {
        for (const id of [...brokenConvs.keys()]) {
          await docStore.setAside(convPath(id));
          brokenConvs.delete(id);
        }
      } else {
        await docStore.setAside(c === 'conversations' ? CONV_DIR : `${c}.json`);
      }
      clearIssue(c, issue.kind);
      if (!incomplete(c)) await forgetUnseen(c);
      if (st.blocked && issue.kind === 'unreadable') {
        st.blocked = false;
        st.saved = undefined;
        if (c === 'conversations') {
          convFiles.clear();
          savedOrder = '';
        }
        const pending = st.pending;
        st.pending = undefined;
        if (pending) {
          if (c === 'conversations') await writeConversations(pending as Conversation[]);
          else await writeList(c, pending);
        }
      }
    } catch (e) {
      error = e;
    }
  }).then(() => {
    if (error) throw error;
  });
}

// ---------- Account & sync ----------

// The account (with its session token) goes in secure storage on native.
export async function loadAccount(): Promise<Account | null> {
  const raw = Platform.OS === 'web' ? await AsyncStorage.getItem(KEYS.account) : await SecureStore.getItemAsync(KEYS.account);
  try {
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

export async function saveAccount(account: Account | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (account) await AsyncStorage.setItem(KEYS.account, JSON.stringify(account));
    else await AsyncStorage.removeItem(KEYS.account);
    return;
  }
  if (account) await SecureStore.setItemAsync(KEYS.account, JSON.stringify(account));
  else await SecureStore.deleteItemAsync(KEYS.account);
}

/** Snapshot entries hidden from sync because they may belong to data that couldn't be read. */
let held: Record<string, number> = {};

const splitKey = (k: string) => {
  const slash = k.indexOf('/');
  return { collection: k.slice(0, slash) as StoredCollection, id: k.slice(slash + 1) };
};

/** Drops a collection's unaccounted-for entries from the stored snapshot (no deletions are sent for them). */
async function forgetUnseen(c: StoredCollection) {
  const snapshot = await readJson<Record<string, number>>(KEYS.syncSnapshot, {});
  let changed = false;
  for (const k of Object.keys(snapshot)) {
    const { collection, id } = splitKey(k);
    if (collection === c && !states[c].seen.has(id)) {
      delete snapshot[k];
      changed = true;
    }
  }
  for (const k of Object.keys(held)) if (splitKey(k).collection === c) delete held[k];
  if (changed) await writeJson(KEYS.syncSnapshot, snapshot);
}

/**
 * What the server last confirmed, per "collection/id" → updatedAt. Used to detect local edits and deletions.
 * Entries of a collection with unreadable data are left out unless the item was loaded or saved, so a
 * chat that merely failed to load is never sent as a deletion.
 */
export async function loadSyncSnapshot(): Promise<Record<string, number>> {
  const snapshot = await readJson<Record<string, number>>(KEYS.syncSnapshot, {});
  held = {};
  const visible: Record<string, number> = {};
  for (const [k, v] of Object.entries(snapshot)) {
    const { collection, id } = splitKey(k);
    if (states[collection] && incomplete(collection) && !states[collection].seen.has(id)) held[k] = v;
    else visible[k] = v;
  }
  return visible;
}

/** Hidden entries are kept. An empty snapshot is a reset (sign-in / sign-out) and clears them too. */
export async function saveSyncSnapshot(s: Record<string, number>): Promise<void> {
  if (!Object.keys(s).length) held = {};
  await writeJson(KEYS.syncSnapshot, { ...held, ...s });
}
/** When local deletions happened and the fingerprints of synced chats (see sync.ts SyncMeta). */
export const loadSyncMeta = () => readJson<SyncMeta>('trychat.syncMeta', EMPTY_META);
export const saveSyncMeta = (m: SyncMeta) => writeJson('trychat.syncMeta', m);
/** The email of the account this phone last synced with (kept after signing out). */
export const loadLastAccountEmail = () => readJson<string | null>('trychat.lastAccountEmail', null);
export const saveLastAccountEmail = (email: string) => writeJson('trychat.lastAccountEmail', email);
