#!/usr/bin/env node
// TryChat laptop bridge: lets the TryChat phone app list/read/write files and run
// commands on this computer. Zero dependencies — run with `node trychat-bridge.mjs`.
//
// Security:
// - Every request needs the pairing code printed at startup (Authorization: Bearer <code>).
// - File access is limited to the root folder (default: the folder you start it in).
// - The phone app asks you before every command and every write (configurable in the app).
// Only run it on a network you trust; stop it with Ctrl+C when you're done.

import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

const PORT = Number(args.port ?? process.env.TRYCHAT_BRIDGE_PORT ?? 8765);
const expandHome = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const ROOT = path.resolve(expandHome(args.root ?? process.env.TRYCHAT_BRIDGE_ROOT ?? process.cwd()));
const TOKEN =
  args.token ??
  process.env.TRYCHAT_BRIDGE_TOKEN ??
  randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g).join('-');
const MAX_OUTPUT = 64 * 1024;
const COMMAND_TIMEOUT_MS = Number(args.timeout ?? 120_000);

function resolveInRoot(p = '.') {
  const full = path.resolve(ROOT, expandHome(p));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    throw Object.assign(new Error(`Path is outside the bridge root (${ROOT})`), { status: 403 });
  }
  return full;
}

function truncate(s) {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…[truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const routes = {
  'GET /health': async () => ({
    ok: true,
    hostname: os.hostname(),
    platform: process.platform,
    root: ROOT,
  }),

  'POST /list': async ({ path: p = '.' }) => {
    const dir = resolveInRoot(p);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return {
      path: path.relative(ROOT, dir) || '.',
      entries: entries
        .filter((e) => !['node_modules', '.git'].includes(e.name))
        .slice(0, 500)
        .map((e) => (e.isDirectory() ? e.name + '/' : e.name)),
    };
  },

  'POST /read': async ({ path: p }) => {
    const file = resolveInRoot(p);
    const content = await fs.readFile(file, 'utf8');
    return { path: path.relative(ROOT, file), content: truncate(content) };
  },

  'POST /write': async ({ path: p, content }) => {
    if (typeof content !== 'string') throw Object.assign(new Error('content must be a string'), { status: 400 });
    const file = resolveInRoot(p);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
    return { path: path.relative(ROOT, file), bytes: Buffer.byteLength(content) };
  },

  'POST /run': ({ command, cwd = '.' }) =>
    new Promise((resolve, reject) => {
      if (!command) return reject(Object.assign(new Error('command is required'), { status: 400 }));
      let dir;
      try {
        dir = resolveInRoot(cwd);
      } catch (e) {
        return reject(e);
      }
      console.log(`[run] (${path.relative(ROOT, dir) || '.'}) ${command}`);
      exec(command, { cwd: dir, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({
          exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          timedOut: !!err?.killed,
          stdout: truncate(stdout),
          stderr: truncate(stderr),
        });
      });
    }),
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Wrong pairing code' });

  const route = routes[`${req.method} ${new URL(req.url, 'http://x').pathname}`];
  if (!route) return send(404, { error: 'Not found' });
  try {
    send(200, await route(req.method === 'POST' ? await readBody(req) : {}));
  } catch (e) {
    send(e.status ?? (e.code === 'ENOENT' ? 404 : 500), { error: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
  console.log('\nTryChat bridge is running.\n');
  console.log('  In the app: Settings → Connections → Laptop, then enter:\n');
  console.log(`  Bridge address:  ${addresses[0] ?? `http://<this-computer-ip>:${PORT}`}`);
  addresses.slice(1).forEach((a) => console.log(`                   ${a}`));
  console.log(`  Pairing code:    ${TOKEN}`);
  console.log(`\n  Files are limited to: ${ROOT}`);
  console.log('  Press Ctrl+C to stop.\n');
});
