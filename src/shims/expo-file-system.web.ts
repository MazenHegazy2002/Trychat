/**
 * Web / desktop stand-in for the parts of expo-file-system the app uses (metro.config.js points
 * `expo-file-system` here when bundling for web). expo-file-system has no web implementation.
 *
 * Files live in memory, mirrored to IndexedDB so they survive restarts; `webReady` resolves once the
 * stored files are loaded (the app waits for it before rendering). Paths look like native ones
 * ("file:///document/attachments/x.jpg"), so stored attachment URIs work the same way. Other URIs
 * (blob:, data:, http:) — what the web pickers and image manipulator return — can be read and copied.
 * Images are shown through webObjectUrl(), which turns a stored file into a blob: URL.
 */

type Entry = { dir: true; mtime: number } | { dir: false; data: Uint8Array; mtime: number };

const ROOT = 'file:///';
const DB_NAME = 'trychat-files';
const STORE = 'entries';

const entries = new Map<string, Entry>();
let db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const webReady: Promise<void> = (async () => {
  db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db!.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      entries.set(String(cursor.key), cursor.value as Entry);
      cursor.continue();
    };
    req.onerror = () => resolve();
  });
})();

function persist(path: string) {
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const e = entries.get(path);
    if (e) tx.objectStore(STORE).put(e, path);
    else tx.objectStore(STORE).delete(path);
  } catch (e) {
    console.warn('[files] could not save', path, e);
  }
}

function setEntry(path: string, e: Entry | null) {
  if (e) entries.set(path, e);
  else entries.delete(path);
  persist(path);
  urlCache.delete(path);
}

const isLocal = (uri: string) => uri.startsWith(ROOT);
const trimSlash = (p: string) => p.replace(/\/+$/, '');

function normalize(uri: string): string {
  if (!isLocal(uri)) return uri;
  const parts: string[] = [];
  for (const seg of uri.slice(ROOT.length).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(decodeURIComponent(seg));
  }
  return ROOT + parts.join('/');
}

function joinUris(parts: any[]): string {
  let out = '';
  for (const p of parts) {
    const s = typeof p === 'string' ? p : p?.uri ?? String(p);
    out = !out || /^[a-z]+:/i.test(s) ? s : `${trimSlash(out)}/${s.replace(/^\/+/, '')}`;
  }
  return normalize(out);
}

const parentPath = (path: string) => (path.lastIndexOf('/') > ROOT.length - 1 ? path.slice(0, path.lastIndexOf('/')) : ROOT);
const baseName = (path: string) => decodeURIComponent(trimSlash(path).split('/').pop() ?? '');

function ensureParents(path: string) {
  let p = parentPath(path);
  const missing: string[] = [];
  while (p.length > ROOT.length && !entries.has(p)) {
    missing.push(p);
    p = parentPath(p);
  }
  for (const m of missing) setEntry(m, { dir: true, mtime: Date.now() });
}

const childrenOf = (path: string) => [...entries.keys()].filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
const descendantsOf = (path: string) => [...entries.keys()].filter((k) => k.startsWith(path + '/'));

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  m4a: 'audio/mp4', mp3: 'audio/mpeg', webm: 'audio/webm', wav: 'audio/wav', mp4: 'video/mp4', zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const mimeFor = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as any);
  return btoa(bin);
}

function fromBase64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes of a remote/blob/data URI (async: these can only be fetched). */
async function fetchBytes(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  if (!res.ok && res.status !== 0) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const urlCache = new Map<string, string>();

/** A URL an <img> can show for `uri` (stored files become blob: URLs). */
export function webObjectUrl(uri: string): string {
  const path = normalize(uri);
  if (!isLocal(path)) return uri;
  const e = entries.get(path);
  if (!e || e.dir) return uri;
  let url = urlCache.get(path);
  if (!url) {
    url = URL.createObjectURL(new Blob([e.data as BlobPart], { type: mimeFor(path) || 'application/octet-stream' }));
    urlCache.set(path, url);
  }
  return url;
}

export class File {
  uri: string;

  constructor(...uris: any[]) {
    this.uri = joinUris(uris);
  }

  private get entry(): Entry | undefined {
    return entries.get(this.uri);
  }

  private data(): Uint8Array {
    const e = this.entry;
    if (!e || e.dir) throw new Error(`File ${this.uri} does not exist`);
    return e.data;
  }

  get exists() {
    if (!isLocal(this.uri)) return true;
    const e = this.entry;
    return !!e && !e.dir;
  }

  get name() {
    return isLocal(this.uri) ? baseName(this.uri) : baseName(this.uri.split(/[?#]/)[0]);
  }

  get extension() {
    const m = this.name.match(/\.[^.]+$/);
    return m ? m[0] : '';
  }

  get size() {
    const e = this.entry;
    return e && !e.dir ? e.data.length : 0;
  }

  get type() {
    return mimeFor(this.name);
  }

  get modificationTime() {
    return this.entry?.mtime ?? null;
  }

  get md5() {
    // Not a real MD5: a stable fingerprint, only used to recognise the same file again.
    const d = this.entry && !this.entry.dir ? this.entry.data : null;
    if (!d) return null;
    let h1 = 0x811c9dc5;
    let h2 = 0;
    for (let i = 0; i < d.length; i++) {
      h1 = Math.imul(h1 ^ d[i], 16777619);
      h2 = (h2 * 31 + d[i]) | 0;
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + d.length.toString(16);
  }

  get parentDirectory() {
    return new Directory(parentPath(this.uri));
  }

  create(options?: { intermediates?: boolean; overwrite?: boolean }) {
    if (this.exists && !options?.overwrite) throw new Error(`File ${this.uri} already exists`);
    ensureParents(this.uri);
    setEntry(this.uri, { dir: false, data: new Uint8Array(0), mtime: Date.now() });
  }

  write(content: string | Uint8Array, options?: { encoding?: string }) {
    const data =
      typeof content === 'string' ? (options?.encoding === 'base64' ? fromBase64(content) : encoder.encode(content)) : new Uint8Array(content);
    ensureParents(this.uri);
    setEntry(this.uri, { dir: false, data, mtime: Date.now() });
  }

  private async read(): Promise<Uint8Array> {
    return isLocal(this.uri) ? this.data() : fetchBytes(this.uri);
  }

  async text() {
    return decoder.decode(await this.read());
  }

  textSync() {
    return decoder.decode(this.data());
  }

  async bytes() {
    return new Uint8Array(await this.read());
  }

  bytesSync() {
    return new Uint8Array(this.data());
  }

  async base64() {
    return toBase64(await this.read());
  }

  base64Sync() {
    return toBase64(this.data());
  }

  async arrayBuffer() {
    const b = await this.read();
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }

  delete() {
    if (!this.exists) throw new Error(`File ${this.uri} does not exist`);
    setEntry(this.uri, null);
  }

  private targetFor(dest: File | Directory) {
    return dest instanceof Directory ? joinUris([dest.uri, this.name]) : dest.uri;
  }

  async copy(dest: File | Directory) {
    const target = this.targetFor(dest);
    const data = await this.read();
    ensureParents(target);
    setEntry(target, { dir: false, data: new Uint8Array(data), mtime: Date.now() });
  }

  async move(dest: File | Directory, _options?: { overwrite?: boolean }) {
    const target = this.targetFor(dest);
    const data = await this.read();
    ensureParents(target);
    setEntry(target, { dir: false, data, mtime: Date.now() });
    if (isLocal(this.uri) && target !== this.uri) setEntry(this.uri, null);
    this.uri = target;
  }

  info() {
    return { exists: this.exists, uri: this.uri, size: this.size, modificationTime: this.modificationTime };
  }

  open(): never {
    throw new Error('File handles are not available in the desktop app.');
  }

  static async downloadFileAsync(url: string, dest: File | Directory, options?: { headers?: Record<string, string>; onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void }) {
    const res = await fetch(url, { headers: options?.headers });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    const file = dest instanceof Directory ? new File(dest, baseName(url.split(/[?#]/)[0]) || 'download') : dest;
    file.write(data);
    options?.onProgress?.({ bytesWritten: data.length, totalBytes: data.length });
    return file;
  }
}

export class Directory {
  uri: string;

  constructor(...uris: any[]) {
    this.uri = joinUris(uris);
  }

  private get path() {
    return trimSlash(this.uri);
  }

  get exists() {
    return this.path.length < ROOT.length || this.path + '/' === ROOT || entries.get(this.path)?.dir === true;
  }

  get name() {
    return baseName(this.path);
  }

  get size() {
    let total = 0;
    for (const k of descendantsOf(this.path)) {
      const e = entries.get(k);
      if (e && !e.dir) total += e.data.length;
    }
    return total;
  }

  get parentDirectory() {
    return new Directory(parentPath(this.path));
  }

  create(options?: { intermediates?: boolean; idempotent?: boolean }) {
    if (this.exists) {
      if (options?.idempotent) return;
      throw new Error(`Directory ${this.uri} already exists`);
    }
    ensureParents(this.path);
    setEntry(this.path, { dir: true, mtime: Date.now() });
  }

  delete() {
    for (const k of descendantsOf(this.path)) setEntry(k, null);
    setEntry(this.path, null);
  }

  list(): (File | Directory)[] {
    return childrenOf(this.path).map((k) => (entries.get(k)?.dir ? new Directory(k) : new File(k)));
  }

  createFile(name: string, _mimeType: string | null) {
    const f = new File(this.path, name);
    f.create();
    return f;
  }

  createDirectory(name: string) {
    const d = new Directory(this.path, name);
    d.create();
    return d;
  }

  async move(dest: Directory) {
    const target = dest.exists ? joinUris([dest.uri, this.name]) : trimSlash(dest.uri);
    for (const k of [this.path, ...descendantsOf(this.path)]) {
      const e = entries.get(k)!;
      setEntry(target + k.slice(this.path.length), e);
      setEntry(k, null);
    }
    this.uri = target;
  }

  async copy(dest: Directory) {
    const target = dest.exists ? joinUris([dest.uri, this.name]) : trimSlash(dest.uri);
    for (const k of [this.path, ...descendantsOf(this.path)]) setEntry(target + k.slice(this.path.length), entries.get(k)!);
  }

  info() {
    return { exists: this.exists, uri: this.uri, size: this.size };
  }

  static async pickDirectoryAsync(): Promise<Directory> {
    throw new Error('Picking a folder is not available in the desktop app.');
  }
}

export const Paths = {
  get document() {
    return new Directory(ROOT + 'document');
  },
  get cache() {
    return new Directory(ROOT + 'cache');
  },
  get bundle() {
    return new Directory(ROOT + 'bundle');
  },
  get totalDiskSpace() {
    return 0;
  },
  get availableDiskSpace() {
    return 0;
  },
};

export enum FileMode {
  ReadOnly = 'r',
  WriteOnly = 'w',
  ReadWrite = 'rw',
}

export enum EncodingType {
  UTF8 = 'utf8',
  Base64 = 'base64',
}

export enum UploadType {
  BINARY_CONTENT = 0,
  MULTIPART = 1,
}
