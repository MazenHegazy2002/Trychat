import { Directory, File, Paths, UploadType } from 'expo-file-system';

import { addToLibrary } from './library';
import type { Account, Attachment, Friend, SharedFile } from './types';

/** Client for friends and shared files on the account server (server/trychat-server.mjs). */

export type Progress = (fraction: number) => void;

const MAX_TEXT_BYTES = 200_000;
const TEXT_EXTENSIONS = new Set(
  'txt md markdown csv tsv json jsonl xml yaml yml toml ini log html htm css js jsx ts tsx mjs cjs py rb go rs java kt swift c h cpp hpp cs php sh sql graphql vue svelte dart lua r'.split(' '),
);

export function isTextLike(name: string, mime?: string) {
  if (mime && (mime.startsWith('text/') || /json|xml|javascript|yaml|csv|x-sh|sql/.test(mime))) return true;
  return TEXT_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() ?? '');
}

/** Safe local file name (the server sanitizes too; this keeps the app's own folder tidy). */
const safeName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? '').replace(/[^\w.\- ()]+/g, '_').replace(/^[.\s]+/, '').slice(0, 100) || 'file';

const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

function friendlyError(status: number, message?: string): Error {
  if (status === 401) return Object.assign(new Error('Please sign in to your account again.'), { status });
  if (status === 404 && (!message || message === 'Not found')) {
    return Object.assign(new Error('Your account server doesn’t support friends yet — update server/trychat-server.mjs.'), { status });
  }
  return Object.assign(new Error(message || `Server error ${status}`), { status });
}

async function api<T>(account: Account, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(account.serverUrl + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...auth(account), ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new Error('Couldn’t reach your account server. Check your connection.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw friendlyError(res.status, json?.error);
  return json as T;
}

// ---------- Friends ----------

export async function listFriends(account: Account): Promise<Friend[]> {
  return (await api<{ friends: Friend[] }>(account, '/friends')).friends;
}

/** Sends a friend request (or accepts theirs, if they already asked). Returns the updated list. */
export async function requestFriend(account: Account, email: string): Promise<Friend[]> {
  return (await api<{ friends: Friend[] }>(account, '/friends/request', { body: { email: email.trim() } })).friends;
}

export async function acceptFriend(account: Account, id: string): Promise<Friend[]> {
  return (await api<{ friends: Friend[] }>(account, '/friends/accept', { body: { id } })).friends;
}

/** Declines an incoming request, or cancels one you sent. */
export async function declineFriend(account: Account, id: string): Promise<Friend[]> {
  return (await api<{ friends: Friend[] }>(account, '/friends/decline', { body: { id } })).friends;
}

/** Unfriends; files you shared with each other stop being shared. */
export async function removeFriend(account: Account, id: string): Promise<Friend[]> {
  return (await api<{ friends: Friend[] }>(account, '/friends/remove', { body: { id } })).friends;
}

// ---------- Shared files ----------

/** Files friends shared with me, and files I shared. */
export async function listShared(account: Account): Promise<{ received: SharedFile[]; sent: SharedFile[] }> {
  return api(account, '/shared');
}

/** Identifies a local file so sharing it again reuses the earlier upload. */
function keyOf(local: File, file: Attachment, size: number) {
  let md5: string | null = null;
  try {
    md5 = local.md5;
  } catch {
    md5 = null;
  }
  return md5 ? `md5:${md5}:${size}` : `id:${file.id}:${size}`;
}

async function upload(account: Account, local: File, file: Attachment, key: string, onProgress?: Progress): Promise<SharedFile> {
  const mimeType = file.mimeType || 'application/octet-stream';
  const headers = { ...auth(account), 'X-File-Name': encodeURIComponent(file.name), 'X-File-Key': key, 'Content-Type': mimeType };
  let status: number;
  let body: string;
  try {
    if (typeof local.upload === 'function') {
      const res = await local.upload(`${account.serverUrl}/files`, {
        httpMethod: 'POST',
        uploadType: UploadType.BINARY_CONTENT,
        mimeType,
        headers,
        onProgress: ({ bytesSent, totalBytes }) => onProgress?.(totalBytes > 0 ? Math.min(1, bytesSent / totalBytes) : 0),
      });
      status = res.status;
      body = res.body;
    } else {
      // Web: no native upload task.
      const res = await fetch(`${account.serverUrl}/files`, { method: 'POST', headers, body: (await local.bytes()) as any });
      status = res.status;
      body = await res.text();
    }
  } catch (e) {
    throw new Error(`Couldn’t upload ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let json: any = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  if (status < 200 || status >= 300) throw friendlyError(status, json?.error);
  onProgress?.(1);
  return json.file as SharedFile;
}

/** Shares already-uploaded file `id` (one of mine) with more friends. */
export async function shareUploaded(account: Account, id: string, friendIds: string[], note?: string): Promise<SharedFile> {
  return (await api<{ file: SharedFile }>(account, `/files/${encodeURIComponent(id)}/share`, { body: { friendIds, note } })).file;
}

/** Shares a local file with friends. It is uploaded once; sharing the same file again reuses that upload. */
export async function shareFile(
  account: Account,
  file: Attachment,
  friendIds: string[],
  note?: string,
  onProgress?: Progress,
): Promise<SharedFile> {
  if (!friendIds.length) throw new Error('Pick at least one friend.');
  const local = new File(file.uri);
  if (!local.exists) throw new Error(`${file.name} isn’t on this device any more.`);
  const size = local.size ?? file.size;
  const key = keyOf(local, file, size);
  const { sent } = await listShared(account);
  let shared = sent.find((s) => s.key === key && s.size === size);
  const fresh = !shared;
  if (!shared) shared = await upload(account, local, file, key, onProgress);
  else onProgress?.(1);
  try {
    return await shareUploaded(account, shared.id, friendIds, note);
  } catch (e) {
    // Don't leave an upload nobody can see.
    if (fresh && !shared.sharedWith.length) await deleteSharedFile(account, shared.id).catch(() => {});
    throw e;
  }
}

/** Owner: stop sharing with some friends (all when omitted; the file is then deleted). Recipient: remove it from my list. */
export async function unshareFile(account: Account, id: string, friendIds?: string[]): Promise<{ deleted: boolean }> {
  return api(account, `/files/${encodeURIComponent(id)}/unshare`, { body: friendIds ? { friendIds } : {} });
}

export async function deleteSharedFile(account: Account, id: string): Promise<void> {
  await api(account, `/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function sharedDir(): Directory {
  const dir = new Directory(Paths.document, 'files');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

const localFileFor = (file: SharedFile) => new File(sharedDir(), `${safeName(file.id)}-${safeName(file.name)}`);

function toAttachment(file: SharedFile, local: File, text?: string): Attachment {
  return {
    id: `shared-${file.id}`,
    kind: file.mimeType.startsWith('image/') ? 'image' : 'file',
    name: file.name,
    mimeType: file.mimeType,
    uri: local.uri,
    size: local.size ?? file.size,
    text,
    origin: 'shared',
  };
}

/** The copy on this device, if this shared file was downloaded before. */
export function localCopy(file: SharedFile): Attachment | null {
  try {
    const local = localFileFor(file);
    return local.exists && local.size === file.size ? toAttachment(file, local) : null;
  } catch {
    return null;
  }
}

/** Downloads a shared file into the app's files folder (once) and adds it to the Files library. */
export async function downloadShared(account: Account, file: SharedFile, onProgress?: Progress): Promise<Attachment> {
  const local = localFileFor(file);
  const fresh = !(local.exists && local.size === file.size);
  if (fresh) {
    if (local.exists) local.delete();
    try {
      await File.downloadFileAsync(`${account.serverUrl}/files/${encodeURIComponent(file.id)}`, local, {
        headers: auth(account),
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => onProgress?.(totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : 0),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/\b404\b/.test(msg)) throw new Error(`${file.name} is no longer shared with you.`);
      if (/\b401\b/.test(msg)) throw new Error('Please sign in to your account again.');
      throw new Error(`Couldn’t download ${file.name}: ${msg}`);
    }
  }
  onProgress?.(1);
  let text: string | undefined;
  if (isTextLike(file.name, file.mimeType) && file.size <= MAX_TEXT_BYTES) text = await local.text().catch(() => undefined);
  const attachment = toAttachment(file, local, text);
  if (fresh) await addToLibrary(attachment).catch(() => undefined);
  return attachment;
}

/** Matches friend names or emails typed by a person or the model to accepted friends. */
export function resolveFriends(friends: Friend[], wanted: string[]): { found: Friend[]; missing: string[] } {
  const accepted = friends.filter((f) => f.status === 'friends');
  const found: Friend[] = [];
  const missing: string[] = [];
  for (const raw of wanted) {
    const q = String(raw).trim().toLowerCase();
    const exact = accepted.filter((f) => f.email === q || f.id === raw || f.name.toLowerCase() === q);
    const loose = exact.length ? exact : accepted.filter((f) => f.name.toLowerCase().includes(q) || f.email.startsWith(q));
    if (q && loose.length === 1) found.push(loose[0]);
    else missing.push(String(raw));
  }
  return { found: [...new Map(found.map((f) => [f.id, f])).values()], missing };
}
