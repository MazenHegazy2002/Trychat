#!/usr/bin/env node
// TryChat account + sync server. Zero dependencies (Node 18+).
//
//   node server/trychat-server.mjs --port=8787 --data=./trychat-data
//
// Options (flag or environment variable):
//   --port=8787           PORT                  port to listen on
//   --data=DIR            TRYCHAT_DATA          where accounts, synced data and shared files are kept
//   --signup=false        TRYCHAT_ALLOW_SIGNUP  close sign-ups
//   --max-file-mb=25      TRYCHAT_MAX_FILE_MB   largest file a friend can be sent
//   --quota-mb=500        TRYCHAT_QUOTA_MB      total size of the files one account can share
//   --max-files=200       TRYCHAT_MAX_FILES     how many shared files one account can keep
//
// Accounts sign in with email + password. Each account's memories, chats, projects, skills,
// MCP server list and preferences are stored here, so every device signed in to the
// same account sees the same data. Secrets (API keys, tokens) never leave the phone.
//
// Friends and shared files: accounts on the same server can become friends and send each other
// files. A file is stored once under DATA_DIR/blobs/<random id> and only its owner and the friends
// it is shared with can download it. Removing a friend revokes what you shared with each other, and
// a file nobody can see any more (deleted, unshared from everyone) is removed from disk.
//
// API (every route except /health and /auth/signup|signin needs `Authorization: Bearer <token>`):
//   GET  /health                         POST /auth/signup {email,password,name?}
//   POST /auth/signin {email,password}   POST /auth/signout          GET /me
//   POST /sync {since, collections, changes}             two-way, last-write-wins sync
//   GET  /friends                        -> {friends: [{id,email,name,status: friends|incoming|outgoing,since}]}
//   POST /friends/request {email}        same reply whether or not the email has an account;
//                                        if they already asked you, you become friends right away
//   POST /friends/accept {id}            id of the account that asked you
//   POST /friends/decline {id}           decline an incoming request, or cancel one you sent (its id)
//   POST /friends/remove {id}            unfriend (also revokes files shared between you)
//   POST /files                          upload: the raw file as the body with X-File-Name (URI-encoded)
//                                        and Content-Type headers, or JSON {name, mimeType, base64}
//                                        -> {file}. Optional X-File-Key lets the app find it again.
//   GET  /files/:id                      download (the owner, or a friend it is shared with)
//   POST /files/:id/share {friendIds, note?}   share with friends (mutual friends only)
//   POST /files/:id/unshare {friendIds?}       owner: stop sharing (all when omitted);
//                                              recipient: remove it from "Shared with me"
//   DELETE /files/:id                    owner only
//   GET  /shared                         -> {received: [file], sent: [file]}
//
// Put it behind HTTPS (e.g. Caddy: `caddy reverse-proxy --from your.domain --to :8787`)
// before using it over the internet — passwords and data are otherwise sent in plain text.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { finished, pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const PORT = Number(args.port ?? process.env.PORT ?? 8787);
const DATA_DIR = path.resolve(args.data ?? process.env.TRYCHAT_DATA ?? './trychat-data');
const ALLOW_SIGNUP = (args.signup ?? process.env.TRYCHAT_ALLOW_SIGNUP ?? 'true') !== 'false';
const MAX_BODY = 20 * 1024 * 1024;
const MAX_ITEM = MAX_BODY - 64 * 1024;
const COLLECTIONS = new Set(['memories', 'conversations', 'skills', 'mcpServers', 'projects', 'plugins', 'prefs']);
// What app builds from before the client sent its `collections` list know about. They are only sent
// and only allowed to change these: an older build treats an item it can't store as deleted locally
// and would push a tombstone for it (e.g. deleting every plugin on the account).
const LEGACY_COLLECTIONS = new Set(['memories', 'conversations', 'skills', 'mcpServers', 'projects', 'prefs']);

// Friends & shared files.
const MB = 1024 * 1024;
const positive = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback);
const MAX_FILE_BYTES = Math.floor(positive(args['max-file-mb'] ?? process.env.TRYCHAT_MAX_FILE_MB, 25) * MB);
const QUOTA_BYTES = Math.floor(positive(args['quota-mb'] ?? process.env.TRYCHAT_QUOTA_MB, 500) * MB);
const MAX_FILES = Math.floor(positive(args['max-files'] ?? process.env.TRYCHAT_MAX_FILES, 200));
const MAX_FRIENDS = 500;
const MAX_PENDING_REQUESTS = 50;
const MAX_RECIPIENTS = 50;
/** An upload that was never shared with anyone (e.g. the app closed between upload and share) is dropped after this. */
const UNSHARED_TTL = 60 * 60_000;
const BLOB_DIR = path.join(DATA_DIR, 'blobs');

// ---------- Tiny JSON file store (one file per account + an index) ----------

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const writeQueue = new Map(); // file -> Promise, serialises writes per file

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

function writeJson(file, value) {
  const prev = writeQueue.get(file) ?? Promise.resolve();
  const next = prev.then(async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(tmp, file);
  });
  writeQueue.set(file, next.catch(() => {}));
  return next;
}

const indexFile = () => path.join(DATA_DIR, 'accounts.json');
const userFile = (id) => path.join(DATA_DIR, `user-${id}.json`);

// In-memory cache, persisted on every change.
// The pending load promise is cached, so concurrent first requests after a restart share one object
// (otherwise the second read replaces the object the first one already wrote to).
let index = null; // { users: {id: {...}}, emails: {email: id}, sessions: {tokenHash: {userId, createdAt}} }
let indexLoading = null;
const users = new Map(); // id -> Promise<{ items: { "collection/id": {collection,id,data,updatedAt,deleted,seq} }, seq }>

async function loadIndex() {
  if (!index) {
    indexLoading ??= readJson(indexFile(), { users: {}, emails: {}, sessions: {} }).finally(() => (indexLoading = null));
    const loaded = await indexLoading;
    index ??= loaded;
  }
  return index;
}

function loadUser(id) {
  if (!users.has(id)) {
    const p = readJson(userFile(id), { items: {}, seq: 0 });
    users.set(id, p);
    p.catch(() => users.get(id) === p && users.delete(id));
  }
  return users.get(id);
}

const PREF_TIMES = 'updatedAtByKey';
/** Merges two prefs items key by key (newest key wins). Items without per-key times (older apps) use the item's time. */
function mergePrefsData(a, b) {
  const ta = a.data?.[PREF_TIMES] ?? {};
  const tb = b.data?.[PREF_TIMES] ?? {};
  const data = { ...a.data, ...b.data };
  const times = {};
  for (const k of new Set([...Object.keys(a.data ?? {}), ...Object.keys(b.data ?? {})])) {
    if (k === PREF_TIMES) continue;
    const at = ta[k] ?? a.updatedAt;
    const bt = tb[k] ?? b.updatedAt;
    if (!(k in (b.data ?? {})) || (k in (a.data ?? {}) && at > bt)) {
      data[k] = a.data[k];
      times[k] = at;
    } else {
      data[k] = b.data[k];
      times[k] = bt;
    }
  }
  data[PREF_TIMES] = times;
  return data;
}

const itemSize = (c) => {
  try {
    return Buffer.byteLength(JSON.stringify(c));
  } catch {
    return Infinity;
  }
};

// ---------- Auth ----------

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt };
}

async function newSession(userId) {
  const token = randomBytes(32).toString('base64url');
  index.sessions[sha256(token)] = { userId, createdAt: Date.now() };
  await writeJson(indexFile(), index);
  return token;
}

async function authenticate(req) {
  await loadIndex();
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const session = token && index.sessions[sha256(token)];
  if (!session || !index.users[session.userId]) throw httpError(401, 'Please sign in again.');
  return { user: index.users[session.userId], tokenHash: sha256(token) };
}

// Simple per-IP throttle for auth endpoints.
const attempts = new Map();
function throttle(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
  if (recent.length >= 20) throw httpError(429, 'Too many attempts. Try again in a few minutes.');
  recent.push(now);
  attempts.set(ip, recent);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const normEmail = (e) => String(e ?? '').trim().toLowerCase();

// ---------- Routes ----------

const routes = {
  'GET /health': async () => ({ ok: true, name: 'trychat-server', signup: ALLOW_SIGNUP }),

  'POST /auth/signup': async (req, body) => {
    throttle(req.socket.remoteAddress);
    if (!ALLOW_SIGNUP) throw httpError(403, 'Sign-up is turned off on this server.');
    await loadIndex();
    const email = normEmail(body.email);
    const password = String(body.password ?? '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, 'Enter a valid email address.');
    if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters.');
    if (index.emails[email]) throw httpError(409, 'An account with this email already exists. Sign in instead.');
    const id = randomBytes(9).toString('base64url');
    const user = {
      id,
      email,
      name: String(body.name ?? '').trim().slice(0, 80) || email.split('@')[0],
      password: await hashPassword(password),
      createdAt: Date.now(),
    };
    if (index.emails[email]) throw httpError(409, 'An account with this email already exists. Sign in instead.');
    index.users[id] = user;
    index.emails[email] = id;
    const token = await newSession(id);
    return { token, user: publicUser(user) };
  },

  'POST /auth/signin': async (req, body) => {
    throttle(req.socket.remoteAddress);
    await loadIndex();
    const id = index.emails[normEmail(body.email)];
    const user = id && index.users[id];
    if (!user || !(await verifyPassword(String(body.password ?? ''), user.password))) {
      throw httpError(401, 'Wrong email or password.');
    }
    return { token: await newSession(id), user: publicUser(user) };
  },

  'POST /auth/signout': async (req) => {
    const { tokenHash } = await authenticate(req);
    delete index.sessions[tokenHash];
    await writeJson(indexFile(), index);
    return { ok: true };
  },

  'GET /me': async (req) => ({ user: publicUser((await authenticate(req)).user) }),

  /**
   * Two-way sync. Body: { since: number, collections: string[], full?: string[],
   *   changes: [{collection, id, data, updatedAt, deleted, patch?: {base, keep, messages}}] }.
   * Last write (by updatedAt) wins per item; prefs merge key by key. Returns every item stored after
   * `since` (a server sequence number, so device clocks don't matter), every live item of the `full`
   * collections, the server's copy of every change it rejected, and the new cursor. Apps that send
   * `collections` get `stored` acks ({collection, id, updatedAt}) for what this request stored instead
   * of echoes, plus per-item `errors`.
   */
  'POST /sync': async (req, body) => {
    const { user } = await authenticate(req);
    const store = await loadUser(user.id);
    const changes = Array.isArray(body.changes) ? body.changes : [];
    // Newer apps send the collections they can store; they get acks instead of echoes of what they sent.
    const modern = Array.isArray(body.collections);
    const known = modern ? new Set(body.collections.filter((c) => COLLECTIONS.has(c))) : LEGACY_COLLECTIONS;
    let since = Number(body.since) || 0;
    // A cursor from the future (e.g. the server's data was restored from a backup): send everything again.
    const reset = since > store.seq;
    if (reset) since = 0;
    const full = new Set(Array.isArray(body.full) ? body.full.filter((c) => known.has(c)) : []);
    const stored = new Map(); // key -> seq this request wrote
    const rejected = new Set(); // keys whose server copy wins: always sent back
    const errors = [];
    for (const c of changes) {
      if (!c || !known.has(c.collection) || typeof c.id !== 'string' || !c.id) continue;
      const key = `${c.collection}/${c.id}`;
      if (itemSize(c) > MAX_ITEM) {
        errors.push({ collection: c.collection, id: c.id, error: 'Too large to sync' });
        continue;
      }
      const existing = store.items[key];
      let updatedAt = Number(c.updatedAt) || Date.now();
      if (c.collection === 'prefs' && !c.deleted && existing && !existing.deleted) {
        // Settings merge key by key, so changes to different settings on two devices are both kept.
        const data = mergePrefsData(existing, { updatedAt, data: c.data });
        const same = JSON.stringify(data) === JSON.stringify(existing.data);
        if (same && updatedAt <= existing.updatedAt) {
          rejected.add(key);
          continue;
        }
        updatedAt = Math.max(updatedAt, existing.updatedAt + (same ? 0 : 1));
        store.items[key] = { collection: c.collection, id: c.id, updatedAt, deleted: false, data, seq: ++store.seq };
        stored.set(key, store.seq);
        rejected.add(key); // the merged copy goes back to the client
        continue;
      }
      if (existing && existing.updatedAt > updatedAt) {
        rejected.add(key); // server copy is newer
        continue;
      }
      // Don't delete what changed after the client last synced: it hasn't seen that change yet.
      if (c.deleted && existing && !existing.deleted && existing.seq > since && !stored.has(key)) {
        rejected.add(key);
        continue;
      }
      let data = c.deleted ? null : c.data;
      if (!c.deleted && c.patch) {
        // Only the changed tail of a chat's messages, on top of the copy the client last saw.
        const base = existing && !existing.deleted ? existing : null;
        const keep = Number(c.patch.keep);
        if (!base || base.updatedAt !== Number(c.patch.base) || !Array.isArray(base.data?.messages) || !(keep >= 0) || keep > base.data.messages.length || !Array.isArray(c.patch.messages)) {
          errors.push({ collection: c.collection, id: c.id, error: 'Send the whole item', code: 'resend' });
          continue;
        }
        data = { ...c.data, messages: base.data.messages.slice(0, keep).concat(c.patch.messages) };
      }
      store.items[key] = { collection: c.collection, id: c.id, updatedAt, deleted: !!c.deleted, data, seq: ++store.seq };
      stored.set(key, store.seq);
    }
    if (stored.size) await writeJson(userFile(user.id), store);
    const acks = [];
    const items = [];
    for (const [key, i] of Object.entries(store.items)) {
      if (!known.has(i.collection)) continue;
      const { seq, ...rest } = i;
      if (modern && stored.get(key) === seq && !rejected.has(key)) acks.push({ collection: i.collection, id: i.id, updatedAt: i.updatedAt, ...(i.deleted ? { deleted: true } : {}) });
      else if (seq > since || rejected.has(key) || (full.has(i.collection) && !i.deleted)) items.push(rest);
    }
    if (!modern) return { cursor: store.seq, items };
    return { cursor: store.seq, items, stored: acks, errors, collections: [...known], patches: true, ...(reset ? { reset: true } : {}) };
  },
};

// ---------- Friends & shared files ----------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Own-property lookup, so ids like "__proto__" or "constructor" never match anything. */
const own = (obj, key) => (obj && Object.hasOwn(obj, key) ? obj[key] : undefined);

// Per-account rate limits for friend requests and uploads.
const hits = new Map();
function rateLimit(key, max, windowMs, message) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw httpError(429, message);
  recent.push(now);
  hits.set(key, recent);
}

// ---------- Friends ----------
// Requests and friendships live in social.json. A request is addressed to an email, so the sender
// sees the same thing whether or not that email has an account (and an invite works once it does).

const socialFile = () => path.join(DATA_DIR, 'social.json');
let social = null; // { requests: {id: {id, from, toEmail, createdAt, declined?}}, friendships: {"idA:idB": {since}} }

async function loadSocial() {
  await loadIndex();
  if (!social) social = await readJson(socialFile(), { requests: {}, friendships: {} });
  return social;
}
const saveSocial = () => writeJson(socialFile(), social);

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const areFriends = (a, b) =>
  typeof b === 'string' && a !== b && !b.includes(':') && !!own(social.friendships, pairKey(a, b)) && !!own(index.users, b);

function friendIdsOf(userId) {
  const ids = [];
  for (const k of Object.keys(social.friendships)) {
    const [a, b] = k.split(':');
    if (a === userId) ids.push(b);
    else if (b === userId) ids.push(a);
  }
  return ids.filter((id) => own(index.users, id));
}

/** The friends list as one account sees it. Outgoing requests only show the email that was typed. */
function friendsView(user) {
  const out = [];
  for (const id of friendIdsOf(user.id)) {
    const f = index.users[id];
    out.push({ id, email: f.email, name: f.name, status: 'friends', since: social.friendships[pairKey(user.id, id)].since });
  }
  for (const r of Object.values(social.requests)) {
    if (r.from === user.id) {
      out.push({ id: r.id, email: r.toEmail, name: '', status: 'outgoing', since: r.createdAt });
    } else if (r.toEmail === user.email && !r.declined && own(index.users, r.from)) {
      const f = index.users[r.from];
      out.push({ id: f.id, email: f.email, name: f.name, status: 'incoming', since: r.createdAt });
    }
  }
  return out.sort((a, b) => b.since - a.since);
}

function makeFriends(a, b) {
  if (friendIdsOf(a).length >= MAX_FRIENDS || friendIdsOf(b).length >= MAX_FRIENDS) {
    throw httpError(429, `An account can have up to ${MAX_FRIENDS} friends.`);
  }
  social.friendships[pairKey(a, b)] = { since: Date.now() };
  const emailA = index.users[a].email;
  const emailB = index.users[b].email;
  for (const [id, r] of Object.entries(social.requests)) {
    if ((r.from === a && r.toEmail === emailB) || (r.from === b && r.toEmail === emailA)) delete social.requests[id];
  }
}

const incomingFrom = (user, fromId) =>
  Object.values(social.requests).find((r) => r.from === fromId && r.toEmail === user.email);
const outgoingRequest = (user, requestId) => {
  const r = own(social.requests, requestId);
  return r?.from === user.id ? r : undefined;
};

// ---------- Shared files ----------
// Metadata lives in the owner's user store (`files`), the bytes in BLOB_DIR under a random name that
// never comes from the client. A file with nobody left to share it with is removed from disk.

const fileId = () => `f_${randomBytes(12).toString('base64url')}`;
const filesOf = (store) => (store.files ??= {});
const blobPath = (rec) => path.join(BLOB_DIR, rec.blob);
const mb = (bytes) => `${+(bytes / MB).toFixed(1)} MB`;
const tooLarge = () => httpError(413, `Files can be up to ${mb(MAX_FILE_BYTES)}.`);
const overQuota = () =>
  httpError(507, `Your shared files can take up to ${mb(QUOTA_BYTES)} in total. Delete some under Friends → Shared by me first.`);

// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/g;
const BIDI_CHARS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A display name only: no folders, control or reserved characters, leading dots, or more than 120 characters. */
function sanitizeName(raw) {
  let name = String(raw ?? '').normalize('NFC').replace(BIDI_CHARS, '');
  name = (name.split(/[\\/]/).pop() ?? '').replace(UNSAFE_NAME_CHARS, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  const chars = [...name];
  if (chars.length > 120) {
    const ext = /\.[A-Za-z0-9]{1,10}$/.exec(name)?.[0] ?? '';
    name = chars.slice(0, 120 - ext.length).join('').trimEnd() + ext;
  }
  return name || 'file';
}

function sanitizeMime(raw) {
  const m = String(raw ?? '').split(';')[0].trim().toLowerCase();
  return m.length <= 100 && /^[a-z0-9][\w.+-]*\/[a-z0-9][\w.+-]*$/.test(m) ? m : 'application/octet-stream';
}

// eslint-disable-next-line no-control-regex
const cleanNote = (n) => String(n ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 500);
const cleanKey = (k) => String(k ?? '').replace(/[^\w:.+=/-]/g, '').slice(0, 128) || undefined;

function headerText(v) {
  const s = String((Array.isArray(v) ? v[0] : v) ?? '');
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** What `viewerId` sees of a file: the owner also gets who it's shared with and its key. */
function publicFile(rec, owner, viewerId) {
  const mine = owner.id === viewerId;
  const shares = rec.shares ?? {};
  const latest = Object.values(shares).sort((a, b) => b.at - a.at)[0];
  const share = mine ? latest : own(shares, viewerId);
  return {
    id: rec.id,
    name: rec.name,
    mimeType: rec.mimeType,
    size: rec.size,
    owner: { id: owner.id, name: owner.name, email: owner.email },
    sharedWith: mine ? Object.keys(shares) : [],
    ...(mine
      ? {
          recipients: Object.keys(shares)
            .map((id) => own(index.users, id))
            .filter(Boolean)
            .map((u) => ({ id: u.id, name: u.name, email: u.email })),
          key: rec.key,
        }
      : {}),
    note: share?.note || undefined,
    createdAt: rec.createdAt,
    sharedAt: share?.at,
  };
}

async function deleteFile(store, rec) {
  delete filesOf(store)[rec.id];
  await fs.rm(blobPath(rec), { force: true });
}

/** Drops uploads that were never shared and are older than UNSHARED_TTL. True when something changed. */
async function sweepUnshared(store) {
  let changed = false;
  for (const rec of Object.values(filesOf(store))) {
    if (!Object.keys(rec.shares ?? {}).length && Date.now() - rec.createdAt > UNSHARED_TTL) {
      await deleteFile(store, rec);
      changed = true;
    }
  }
  return changed;
}

/** A file `user` may download: their own, or a friend's that is shared with them. */
async function findReadable(user, id) {
  const store = await loadUser(user.id);
  const mine = own(filesOf(store), id);
  if (mine) return { rec: mine, owner: user, store };
  for (const friendId of friendIdsOf(user.id)) {
    const friendStore = await loadUser(friendId);
    const rec = own(filesOf(friendStore), id);
    if (rec && own(rec.shares, user.id)) return { rec, owner: index.users[friendId], store: friendStore };
  }
  return null;
}

/** Revokes everything two accounts shared with each other (when they stop being friends). */
async function revokeBetween(a, b) {
  for (const [ownerId, otherId] of [
    [a, b],
    [b, a],
  ]) {
    const store = await loadUser(ownerId);
    let changed = false;
    for (const rec of Object.values(filesOf(store))) {
      if (!own(rec.shares, otherId)) continue;
      delete rec.shares[otherId];
      if (!Object.keys(rec.shares).length) await deleteFile(store, rec);
      changed = true;
    }
    if (changed) await writeJson(userFile(ownerId), store);
  }
}

/** Removes blobs no file points to (left by a crash or an interrupted upload). Runs at start-up. */
async function sweepBlobs() {
  await fs.mkdir(BLOB_DIR, { recursive: true });
  const used = new Set();
  try {
    await loadIndex();
    for (const id of Object.keys(index.users)) {
      for (const rec of Object.values((await loadUser(id)).files ?? {})) used.add(rec.blob);
    }
  } catch (e) {
    console.error('Skipped cleaning up shared files:', e.message);
    return;
  }
  for (const name of await fs.readdir(BLOB_DIR)) {
    if (!used.has(name)) await fs.rm(path.join(BLOB_DIR, name), { force: true });
  }
}

// Reading uploads. When a limit is crossed the rest of the body is still read (and dropped, up to
// DRAIN_LIMIT) so the client gets the error reply instead of a reset connection.
const DRAIN_LIMIT = MAX_FILE_BYTES * 2 + 8 * MB;
const inflight = new Map(); // userId -> { bytes, count } of uploads in progress, so parallel uploads can't beat the quota

async function discardBody(req) {
  if (req.readableEnded || req.destroyed) return;
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > DRAIN_LIMIT) return; // ends the loop and drops the connection
  }
}

/** Streams the body into `file`, hashing it. `check(total, chunkSize)` returns an error to stop. */
async function receive(req, file, check) {
  const out = createWriteStream(file);
  const hash = createHash('sha256');
  let size = 0;
  let error = null;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (error) {
        if (size > DRAIN_LIMIT) break;
        continue;
      }
      error = check(size, chunk.length);
      if (error) continue;
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, 'drain');
    }
  } finally {
    out.end();
    await finished(out).catch(() => {});
  }
  if (error) throw error;
  return { size, sha256: hash.digest('hex') };
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > DRAIN_LIMIT) break;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw tooLarge();
  return Buffer.concat(chunks);
}

/** POST /files — the raw file as the body (X-File-Name + Content-Type headers), or JSON {name, mimeType, base64}. */
async function uploadFile(req) {
  const { user } = await authenticate(req);
  rateLimit(`upload:${user.id}`, 120, 60 * 60_000, 'Too many uploads. Try again in a while.');
  const store = await loadUser(user.id);
  if (await sweepUnshared(store)) await writeJson(userFile(user.id), store);
  const files = filesOf(store);
  const stored = Object.values(files).reduce((n, f) => n + f.size, 0);
  const declared = Number(req.headers['content-length']) || 0;
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const raw = req.headers['x-file-name'] !== undefined;
  if (!raw && type !== 'application/json') {
    throw httpError(400, 'Send the file as the request body with an X-File-Name header, or as JSON {name, mimeType, base64}.');
  }
  if (raw && declared > MAX_FILE_BYTES) throw tooLarge();

  const usage = inflight.get(user.id) ?? { bytes: 0, count: 0 };
  inflight.set(user.id, usage);
  usage.count++;
  let counted = 0;
  const part = path.join(BLOB_DIR, `${randomBytes(12).toString('base64url')}.part`);
  try {
    if (Object.keys(files).length + usage.count > MAX_FILES) {
      throw httpError(507, `You can keep up to ${MAX_FILES} shared files. Delete some under Friends → Shared by me first.`);
    }
    if (raw && stored + usage.bytes + declared > QUOTA_BYTES) throw overQuota();
    let name, mimeType, key, size, sha256;
    if (raw) {
      name = sanitizeName(headerText(req.headers['x-file-name']));
      mimeType = sanitizeMime(type);
      key = cleanKey(headerText(req.headers['x-file-key']));
      ({ size, sha256 } = await receive(req, part, (total, n) => {
        if (total > MAX_FILE_BYTES) return tooLarge();
        counted += n;
        usage.bytes += n;
        return stored + usage.bytes > QUOTA_BYTES ? overQuota() : null;
      }));
    } else {
      const body = JSON.parse((await readBody(req, Math.ceil(MAX_FILE_BYTES / 3) * 4 + MB)).toString('utf8') || '{}');
      const data = Buffer.from(String(body.base64 ?? body.data ?? ''), 'base64');
      if (data.length > MAX_FILE_BYTES) throw tooLarge();
      if (stored + usage.bytes + data.length > QUOTA_BYTES) throw overQuota();
      name = sanitizeName(body.name);
      mimeType = sanitizeMime(body.mimeType ?? body.type);
      key = cleanKey(body.key);
      await fs.writeFile(part, data);
      size = data.length;
      sha256 = createHash('sha256').update(data).digest('hex');
    }
    // The same file uploaded again (same bytes and name) reuses the stored copy.
    const same = Object.values(files).find((f) => f.sha256 === sha256 && f.name === name);
    if (same) {
      if (key) same.key = key;
      await writeJson(userFile(user.id), store);
      return { file: publicFile(same, user, user.id), reused: true };
    }
    const rec = { id: fileId(), name, mimeType, size, sha256, key, blob: randomBytes(18).toString('base64url'), createdAt: Date.now(), shares: {} };
    await fs.rename(part, blobPath(rec));
    files[rec.id] = rec;
    await writeJson(userFile(user.id), store);
    return { file: publicFile(rec, user, user.id) };
  } finally {
    await fs.rm(part, { force: true });
    usage.bytes -= counted;
    if (--usage.count === 0) inflight.delete(user.id);
  }
}

/** GET /files/:id — streams the file to its owner or a friend it's shared with. */
async function downloadFile(req, res, id) {
  const { user } = await authenticate(req);
  await loadSocial();
  const found = await findReadable(user, id);
  const stat = found && (await fs.stat(blobPath(found.rec)).catch(() => null));
  if (!stat) throw httpError(404, 'File not found, or it is no longer shared with you.');
  const { rec } = found;
  const ascii = rec.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const utf8 = encodeURIComponent(rec.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  res.writeHead(200, {
    'Content-Type': rec.mimeType,
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  });
  await pipeline(createReadStream(blobPath(rec)), res);
}

const socialRoutes = {
  'GET /friends': async (req) => {
    const { user } = await authenticate(req);
    await loadSocial();
    return { friends: friendsView(user) };
  },

  /** Same reply whether or not the email has an account. If they already asked you, you're friends now. */
  'POST /friends/request': async (req, body) => {
    const { user } = await authenticate(req);
    await loadSocial();
    rateLimit(`friend:${user.id}`, 30, 60 * 60_000, 'Too many friend requests. Try again later.');
    const email = normEmail(body.email);
    if (!EMAIL_RE.test(email)) throw httpError(400, 'Enter a valid email address.');
    if (email === user.email) throw httpError(400, 'That’s your own email.');
    const targetId = own(index.emails, email);
    const requests = Object.values(social.requests);
    if (targetId && areFriends(user.id, targetId)) return { ok: true, friends: friendsView(user) };
    if (targetId && incomingFrom(user, targetId)) {
      makeFriends(user.id, targetId);
    } else if (!requests.some((r) => r.from === user.id && r.toEmail === email)) {
      if (requests.filter((r) => r.from === user.id).length >= MAX_PENDING_REQUESTS) {
        throw httpError(429, 'You have too many pending friend requests. Cancel some first.');
      }
      const id = `r_${randomBytes(12).toString('base64url')}`;
      social.requests[id] = { id, from: user.id, toEmail: email, createdAt: Date.now() };
    }
    await saveSocial();
    return { ok: true, friends: friendsView(user) };
  },

  /** Body: {id} — the account that sent the request. */
  'POST /friends/accept': async (req, body) => {
    const { user } = await authenticate(req);
    await loadSocial();
    const fromId = String(body.id ?? '');
    if (!incomingFrom(user, fromId) || !own(index.users, fromId)) throw httpError(404, 'That friend request is no longer there.');
    makeFriends(user.id, fromId);
    await saveSocial();
    return { ok: true, friends: friendsView(user) };
  },

  /** Body: {id} — declines an incoming request (the sender isn't told), or cancels one you sent. */
  'POST /friends/decline': async (req, body) => {
    const { user } = await authenticate(req);
    await loadSocial();
    const id = String(body.id ?? '');
    const incoming = incomingFrom(user, id);
    if (incoming) incoming.declined = true;
    else if (outgoingRequest(user, id)) delete social.requests[id];
    else throw httpError(404, 'That friend request is no longer there.');
    await saveSocial();
    return { ok: true, friends: friendsView(user) };
  },

  /** Body: {id} — unfriends (revoking files you shared with each other); also cancels/declines requests. */
  'POST /friends/remove': async (req, body) => {
    const { user } = await authenticate(req);
    await loadSocial();
    const id = String(body.id ?? '');
    const incoming = incomingFrom(user, id);
    if (areFriends(user.id, id)) {
      await revokeBetween(user.id, id);
      delete social.friendships[pairKey(user.id, id)];
    } else if (outgoingRequest(user, id)) {
      delete social.requests[id];
    } else if (incoming) {
      incoming.declined = true;
    } else {
      throw httpError(404, 'Not on your friends list.');
    }
    await saveSocial();
    return { ok: true, friends: friendsView(user) };
  },

  'GET /shared': async (req) => {
    const { user } = await authenticate(req);
    await loadSocial();
    const store = await loadUser(user.id);
    if (await sweepUnshared(store)) await writeJson(userFile(user.id), store);
    const sent = Object.values(filesOf(store)).map((rec) => publicFile(rec, user, user.id));
    const received = [];
    for (const friendId of friendIdsOf(user.id)) {
      for (const rec of Object.values(filesOf(await loadUser(friendId)))) {
        if (own(rec.shares, user.id)) received.push(publicFile(rec, index.users[friendId], user.id));
      }
    }
    const newest = (a, b) => (b.sharedAt ?? b.createdAt) - (a.sharedAt ?? a.createdAt);
    return { received: received.sort(newest), sent: sent.sort(newest) };
  },
};

/** Routes with a file id in the path: [method, pattern, handler(req, body, id)]. GET (download) streams. */
const fileRoutes = [
  ['GET', /^\/files\/(f_[\w-]{8,64})$/, null],
  [
    'POST',
    /^\/files\/(f_[\w-]{8,64})\/share$/,
    async (req, body, id) => {
      const { user } = await authenticate(req);
      await loadSocial();
      const store = await loadUser(user.id);
      const rec = own(filesOf(store), id);
      if (!rec) throw httpError(404, 'File not found.');
      const ids = [...new Set((Array.isArray(body.friendIds) ? body.friendIds : []).map(String))];
      if (!ids.length) throw httpError(400, 'Pick at least one friend.');
      if (ids.length > MAX_RECIPIENTS) throw httpError(400, `Share with up to ${MAX_RECIPIENTS} friends at a time.`);
      if (ids.some((f) => !areFriends(user.id, f))) throw httpError(403, 'You can only share files with your friends.');
      const note = cleanNote(body.note);
      const at = Date.now();
      rec.shares ??= {};
      for (const f of ids) rec.shares[f] = note ? { at, note } : { at };
      await writeJson(userFile(user.id), store);
      return { file: publicFile(rec, user, user.id) };
    },
  ],
  [
    'POST',
    /^\/files\/(f_[\w-]{8,64})\/unshare$/,
    async (req, body, id) => {
      const { user } = await authenticate(req);
      await loadSocial();
      const store = await loadUser(user.id);
      const rec = own(filesOf(store), id);
      // The owner stops sharing with some friends (or everyone); a recipient removes it from their list.
      const found = rec ? { rec, owner: user, store } : await findReadable(user, id);
      if (!found) throw httpError(404, 'File not found.');
      const shares = (found.rec.shares ??= {});
      const ids = !rec ? [user.id] : Array.isArray(body.friendIds) ? body.friendIds.map(String) : Object.keys(shares);
      for (const f of ids) if (own(shares, f)) delete shares[f];
      const deleted = !Object.keys(shares).length;
      if (deleted) await deleteFile(found.store, found.rec);
      await writeJson(userFile(found.owner.id), found.store);
      return rec && !deleted ? { ok: true, deleted, file: publicFile(rec, user, user.id) } : { ok: true, deleted };
    },
  ],
  [
    'DELETE',
    /^\/files\/(f_[\w-]{8,64})$/,
    async (req, _body, id) => {
      const { user } = await authenticate(req);
      const store = await loadUser(user.id);
      const rec = own(filesOf(store), id);
      if (!rec) throw httpError(404, 'File not found.');
      await deleteFile(store, rec);
      await writeJson(userFile(user.id), store);
      return { ok: true };
    },
  ],
];

// ---------- HTTP ----------

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name, X-File-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const send = (status, body) => {
    if (res.headersSent) return res.destroy(); // a download failed half-way
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const pathname = new URL(req.url, 'http://x').pathname;
  const key = `${req.method} ${pathname}`;
  let route = routes[key] ?? socialRoutes[key];
  // Uploads and downloads read / write their bodies as streams.
  let stream = key === 'POST /files' ? () => uploadFile(req) : null;
  for (const [method, pattern, handler] of route || stream ? [] : fileRoutes) {
    const m = req.method === method ? pattern.exec(pathname) : null;
    if (!m) continue;
    if (handler) route = (r, body) => handler(r, body, m[1]);
    else stream = () => downloadFile(req, res, m[1]);
    break;
  }
  if (!route && !stream) return send(404, { error: 'Not found' });
  try {
    if (stream) {
      const result = await stream();
      if (result !== undefined) send(200, result);
      return;
    }
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      let size = 0;
      let tooLarge = Number(req.headers['content-length']) > MAX_BODY;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) tooLarge = true;
        if (tooLarge) {
          chunks.length = 0; // keep reading (and discarding) so the client gets the 413, not a reset
          if (size > 4 * MAX_BODY) {
            res.setHeader('Connection', 'close');
            send(413, { error: 'Request too large' });
            return req.destroy();
          }
          continue;
        }
        chunks.push(c);
      }
      if (tooLarge) {
        res.setHeader('Connection', 'close');
        throw httpError(413, 'Request too large');
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      body = raw ? JSON.parse(raw) : {};
    }
    send(200, await route(req, body));
  } catch (e) {
    if (!e.status) console.error(e);
    // Read what's left of an upload so the client gets the error instead of a reset connection.
    if (stream) await discardBody(req).catch(() => {});
    send(e.status ?? (e instanceof SyntaxError ? 400 : 500), { error: e.status ? e.message : 'Server error' });
  }
});

await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
await fs.chmod(DATA_DIR, 0o700).catch(() => {});
await sweepBlobs();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`TryChat server listening on http://0.0.0.0:${PORT}`);
  console.log(`Data: ${DATA_DIR} · sign-up ${ALLOW_SIGNUP ? 'open' : 'closed'}`);
  console.log(`Shared files: up to ${mb(MAX_FILE_BYTES)} each, ${mb(QUOTA_BYTES)} and ${MAX_FILES} files per account`);
});
