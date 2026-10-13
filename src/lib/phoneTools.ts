import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { decodeText, formatBytes, hasBinaryExtension, looksBinary, mimeOf, textPage } from './github';
import { uid } from './id';
import { withFiles } from './toolResult';
import type { Args, ToolContext, ToolDef } from './tools';
import type { Attachment, PhoneFolder } from './types';

/**
 * The folder on this phone the user shared with TryChat (Connections → Phone folder) and the phone.* tools.
 *
 * Android: a folder chosen in the system picker (Storage Access Framework). Its content:// URIs can't be built by
 * joining paths, so every lookup walks down from the folder by listing it — which also keeps every path inside it
 * (".." and absolute paths are refused, and Android itself only grants that folder's tree).
 * iOS: TryChat's own Documents folder (visible in Files → On My iPhone → TryChat; access never expires), or a
 * folder picked in Files — iOS only keeps access to that until the app closes.
 */

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_SEND_BYTES = 25 * 1024 * 1024;
const MAX_LIST = 300;

type Entry = Directory | File;
interface Child {
  name: string;
  entry: Entry;
  isDir: boolean;
}

export const phoneFolderSupported = () => Platform.OS === 'android' || Platform.OS === 'ios';

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** A file or folder's display name from its URI (SAF document ids look like "primary:Documents/notes.txt"). */
export function entryName(uri: string): string {
  const u = uri.replace(/\/+$/, '');
  if (u.startsWith('content://')) {
    const i = u.lastIndexOf('/document/');
    const id = safeDecode(i >= 0 ? u.slice(i + 10) : u.slice(u.lastIndexOf('/tree/') + 6));
    return id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id.slice(id.indexOf(':') + 1);
  }
  return safeDecode(u.slice(u.lastIndexOf('/') + 1));
}

/** Name to show for a picked folder. */
export function folderName(uri: string): string {
  const name = entryName(uri);
  if (name) return name;
  return /\/tree\/primary/i.test(uri) ? 'Internal storage' : 'Phone storage';
}

/** The root of the shared folder. TryChat's own folder is looked up fresh (iOS can move the app's container). */
function rootDir(folder: PhoneFolder): Directory {
  return folder.source === 'app' ? Paths.document : new Directory(folder.uri);
}

function lostAccess(folder: PhoneFolder): Error {
  return new Error(
    Platform.OS === 'ios' && folder.source === 'picked'
      ? `TryChat can't open “${folder.name}” any more — iOS only keeps access to a picked folder until the app closes. Ask the user to choose it again in Connections → Phone folder (or use the TryChat folder, which stays connected).`
      : `TryChat can't open “${folder.name}” any more (it may have been moved, deleted or its permission removed). Ask the user to choose it again in Connections → Phone folder.`,
  );
}

function openRoot(folder: PhoneFolder): Directory {
  const root = rootDir(folder);
  let ok = false;
  try {
    ok = root.exists;
  } catch {
    ok = false;
  }
  if (!ok) throw lostAccess(folder);
  return root;
}

/** Splits a path relative to the shared folder; refuses URIs and anything that climbs out of it. */
export function splitPath(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (typeof input !== 'string') throw new Error('"path" must be text, like "notes/todo.md".');
  const raw = input.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) throw new Error('Give a path inside the shared folder (like "notes/todo.md"), not a URI.');
  const out: string[] = [];
  for (const part of raw.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) throw new Error(`"${raw}" points outside the shared folder — paths must stay inside it.`);
      out.pop();
      continue;
    }
    if (/[\u0000-\u001f]/.test(part)) throw new Error(`"${part}" isn't a valid file name.`);
    out.push(part);
  }
  return out;
}

const fileUrl = (u: string) => safeDecode(u).replace(/\/+$/, '').replace(/^file:\/\/\/private\/var\//, 'file:///var/');

function children(dir: Directory, root: Directory): Child[] {
  const base = root.uri.startsWith('file:') ? fileUrl(root.uri) : null;
  return dir.list().map((entry) => {
    // Defence in depth for file:// folders; SAF can't hand out anything outside the granted tree.
    if (base && !(fileUrl(entry.uri) + '/').startsWith(base + '/')) throw new Error('That item is outside the shared folder.');
    return { entry, isDir: entry instanceof Directory, name: entryName(entry.uri) };
  });
}

function findChild(list: Child[], name: string): Child | undefined {
  const exact = list.find((c) => c.name === name);
  if (exact) return exact;
  const loose = list.filter((c) => c.name.toLowerCase() === name.toLowerCase());
  return loose.length === 1 ? loose[0] : undefined;
}

/** Drops a leading copy of the shared folder's own name ("Notes/todo.md" when "Notes" is the shared folder). */
function relative(segs: string[], folder: PhoneFolder, rootList: Child[]): string[] {
  if (segs.length > 1 && segs[0].toLowerCase() === folder.name.toLowerCase() && !findChild(rootList, segs[0])) return segs.slice(1);
  return segs;
}

interface Located {
  child: Child | null; // null = the root itself
  path: string;
}

function locate(folder: PhoneFolder, root: Directory, input: unknown): Located {
  const rootList = children(root, root);
  const segs = relative(splitPath(input), folder, rootList);
  let list = rootList;
  let child: Child | null = null;
  for (let i = 0; i < segs.length; i++) {
    if (child && !child.isDir) throw new Error(`${segs.slice(0, i).join('/')} is a file, not a folder.`);
    const next = findChild(list, segs[i]);
    if (!next) {
      const at = segs.slice(0, i).join('/') || 'the shared folder';
      throw new Error(`No “${segs[i]}” in ${at}. Use phone.list or phone.search to find the right path.`);
    }
    child = next;
    if (i < segs.length - 1 && next.isDir) list = children(next.entry as Directory, root);
  }
  return { child, path: child ? segs.join('/') : '' };
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

function stamp(f: File): string {
  try {
    const t = f.lastModified ?? f.modificationTime;
    return t ? ` · ${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}` : '';
  } catch {
    return '';
  }
}

function sizeOf(f: File): number {
  try {
    return f.size ?? 0;
  } catch {
    return 0;
  }
}

function describeList(dir: Directory, root: Directory, path: string, folder: PhoneFolder): string {
  const list = children(dir, root).sort((x, y) => Number(y.isDir) - Number(x.isDir) || x.name.localeCompare(y.name));
  const shown = list.slice(0, MAX_LIST).map((c) =>
    c.isDir ? `${join(path, c.name)}/` : `${join(path, c.name)} · ${formatBytes(sizeOf(c.entry as File))}${stamp(c.entry as File)}`,
  );
  const more = list.length > MAX_LIST ? `\n…and ${list.length - MAX_LIST} more. Use phone.search to find a file by name.` : '';
  return `[Phone folder “${folder.name}” /${path} · ${list.length} item${list.length === 1 ? '' : 's'}]\n${shown.join('\n') || '(empty folder)'}${more}`;
}

async function readBytes(file: File, size: number): Promise<{ bytes: Uint8Array; partial: boolean }> {
  if (size <= MAX_READ_BYTES) return { bytes: await file.bytes(), partial: false };
  const handle = file.open(FileMode.ReadOnly);
  try {
    return { bytes: handle.readBytes(MAX_READ_BYTES), partial: true };
  } finally {
    handle.close();
  }
}

/** Copies a phone file into the app (so it survives) and returns it as a chat attachment. */
async function toAttachment(file: File, name: string, size: number): Promise<Attachment> {
  const dir = new Directory(Paths.document, 'attachments');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${uid()}-${name.replace(/[^\w.-]+/g, '_')}`);
  await file.copy(dest);
  const mimeType = (file.type || mimeOf(name) || 'application/octet-stream').split(';')[0];
  return { id: uid(), kind: mimeType.startsWith('image/') ? 'image' : 'file', name, mimeType, uri: dest.uri, size, origin: 'assistant' };
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

/** Opens the folder and counts what's in it (Connections shows this). */
export function checkPhoneFolder(folder: PhoneFolder): { ok: true; items: number } | { ok: false; error: string } {
  try {
    const root = openRoot(folder);
    return { ok: true, items: root.list().length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Shows the system folder picker. Null if the user cancelled. */
export async function pickPhoneFolder(): Promise<PhoneFolder | null> {
  try {
    const dir = await Directory.pickDirectoryAsync();
    if (!dir?.uri) return null;
    return { uri: dir.uri, name: folderName(dir.uri), source: 'picked' };
  } catch (e) {
    if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
}

/** iOS: TryChat's own folder, which the user sees in Files → On My iPhone → TryChat. */
export function appPhoneFolder(): PhoneFolder {
  return { uri: Paths.document.uri, name: 'TryChat', source: 'app' };
}

/** Tools for the folder on this phone the user shared with the app. */
export function phoneTools(ctx: ToolContext): Record<string, ToolDef> {
  const folder = ctx.settings.phoneFolder;
  if (!folder || !phoneFolderSupported()) return {};
  const where = `the folder “${folder.name}” on the user's phone`;
  const tools: Record<string, Omit<ToolDef, 'service'>> = {
    'phone.list': {
      kind: 'read',
      description: `List what's in ${where}, which they shared with you. Paths are relative to that folder.`,
      params: '{"path":"optional/subfolder"}',
      label: (a: Args) => `Listed ${a.path || folder.name} on your phone`,
      run: async (_c, a) => {
        const root = openRoot(folder);
        const { child, path } = locate(folder, root, a.path);
        if (child && !child.isDir) return `${path} is a file (${formatBytes(sizeOf(child.entry as File))}). Read it with phone.read.`;
        return describeList(child ? (child.entry as Directory) : root, root, path, folder);
      },
    },
    'phone.read': {
      kind: 'read',
      description: `Read a text file from ${where}. Long files come in pages of whole lines (continue with "offset", a line number). Binary files (photos, PDFs…) can't be read as text; "send": true puts any file into the chat for the user.`,
      params: '{"path":"notes/todo.md","offset":"optional start line","send":"optional true"}',
      label: (a: Args) => `${a.send === true ? 'Sent' : 'Read'} ${a.path ?? 'a file'} from your phone`,
      run: async (_c, a) => {
        if (!splitPath(a.path).length) throw new Error('Missing "path" — a file in the shared folder, like "notes/todo.md".');
        const root = openRoot(folder);
        const { child, path } = locate(folder, root, a.path);
        if (!child || child.isDir) return `“${path}” is a folder.\n${describeList((child?.entry ?? root) as Directory, root, path, folder)}`;
        const file = child.entry as File;
        const size = sizeOf(file);
        if (a.send === true) {
          if (size > MAX_SEND_BYTES) throw new Error(`${path} is ${formatBytes(size)}; files over ${formatBytes(MAX_SEND_BYTES)} can't be sent in the chat.`);
          return withFiles(`Sent ${path} (${formatBytes(size)}) to the chat.`, [await toAttachment(file, child.name, size)]);
        }
        const binary = () =>
          `${path} is a binary file (${file.type || mimeOf(child.name) || 'unknown type'}, ${formatBytes(size)}), so it can't be read as text. ` +
          'To show it to the user in the chat, call phone.read again with "send": true.';
        if (hasBinaryExtension(child.name)) return binary();
        const { bytes, partial } = await readBytes(file, size);
        if (looksBinary(child.name, bytes)) return binary();
        const text = decodeText(bytes);
        const page = textPage(`Phone: ${path}`, size, text, a.offset, a.limit);
        return partial ? `${page}\n…[only the first ${formatBytes(MAX_READ_BYTES)} of this file can be read]` : page;
      },
    },
    'phone.write': {
      kind: 'write',
      description: `Create or overwrite a text file in ${where} (missing folders are created). "append": true adds to the end instead.`,
      params: '{"path":"notes/todo.md","content":"full file text","append":"optional true"}',
      label: (a: Args) => `${a.append === true ? 'Add to' : 'Write'} ${a.path ?? 'a file'} on your phone`,
      run: async (_c, a) => {
        if (typeof a.content !== 'string') throw new Error('Missing "content" — the full file text as a string ("" for an empty file).');
        const bytes = new TextEncoder().encode(a.content);
        if (bytes.length > MAX_WRITE_BYTES) throw new Error(`That's ${formatBytes(bytes.length)}; files written here can be at most ${formatBytes(MAX_WRITE_BYTES)}.`);
        const root = openRoot(folder);
        const segs = relative(splitPath(a.path), folder, children(root, root));
        if (!segs.length) throw new Error('Missing "path" — the file to write, like "notes/todo.md".');
        let dir = root;
        for (const seg of segs.slice(0, -1)) {
          const found = findChild(children(dir, root), seg);
          if (found && !found.isDir) throw new Error(`${seg} is a file, not a folder.`);
          dir = found ? (found.entry as Directory) : dir.createDirectory(seg);
        }
        const name = segs[segs.length - 1];
        const path = segs.join('/');
        const existing = findChild(children(dir, root), name);
        if (existing?.isDir) throw new Error(`${path} is a folder; give a file path.`);
        if (existing && a.append === true) {
          (existing.entry as File).write(a.content, { append: true });
          return `Added ${formatBytes(bytes.length)} to ${path}.`;
        }
        // octet-stream keeps the exact name on Android (a text/plain file named "x.md" would become "x.md.txt").
        let file = existing ? (existing.entry as File) : dir.createFile(name, 'application/octet-stream');
        file.write(a.content);
        if (existing && sizeOf(file) !== bytes.length) {
          // Some document providers don't truncate on overwrite; replace the file instead.
          file.delete();
          file = dir.createFile(existing.name, 'application/octet-stream');
          file.write(a.content);
        }
        return `${existing ? 'Replaced' : 'Created'} ${path} (${formatBytes(bytes.length)}) in “${folder.name}”.`;
      },
    },
    'phone.search': {
      kind: 'read',
      description: `Find files and folders by name in ${where} (case-insensitive; * wildcards work).`,
      params: '{"query":"invoice","path":"optional/subfolder"}',
      label: (a: Args) => `Searched your phone folder for “${a.query ?? ''}”`,
      run: async (_c, a) => {
        const query = typeof a.query === 'string' ? a.query.trim().toLowerCase() : '';
        if (!query) throw new Error('Missing "query" — part of the file name to look for.');
        const pattern = query.includes('*') || query.includes('?')
          ? new RegExp(`^${query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
          : null;
        const matches = (name: string) => (pattern ? pattern.test(name.toLowerCase()) : name.toLowerCase().includes(query));
        const root = openRoot(folder);
        const start = locate(folder, root, a.path);
        if (start.child && !start.child.isDir) throw new Error(`${start.path} is a file, not a folder.`);
        const queue: { dir: Directory; path: string; depth: number }[] = [
          { dir: (start.child?.entry as Directory) ?? root, path: start.path, depth: 0 },
        ];
        const found: string[] = [];
        let visited = 0;
        let stopped = '';
        const deadline = Date.now() + 8000;
        while (queue.length) {
          if (visited >= 3000 || Date.now() > deadline) {
            stopped = `Stopped after looking at ${visited} items; narrow it down with "path".`;
            break;
          }
          const { dir, path, depth } = queue.shift()!;
          let list: Child[];
          try {
            list = children(dir, root);
          } catch {
            continue;
          }
          for (const c of list) {
            visited++;
            const p = join(path, c.name);
            if (matches(c.name) && found.length < 100) found.push(c.isDir ? `${p}/` : `${p} · ${formatBytes(sizeOf(c.entry as File))}`);
            if (c.isDir && depth < 10 && !/^(\.git|node_modules|\.thumbnails|\.Trash.*)$/i.test(c.name)) {
              queue.push({ dir: c.entry as Directory, path: p, depth: depth + 1 });
            }
          }
          await yieldToUi();
        }
        const head = found.length ? `${found.length}${found.length === 100 ? '+' : ''} match${found.length === 1 ? '' : 'es'} for “${query}”:` : `Nothing named like “${query}” in “${folder.name}”.`;
        return [head, ...found, stopped].filter(Boolean).join('\n');
      },
    },
  };
  return Object.fromEntries(Object.entries(tools).map(([n, t]) => [n, { ...t, service: 'phone' as const }]));
}
