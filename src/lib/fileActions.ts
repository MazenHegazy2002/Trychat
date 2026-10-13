import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { readFileText } from './fileTools';
import type { Attachment } from './types';

/** What the user can do with a file sent in a chat: open with another app, share, save to the device, copy text. */

export function fileOnDevice(a: Pick<Attachment, 'uri'>): boolean {
  try {
    return new File(a.uri).exists;
  } catch {
    return false;
  }
}

function ensureOnDevice(a: Attachment) {
  if (!fileOnDevice(a)) throw new Error('This file isn’t on this device (it was sent on another device or deleted).');
}

/** The system share sheet (AirDrop, messages, mail, Drive, “Save to Files” on iOS…). */
export async function shareFile(a: Attachment, dialogTitle = `Share ${a.name}`): Promise<void> {
  ensureOnDevice(a);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.');
  await Sharing.shareAsync(a.uri, { mimeType: a.mimeType, dialogTitle });
}

/**
 * Opens the file in another app. expo-sharing hands Android a content:// URI with read permission
 * (a plain file:// link can't be opened by other apps), so the chooser lists PDF readers, Docs, Sheets…
 * iOS shows the share sheet, whose app row opens it in Files, Books, Numbers and so on.
 */
export function openWithApp(a: Attachment): Promise<void> {
  return shareFile(a, `Open ${a.name} with`);
}

let lastDirectory: string | undefined;

/**
 * Saves a copy outside the app. Android: pick a folder (Downloads, Documents…) with the system picker
 * and the file is written there. iOS: the share sheet's “Save to Files” / “Save Image”.
 * Returns a confirmation message, or null if the user cancelled.
 */
export async function saveToDevice(a: Attachment): Promise<string | null> {
  ensureOnDevice(a);
  if (Platform.OS !== 'android') {
    await shareFile(a, `Save ${a.name}`);
    return null;
  }
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync(lastDirectory);
  } catch (e) {
    if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
  lastDirectory = dir.uri;
  const bytes = await new File(a.uri).bytes();
  const out = dir.createFile(a.name, a.mimeType || 'application/octet-stream');
  out.write(bytes);
  return `Saved ${out.name || a.name} to ${decodeURIComponent(dir.uri.split('%3A').pop() ?? dir.name ?? 'the folder')}.`;
}

export async function copyFileText(a: Attachment): Promise<boolean> {
  const text = await readFileText(a);
  if (text === null) return false;
  await Clipboard.setStringAsync(text);
  return true;
}

/** A copy of a library file to attach to a message (deleting that chat later deletes only the copy). */
export async function copyForAttachment(a: Attachment): Promise<Attachment> {
  ensureOnDevice(a);
  const dir = new Directory(Paths.document, 'attachments');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${Date.now().toString(36)}-${a.name.replace(/[^\w.-]+/g, '_')}`);
  await new File(a.uri).copy(dest);
  const text = a.kind === 'file' && a.size <= 200_000 ? await readFileText(a) : null;
  return { ...a, uri: dest.uri, ...(text !== null ? { text } : {}) };
}
