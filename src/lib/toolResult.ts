import type { Attachment } from './types';

export const FILES = '__trychatFiles';

/** Return this from a tool's run() to also send files to the user (shown in the chat under the tool card). */
export function withFiles(text: string, files: Attachment[]) {
  return { [FILES]: true, text, files };
}
