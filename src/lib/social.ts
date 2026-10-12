import type { Account, Attachment, Friend, SharedFile } from './types';

/** Client for friends and shared files on the account server (server/trychat-server.mjs). */

export async function listFriends(_account: Account): Promise<Friend[]> {
  return [];
}

/** Shares a local file with friends (uploads it once). */
export async function shareFile(_account: Account, _file: Attachment, _friendIds: string[], _note?: string): Promise<SharedFile> {
  throw new Error('Sharing isn’t available yet.');
}

/** Files friends shared with me, and files I shared. */
export async function listShared(_account: Account): Promise<{ received: SharedFile[]; sent: SharedFile[] }> {
  return { received: [], sent: [] };
}
