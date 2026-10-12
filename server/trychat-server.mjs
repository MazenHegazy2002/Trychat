#!/usr/bin/env node
// TryChat account + sync server. Zero dependencies (Node 18+).
//
//   node server/trychat-server.mjs --port=8787 --data=./trychat-data
//
// Accounts sign in with email + password. Each account's memories, chats, skills,
// MCP server list and preferences are stored here, so every device signed in to the
// same account sees the same data. Secrets (API keys, tokens) never leave the phone.
//
// Put it behind HTTPS (e.g. Caddy: `caddy reverse-proxy --from your.domain --to :8787`)
// before using it over the internet — passwords and data are otherwise sent in plain text.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
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
const COLLECTIONS = new Set(['memories', 'conversations', 'skills', 'mcpServers', 'prefs']);

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
    await fs.writeFile(tmp, JSON.stringify(value));
    await fs.rename(tmp, file);
  });
  writeQueue.set(file, next.catch(() => {}));
  return next;
}

const indexFile = () => path.join(DATA_DIR, 'accounts.json');
const userFile = (id) => path.join(DATA_DIR, `user-${id}.json`);

// In-memory cache, persisted on every change.
let index = null; // { users: {id: {...}}, emails: {email: id}, sessions: {tokenHash: {userId, createdAt}} }
const users = new Map(); // id -> { items: { "collection/id": {collection,id,data,updatedAt,deleted,seq} }, seq }

async function loadIndex() {
  if (!index) index = await readJson(indexFile(), { users: {}, emails: {}, sessions: {} });
  return index;
}

async function loadUser(id) {
  if (!users.has(id)) users.set(id, await readJson(userFile(id), { items: {}, seq: 0 }));
  return users.get(id);
}

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
   * Two-way sync. Body: { since: number, changes: [{collection, id, data, updatedAt, deleted}] }.
   * Last write (by updatedAt) wins per item. Returns every item stored after `since`
   * (a server sequence number, so device clocks don't matter) and the new cursor.
   */
  'POST /sync': async (req, body) => {
    const { user } = await authenticate(req);
    const store = await loadUser(user.id);
    const changes = Array.isArray(body.changes) ? body.changes : [];
    let changed = false;
    for (const c of changes) {
      if (!COLLECTIONS.has(c.collection) || typeof c.id !== 'string' || !c.id) continue;
      const key = `${c.collection}/${c.id}`;
      const existing = store.items[key];
      const updatedAt = Number(c.updatedAt) || Date.now();
      if (existing && existing.updatedAt > updatedAt) continue; // server copy is newer
      store.items[key] = {
        collection: c.collection,
        id: c.id,
        updatedAt,
        deleted: !!c.deleted,
        data: c.deleted ? null : c.data,
        seq: ++store.seq,
      };
      changed = true;
    }
    if (changed) await writeJson(userFile(user.id), store);
    const since = Number(body.since) || 0;
    const items = Object.values(store.items)
      .filter((i) => i.seq > since)
      .map(({ seq, ...rest }) => rest);
    return { cursor: store.seq, items };
  },
};

// ---------- HTTP ----------

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const route = routes[`${req.method} ${new URL(req.url, 'http://x').pathname}`];
  if (!route) return send(404, { error: 'Not found' });
  try {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) throw httpError(413, 'Request too large');
        chunks.push(c);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      body = raw ? JSON.parse(raw) : {};
    }
    send(200, await route(req, body));
  } catch (e) {
    if (!e.status) console.error(e);
    send(e.status ?? (e instanceof SyntaxError ? 400 : 500), { error: e.status ? e.message : 'Server error' });
  }
});

await fs.mkdir(DATA_DIR, { recursive: true });
server.listen(PORT, '0.0.0.0', () => {
  console.log(`TryChat server listening on http://0.0.0.0:${PORT}`);
  console.log(`Data: ${DATA_DIR} · sign-up ${ALLOW_SIGNUP ? 'open' : 'closed'}`);
});
