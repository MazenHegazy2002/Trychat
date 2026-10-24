#!/usr/bin/env node
// TryChat laptop bridge: lets the TryChat phone app list/read/write files and run
// commands on this computer. Zero dependencies — run with `node trychat-bridge.mjs`.
//
// Security:
// - Every request needs the pairing code printed at startup (Authorization: Bearer <code>).
// - File access is limited to the root folder (default: the folder you start it in). Symlinks are
//   followed only when they point inside the root, and writes never go through a symlink.
// - The phone app asks you before every command and every write (configurable in the app).
// - Commands run in their own process group; on timeout the whole group is stopped.
// Only run it on a network you trust; stop it with Ctrl+C when you're done.

import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { constants as FS, realpathSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const USAGE = `Usage: node trychat-bridge.mjs [--root=<folder>] [--port=<port>] [--token=<pairing code>] [--timeout=<ms>]
  --root     folder the phone may use (default: the current folder; env TRYCHAT_BRIDGE_ROOT)
  --port     port to listen on, 1-65535 (default: 8765; env TRYCHAT_BRIDGE_PORT)
  --token    your own pairing code instead of a random one (env TRYCHAT_BRIDGE_TOKEN)
  --timeout  how long a command may run, in milliseconds (default: 120000)
Options can be written --key=value or --key value.`;

function fail(message) {
  console.error(`trychat-bridge: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const known = new Set(['root', 'port', 'token', 'timeout']);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    }
    if (!a.startsWith('--')) fail(`unexpected argument "${a}"`);
    const eq = a.indexOf('='); // only the first "=" separates key and value: --token=a=b is "a=b"
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (!known.has(key)) fail(`unknown option --${key}`);
    if (eq !== -1) out[key] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else fail(`--${key} needs a value`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const isWindows = process.platform === 'win32';

/** "~" alone or followed by a slash means the home folder; other names starting with "~" (like "~$report.docx") are kept. */
const expandHome = (p) => (/^~(?=$|[\\/])/.test(p) ? path.join(os.homedir(), p.slice(1)) : p);

const portText = String(args.port ?? process.env.TRYCHAT_BRIDGE_PORT ?? '8765').trim();
const PORT = Number(portText);
if (!/^\d+$/.test(portText) || PORT < 1 || PORT > 65535) fail(`--port must be a whole number from 1 to 65535 (got "${portText}")`);

const timeoutText = String(args.timeout ?? '120000').trim();
const COMMAND_TIMEOUT_MS = Number(timeoutText);
if (!/^\d+$/.test(timeoutText) || COMMAND_TIMEOUT_MS < 1) fail(`--timeout must be a positive number of milliseconds (got "${timeoutText}")`);

const ROOT = path.resolve(expandHome(args.root ?? process.env.TRYCHAT_BRIDGE_ROOT ?? process.cwd()));
let ROOT_REAL;
try {
  if (!statSync(ROOT).isDirectory()) fail(`--root is not a folder: ${ROOT}`);
  ROOT_REAL = realpathSync.native(ROOT);
} catch (e) {
  fail(`--root folder not found: ${ROOT} (${e.code ?? e.message})`);
}

const customToken = args.token ?? (process.env.TRYCHAT_BRIDGE_TOKEN || undefined);
if (customToken !== undefined && !customToken.trim()) fail('--token must not be empty');
const TOKEN = customToken ?? randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g).join('-');
// A generated code is hex in groups, so case and separators don't matter when typing it on a phone.
// A custom --token is compared exactly.
const normalizeCode = customToken === undefined ? (c) => c.toUpperCase().replace(/[^0-9A-F]/g, '') : (c) => c;
const EXPECTED_AUTH = Buffer.from(`Bearer ${normalizeCode(TOKEN)}`);

function authorized(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const got = Buffer.from(`Bearer ${normalizeCode(header.slice(7))}`);
  return got.length === EXPECTED_AUTH.length && timingSafeEqual(got, EXPECTED_AUTH);
}

const HIDDEN = new Set(['node_modules', '.git']);
const MAX_ENTRIES = 500; // per listing
const READ_BYTES = 10_000; // default text per read: fits in what the app shows the model (12,000 characters)
const MAX_TEXT_READ = 1024 * 1024; // the most text one read may ask for
const MAX_BASE64_READ = 10 * 1024 * 1024; // the most a base64 read (e.g. to send a file) may return
const MAX_BODY = 64 * 1024 * 1024;
const OUTPUT_HEAD = 3_000; // bytes kept from the start of each output stream of a command…
const OUTPUT_TAIL = 6_000; // …and from its end
const MAX_OUTPUT = 10 * 1024 * 1024; // a command printing more than this is stopped
const KILL_GRACE_MS = 2_000; // between SIGTERM and SIGKILL

const httpError = (status, message) => Object.assign(new Error(message), { status });
const outsideRoot = () => httpError(403, `Path is outside the bridge root (${ROOT})`);

/** True when `p` is `base` or inside it. path.relative copes with a root of "/" or "C:\", other drives and case on Windows. */
function isInside(base, p) {
  const rel = path.relative(base, p);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/**
 * Turns a path from the phone into a real path inside the root. Symlinks in the part of the path that exists are
 * resolved, so a link pointing outside the root is refused like any other outside path. Returns the real path and the
 * path to show (relative to the root).
 */
async function resolveInRoot(p, { required = false } = {}) {
  if (p === undefined || p === null || p === '') {
    if (required) throw httpError(400, '"path" is required');
    p = '.';
  }
  if (typeof p !== 'string') throw httpError(400, '"path" must be a string');
  if (p.includes('\0')) throw httpError(400, '"path" must not contain NUL bytes');
  const full = path.resolve(ROOT, expandHome(p));
  if (!isInside(ROOT, full) && !isInside(ROOT_REAL, full)) throw outsideRoot();
  // Resolve the longest existing prefix; the rest (folders or a file still to be created) is appended as is.
  let existing = full;
  const missing = [];
  for (;;) {
    let realPrefix;
    try {
      realPrefix = await fs.realpath(existing);
    } catch (e) {
      const parent = path.dirname(existing);
      if ((e.code !== 'ENOENT' && e.code !== 'ENOTDIR') || parent === existing) throw e;
      missing.unshift(path.basename(existing));
      existing = parent;
      continue;
    }
    const real = path.join(realPrefix, ...missing);
    if (!isInside(ROOT_REAL, real)) throw outsideRoot();
    const rel = isInside(ROOT, full) ? path.relative(ROOT, full) : path.relative(ROOT_REAL, real);
    return { real, rel: rel || '.' };
  }
}

/** Where a complete UTF-8 prefix of `buf` ends (so a cut never splits a character). */
function utf8End(buf) {
  for (let i = buf.length - 1; i >= 0 && i >= buf.length - 4; i--) {
    const b = buf[i];
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    const len = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return i + len <= buf.length ? buf.length : i;
  }
  return buf.length;
}

/** Where the first whole UTF-8 character in `buf` starts (skips continuation bytes of a character cut off in front). */
function utf8Start(buf) {
  let i = 0;
  while (i < 3 && i < buf.length && (buf[i] & 0xc0) === 0x80) i++;
  return i;
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/** The text in `buf`, or null when it looks binary (NUL bytes or invalid UTF-8). */
function decodeText(buf) {
  if (buf.includes(0)) return null;
  try {
    return strictUtf8.decode(buf);
  } catch {
    return null;
  }
}

function intParam(value, name) {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (!Number.isSafeInteger(n)) throw httpError(400, `"${name}" must be a whole number`);
  return n;
}

/** Keeps the start and end of a command's output stream, however long it gets. */
function outputCollector() {
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let total = 0;
  return {
    add(chunk) {
      total += chunk.length;
      if (head.length < OUTPUT_HEAD) {
        const take = chunk.subarray(0, OUTPUT_HEAD - head.length);
        head = Buffer.concat([head, take]);
        chunk = chunk.subarray(take.length);
      }
      if (chunk.length) {
        tail = Buffer.concat([tail, chunk]);
        if (tail.length > OUTPUT_TAIL) tail = Buffer.from(tail.subarray(tail.length - OUTPUT_TAIL));
      }
    },
    get bytes() {
      return total;
    },
    text() {
      if (total <= head.length + tail.length) return Buffer.concat([head, tail]).toString('utf8');
      const h = head.subarray(0, utf8End(head));
      const t = tail.subarray(utf8Start(tail));
      return `${h.toString('utf8')}\n…[${total - h.length - t.length} bytes omitted]…\n${t.toString('utf8')}`;
    },
  };
}

/** Commands still running, so Ctrl+C can stop them too (they run in their own process group). */
const running = new Set();

/** Stops a command and everything it started. */
function killTree(child, signal) {
  if (child.pid === undefined) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
  } else {
    try {
      process.kill(-child.pid, signal); // the whole process group
    } catch {
      // already gone
    }
  }
}

/** Streaming commands by the id the app gave them, so POST /run/kill can stop one. */
const jobs = new Map();

/** `hooks.onData(stream, text)` sees output as it arrives; `hooks.id` registers the command for /run/kill. */
async function runCommand({ command, cwd }, hooks = {}) {
  if (typeof command !== 'string' || !command.trim()) throw httpError(400, '"command" is required');
  if (command.includes('\0')) throw httpError(400, '"command" must not contain NUL bytes');
  const { real: dir, rel } = await resolveInRoot(cwd);
  if (!(await fs.stat(dir)).isDirectory()) throw httpError(400, `${rel} is not a folder`);
  console.log(`[run] (${rel}) ${command}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: dir,
      shell: true,
      detached: !isWindows, // own process group, so a timeout can stop grandchildren too
      stdio: ['ignore', 'pipe', 'pipe'], // nothing waits forever on input
      windowsHide: true,
    });
    running.add(child);
    const stdout = outputCollector();
    const stderr = outputCollector();
    let stoppedFor = null; // 'timeout' | 'output'
    const timers = [];
    let finished = false;

    const finish = (result, error) => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      running.delete(child);
      if (hooks.id) jobs.delete(hooks.id);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (error) return reject(httpError(500, `Could not start the command: ${error.message}`));
      resolve({
        ...result,
        timedOut: stoppedFor === 'timeout',
        ...(stoppedFor === 'timeout' ? { timeoutMs: COMMAND_TIMEOUT_MS } : {}),
        ...(stoppedFor === 'output' ? { outputLimit: MAX_OUTPUT } : {}),
        ...(stoppedFor === 'killed' ? { killed: true } : {}),
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutBytes: stdout.bytes,
        stderrBytes: stderr.bytes,
      });
    };

    const stop = (why) => {
      if (stoppedFor) return;
      stoppedFor = why;
      killTree(child, 'SIGTERM');
      timers.push(setTimeout(() => killTree(child, 'SIGKILL'), KILL_GRACE_MS));
      // If something that left the process group still holds the output open, answer anyway.
      timers.push(setTimeout(() => finish({ exitCode: null, signal: 'SIGKILL' }), KILL_GRACE_MS + 2_000));
    };
    timers.push(setTimeout(() => stop('timeout'), COMMAND_TIMEOUT_MS));
    if (hooks.id) jobs.set(hooks.id, () => stop('killed'));
    hooks.onStart?.(stop);

    const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
    const collect = (sink) => (chunk) => {
      sink.add(chunk);
      if (hooks.onData) {
        const name = sink === stdout ? 'stdout' : 'stderr';
        const text = decoders[name].decode(chunk, { stream: true });
        if (text) hooks.onData(name, text);
      }
      if (stdout.bytes + stderr.bytes > MAX_OUTPUT) stop('output');
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', (e) => finish(null, e));
    child.on('close', (code, signal) => finish({ exitCode: code, signal: signal ?? null }));
  });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw httpError(413, 'Request is too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw httpError(400, 'Request body is not valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Request body must be a JSON object');
  return body;
}

const routes = {
  'GET /health': async () => ({
    ok: true,
    hostname: os.hostname(),
    platform: process.platform,
    root: ROOT,
  }),

  'POST /list': async ({ path: p }) => {
    const { real, rel } = await resolveInRoot(p);
    const all = (await fs.readdir(real, { withFileTypes: true }))
      .filter((e) => !HIDDEN.has(e.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const entries = await Promise.all(
      all.slice(0, MAX_ENTRIES).map(async (e) => {
        // A symlinked folder is a folder too.
        const isDir = e.isSymbolicLink()
          ? await fs.stat(path.join(real, e.name)).then((s) => s.isDirectory(), () => false)
          : e.isDirectory();
        return isDir ? e.name + '/' : e.name;
      }),
    );
    return { path: rel, entries, total: all.length, more: Math.max(0, all.length - MAX_ENTRIES) };
  },

  // {path, offset?, length?, encoding?: 'utf8' | 'base64'}. A negative offset counts from the end of the file.
  // Text reads return at most `length` bytes (default READ_BYTES) plus the file's size, so big files are never
  // loaded whole; binary files are reported as such unless base64 is asked for.
  'POST /read': async ({ path: p, offset, length, encoding = 'utf8' }) => {
    if (encoding !== 'utf8' && encoding !== 'base64') throw httpError(400, '"encoding" must be "utf8" or "base64"');
    const { real, rel } = await resolveInRoot(p, { required: true });
    const st = await fs.stat(real);
    if (st.isDirectory()) throw httpError(400, `${rel} is a folder, not a file`);
    if (!st.isFile()) throw httpError(400, `${rel} is not a regular file`);
    const size = st.size;
    let start = intParam(offset, 'offset') ?? 0;
    if (start < 0) start = Math.max(0, size + start);
    start = Math.min(start, size);
    const asked = intParam(length, 'length');
    if (asked !== undefined && asked < 0) throw httpError(400, '"length" must not be negative');

    let want;
    if (encoding === 'base64') {
      want = asked ?? size - start;
      if (want > MAX_BASE64_READ) {
        throw httpError(413, `${rel} is too big to send (${size} bytes; the limit is ${MAX_BASE64_READ} bytes)`);
      }
    } else {
      want = Math.min(asked ?? READ_BYTES, MAX_TEXT_READ);
    }
    want = Math.min(want, size - start);

    const buf = Buffer.alloc(want);
    let got = 0;
    const fh = await fs.open(real, 'r');
    try {
      while (got < want) {
        const { bytesRead } = await fh.read(buf, got, want - got, start + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
    } finally {
      await fh.close();
    }
    const chunk = buf.subarray(0, got);
    if (encoding === 'base64') {
      return { path: rel, size, offset: start, end: start + got, encoding, content: chunk.toString('base64') };
    }
    // Don't start or end in the middle of a character.
    const from = start > 0 ? utf8Start(chunk) : 0;
    const to = start + got < size ? utf8End(chunk) : chunk.length;
    const content = decodeText(chunk.subarray(from, Math.max(from, to)));
    if (content === null) return { path: rel, size, binary: true };
    return { path: rel, size, offset: start + from, end: start + Math.max(from, to), content };
  },

  'POST /write': async ({ path: p, content }) => {
    if (typeof content !== 'string') throw httpError(400, '"content" must be a string');
    const { real, rel } = await resolveInRoot(p, { required: true });
    await fs.mkdir(path.dirname(real), { recursive: true });
    // The folder exists now: check where it really is, and never write through a symlink as the file itself.
    const dir = await fs.realpath(path.dirname(real));
    if (!isInside(ROOT_REAL, dir)) throw outsideRoot();
    let fh;
    try {
      fh = await fs.open(path.join(dir, path.basename(real)), FS.O_WRONLY | FS.O_CREAT | FS.O_TRUNC | (FS.O_NOFOLLOW ?? 0), 0o666);
    } catch (e) {
      if (e.code === 'ELOOP') throw httpError(403, `${rel} is a symlink; not writing through it`);
      if (e.code === 'EISDIR') throw httpError(400, `${rel} is a folder, not a file`);
      throw e;
    }
    try {
      await fh.writeFile(content, 'utf8');
    } finally {
      await fh.close();
    }
    return { path: rel, bytes: Buffer.byteLength(content) };
  },

  'POST /run': (body) => runCommand(body),

  // {id} — stops a command started with /run/stream (and everything it started).
  'POST /run/kill': async ({ id }) => {
    const stop = jobs.get(String(id ?? ''));
    if (stop) stop();
    return { killed: !!stop };
  },
};

/**
 * POST /run/stream {command, cwd?, id?}: like /run, but answers at once with newline-delimited JSON:
 * {"type":"start","id"}, then {"type":"stdout"|"stderr","data"} as output arrives, then
 * {"type":"exit", ...the /run result without stdout/stderr}. Closing the connection stops the command.
 */
async function runStream(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    const [status, error] = describeError(e);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error }));
  }
  const id = typeof body.id === 'string' && body.id ? body.id.slice(0, 100) : randomBytes(8).toString('hex');
  let started = false;
  let stopFn = null;
  const line = (obj) => res.write(JSON.stringify(obj) + '\n');
  const begin = () => {
    if (started) return;
    started = true;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    line({ type: 'start', id });
  };
  res.on('close', () => {
    if (!res.writableFinished) stopFn?.('killed');
  });
  try {
    const result = await runCommand(body, {
      id,
      onStart: (stop) => {
        stopFn = stop;
        begin();
      },
      onData: (stream, data) => line({ type: stream, data }),
    });
    begin();
    const { stdout, stderr, ...rest } = result;
    line({ type: 'exit', ...rest });
    res.end();
  } catch (e) {
    const [status, error] = describeError(e);
    if (started) {
      line({ type: 'error', status, error });
      return res.end();
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error }));
  }
}

/** Status and message for an error, without exposing internals. */
function describeError(e) {
  if (e.status) return [e.status, e.message];
  const where = typeof e.path === 'string' && isInside(ROOT_REAL, e.path) ? `: ${path.relative(ROOT_REAL, e.path) || '.'}` : '';
  switch (e.code) {
    case 'ENOENT':
      return [404, `No such file or folder${where}`];
    case 'ENOTDIR':
      return [400, `Not a folder${where}`];
    case 'EISDIR':
      return [400, `That is a folder, not a file${where}`];
    case 'EACCES':
    case 'EPERM':
      return [403, `Permission denied${where}`];
    case 'ELOOP':
      return [400, `Too many levels of symlinks${where}`];
    case 'EEXIST':
      return [409, `A file is in the way${where}`];
    case 'ENAMETOOLONG':
      return [400, 'Path is too long'];
    case 'ENOSPC':
      return [507, 'The disk is full'];
    default:
      console.error('[error]', e);
      return [500, 'Internal error in the bridge (details are in its window)'];
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (!authorized(req.headers.authorization)) return send(401, { error: 'Wrong pairing code' });

  const key = `${req.method} ${(req.url ?? '/').split('?')[0]}`;
  if (key === 'POST /run/stream') return runStream(req, res);
  const route = routes[key];
  if (!route) return send(404, { error: 'Not found' });
  try {
    send(200, await route(req.method === 'POST' ? await readBody(req) : {}));
  } catch (e) {
    const [status, error] = describeError(e);
    send(status, { error });
  }
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `trychat-bridge: port ${PORT} is already in use; pick another with --port` : e);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of running) killTree(child, 'SIGKILL');
    process.exit(0);
  });
}

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
