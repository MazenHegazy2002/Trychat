import { listLibrary } from './library';
import { downloadShared, listFriends, listShared, resolveFriends, shareFile, shareUploaded } from './social';
import type { ToolContext, ToolDef } from './tools';
import { withFiles } from './toolResult';
import type { Account, SharedFile } from './types';

/** Tools for friends and files shared between signed-in friends. */

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const who = (p: { name: string; email: string }) => (p.name ? `${p.name} <${p.email}>` : p.email);

function describe(f: SharedFile, sent: boolean) {
  const to = sent ? ` → ${(f.recipients ?? []).map((r) => r.name || r.email).join(', ') || 'nobody yet'}` : ` from ${who(f.owner)}`;
  return `- ${f.name} (id ${f.id}, ${f.mimeType}, ${size(f.size)})${to}${f.note ? ` — note: “${f.note}”` : ''}`;
}

function needAccount(ctx: ToolContext): Account {
  if (!ctx.account) throw new Error('The user is not signed in to a TryChat account.');
  return ctx.account;
}

export function socialTools(ctx: ToolContext): Record<string, ToolDef> {
  if (!ctx.account) return {};
  return {
    'friends.list': {
      service: 'friends',
      kind: 'read',
      description: "List the user's friends (people on their TryChat account server they can send files to) and pending friend requests.",
      params: '{}',
      label: () => 'Listed your friends',
      run: async (c) => {
        const friends = await listFriends(needAccount(c));
        if (!friends.length) return 'No friends yet. The user can add friends by email in Settings → Friends.';
        const group = (s: string) => friends.filter((f) => f.status === s).map((f) => `- ${who(f)}`);
        return [
          `Friends:\n${group('friends').join('\n') || '(none)'}`,
          group('incoming').length ? `Requests waiting for the user to accept:\n${group('incoming').join('\n')}` : '',
          group('outgoing').length ? `Requests the user sent:\n${group('outgoing').join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
      },
    },
    'shared.list': {
      service: 'friends',
      kind: 'read',
      description: 'List files friends shared with the user ("received") and files the user shared ("sent"), with their ids.',
      params: '{}',
      label: () => 'Listed shared files',
      run: async (c) => {
        const { received, sent } = await listShared(needAccount(c));
        return `Shared with the user:\n${received.map((f) => describe(f, false)).join('\n') || '(none)'}\n\nShared by the user:\n${
          sent.map((f) => describe(f, true)).join('\n') || '(none)'
        }`;
      },
    },
    'shared.read': {
      service: 'friends',
      kind: 'read',
      description: 'Download a shared file (id from shared.list) to the phone, show it to the user in the chat, and get its text if it is a text file.',
      params: '{"id":"shared file id"}',
      label: (a) => `Opened shared file ${a.name ?? a.id ?? ''}`.trim(),
      run: async (c, a) => {
        const account = needAccount(c);
        const { received, sent } = await listShared(account);
        const file = [...received, ...sent].find((f) => f.id === a.id || f.name === a.id || f.name === a.name);
        if (!file) throw new Error(`No shared file with id "${a.id}". Use shared.list to see the ids.`);
        const attachment = await downloadShared(account, file);
        const head = `${file.name} (${file.mimeType}, ${size(file.size)}) from ${who(file.owner)}${file.note ? ` — note: “${file.note}”` : ''}.`;
        return withFiles(
          attachment.text !== undefined
            ? `${head}\n\n${attachment.text}`
            : `${head} It isn't a text file; it is now shown to the user in the chat and saved in their Files.`,
          [attachment],
        );
      },
    },
    'shared.send': {
      service: 'friends',
      kind: 'write',
      description:
        'Send a file to one or more friends. Pick the file by "fileId" (a Files library id), "name" (a file name in the Files library) or "sharedId" (a file the user already shared, from shared.list); "friends" are friend names or emails from friends.list.',
      params: '{"fileId":"library file id","name":"or file name","sharedId":"or shared file id","friends":["name or email"],"note":"optional message"}',
      label: (a) => {
        const list = Array.isArray(a.friends) ? a.friends.join(', ') : String(a.friends ?? '');
        return `Send ${a.name || a.fileId || a.libraryId || a.sharedId || 'a file'} to ${list || 'friends'}`;
      },
      run: async (c, a) => {
        const account = needAccount(c);
        const wanted: string[] = Array.isArray(a.friends) ? a.friends.map(String) : a.friends ? [String(a.friends)] : [];
        if (!wanted.length) throw new Error('Say which friends to send it to: {"friends":["name or email"]}.');
        const friends = await listFriends(account);
        const { found, missing } = resolveFriends(friends, wanted);
        if (missing.length) {
          const names = friends.filter((f) => f.status === 'friends').map(who);
          throw new Error(`Not friends with (or ambiguous): ${missing.join(', ')}. Friends: ${names.join(', ') || 'none yet'}.`);
        }
        const ids = found.map((f) => f.id);
        const note = a.note ? String(a.note) : undefined;
        const to = found.map((f) => f.name || f.email).join(', ');
        if (a.sharedId) {
          const file = await shareUploaded(account, String(a.sharedId), ids, note);
          return `Sent ${file.name} to ${to}.`;
        }
        const id = String(a.fileId ?? a.libraryId ?? '');
        const name = String(a.name ?? '').toLowerCase();
        const library = await listLibrary();
        const file = library.find((f) => (id && f.id === id) || (name && f.name.toLowerCase() === name));
        if (!file) throw new Error(`No file "${id || a.name}" in the Files library.`);
        await shareFile(account, file, ids, note);
        return `Sent ${file.name} (${size(file.size)}) to ${to}.`;
      },
    },
  };
}
