import { File, Paths } from 'expo-file-system';

import type { Attachment } from './types';

/** A file in the Files library: everything sent, received or shared, kept on this device. */
export interface LibraryFile extends Attachment {
  addedAt: number;
  /** The chat it came from, if any. */
  conversationId?: string;
}

/**
 * The library is a metadata index (a JSON file in the documents folder); the files themselves stay
 * where they are (attachments/, files/…). Writes are serialised so concurrent adds don't lose entries.
 */

const INDEX_NAME = 'library.json';
let cache: LibraryFile[] | null = null;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

const indexFile = () => new File(Paths.document, INDEX_NAME);

async function load(): Promise<LibraryFile[]> {
  if (cache) return cache;
  try {
    const f = indexFile();
    const parsed = f.exists ? JSON.parse(await f.text()) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.id === 'string' && typeof x.uri === 'string') : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function save(list: LibraryFile[]) {
  cache = list;
  indexFile().write(JSON.stringify(list));
  listeners.forEach((fn) => fn());
}

/** Runs index changes one at a time. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

function exists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/** All library files, newest first. Entries whose file is gone (e.g. its chat was deleted) are dropped. */
export function listLibrary(): Promise<LibraryFile[]> {
  return serial(async () => {
    const list = await load();
    const present = list.filter((f) => exists(f.uri));
    if (present.length !== list.length) save(present);
    return [...present].sort((a, b) => b.addedAt - a.addedAt);
  });
}

/** Adds a file (already copied to this device) to the library. Adding the same file twice keeps one entry. */
export function addToLibrary(file: Attachment, conversationId?: string): Promise<LibraryFile> {
  return serial(async () => {
    const list = await load();
    const existing = list.find((f) => f.id === file.id || f.uri === file.uri);
    if (existing) return existing;
    // Text is re-read from the file when needed; the index only keeps metadata.
    const { text: _text, ...meta } = file;
    const entry: LibraryFile = { ...meta, origin: file.origin ?? 'upload', addedAt: Date.now(), ...(conversationId ? { conversationId } : {}) };
    save([entry, ...list]);
    return entry;
  });
}

/** Removes a file from the library and deletes its local copy. */
export function removeFromLibrary(id: string): Promise<void> {
  return serial(async () => {
    const list = await load();
    const entry = list.find((f) => f.id === id);
    if (!entry) return;
    try {
      const f = new File(entry.uri);
      if (f.exists) f.delete();
      // Files the assistant made live in their own folder (files/<id>/name); remove it when empty.
      const dir = f.parentDirectory;
      if (/\/files\/[^/]+\/?$/.test(dir.uri) && dir.exists && dir.list().length === 0) dir.delete();
    } catch {
      // already gone
    }
    save(list.filter((f) => f.id !== id));
  });
}

export async function getLibraryFile(id: string): Promise<LibraryFile | undefined> {
  return (await listLibrary()).find((f) => f.id === id);
}

/** Called whenever the library changes. Returns an unsubscribe function. */
export function subscribeLibrary(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// "Attach to a new chat": files waiting to be put in a chat's composer (too big for route params).
const queued = new Map<string, Attachment[]>();

export function queueAttachments(conversationId: string, files: Attachment[]) {
  queued.set(conversationId, files);
}

export function takeQueuedAttachments(conversationId: string): Attachment[] {
  const files = queued.get(conversationId) ?? [];
  queued.delete(conversationId);
  return files;
}

/** For tests: forget the in-memory index. */
export function resetLibraryCache() {
  cache = null;
}
