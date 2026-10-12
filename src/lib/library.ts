import type { Attachment } from './types';

/** A file in the Files library: everything sent, received or shared, kept on this device. */
export interface LibraryFile extends Attachment {
  addedAt: number;
  /** The chat it came from, if any. */
  conversationId?: string;
}

/** All library files, newest first. */
export async function listLibrary(): Promise<LibraryFile[]> {
  return [];
}

/** Adds a file (already copied to this device) to the library. */
export async function addToLibrary(file: Attachment, conversationId?: string): Promise<LibraryFile> {
  return { ...file, addedAt: Date.now(), conversationId };
}

/** Removes a file from the library and deletes its local copy. */
export async function removeFromLibrary(_id: string): Promise<void> {}
