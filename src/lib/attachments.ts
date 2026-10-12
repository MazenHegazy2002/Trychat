import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { ApiContentPart } from './api';
import { uid } from './id';
import type { Attachment, ChatMessage } from './types';

/**
 * Photos, camera shots and files attached to messages. Files are copied into the app's
 * documents folder so they survive cache clean-ups; images are downscaled to keep requests small.
 */

const MAX_IMAGE_SIDE = 1600;
const MAX_TEXT_BYTES = 200_000;
/** Only the most recent images are re-sent to the model, to keep requests small. */
const MAX_IMAGES_IN_CONTEXT = 6;

const TEXT_EXTENSIONS = new Set(
  'txt md markdown csv tsv json jsonl xml yaml yml toml ini env log html htm css scss js jsx ts tsx mjs cjs py rb go rs java kt swift c h cpp hpp cs php sh bash zsh sql graphql vue svelte dart lua r m pl ex exs'.split(' '),
);

function attachmentsDir(): Directory {
  const dir = new Directory(Paths.document, 'attachments');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

function isTextFile(name: string, mime?: string | null) {
  if (mime && (mime.startsWith('text/') || /json|xml|javascript|yaml|csv|x-sh|sql/.test(mime))) return true;
  return TEXT_EXTENSIONS.has(extOf(name));
}

async function keep(uri: string, name: string): Promise<File> {
  const dest = new File(attachmentsDir(), `${uid()}-${name.replace(/[^\w.-]+/g, '_')}`);
  await new File(uri).copy(dest);
  return dest;
}

async function imageAttachment(uri: string, width?: number, height?: number, name = 'photo.jpg'): Promise<Attachment> {
  let ctx = ImageManipulator.manipulate(uri);
  if ((width ?? 0) > MAX_IMAGE_SIDE || (height ?? 0) > MAX_IMAGE_SIDE) {
    ctx = ctx.resize((width ?? 0) >= (height ?? 0) ? { width: MAX_IMAGE_SIDE } : { height: MAX_IMAGE_SIDE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.75, format: SaveFormat.JPEG });
  const file = await keep(saved.uri, name.replace(/\.\w+$/, '') + '.jpg');
  return { id: uid(), kind: 'image', name, mimeType: 'image/jpeg', uri: file.uri, size: file.size ?? 0 };
}

export async function pickImages(): Promise<Attachment[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 6,
    quality: 1,
  });
  if (res.canceled) return [];
  return Promise.all(res.assets.map((a) => imageAttachment(a.uri, a.width, a.height, a.fileName ?? 'image.jpg')));
}

export async function takePhoto(): Promise<Attachment[]> {
  // On Android the system camera app takes the photo, so no permission is needed there.
  if (Platform.OS === 'ios') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission was denied. You can allow it in Settings.');
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (res.canceled) return [];
  const a = res.assets[0];
  return [await imageAttachment(a.uri, a.width, a.height, 'camera.jpg')];
}

export async function pickFiles(): Promise<Attachment[]> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return [];
  const out: Attachment[] = [];
  for (const a of res.assets) {
    if (a.mimeType?.startsWith('image/')) {
      out.push(await imageAttachment(a.uri, undefined, undefined, a.name));
      continue;
    }
    const file = await keep(a.uri, a.name);
    const size = a.size ?? file.size ?? 0;
    let text: string | undefined;
    if (isTextFile(a.name, a.mimeType) && size <= MAX_TEXT_BYTES) {
      try {
        text = await file.text();
      } catch {
        text = undefined;
      }
    }
    out.push({ id: uid(), kind: 'file', name: a.name, mimeType: a.mimeType ?? 'application/octet-stream', uri: file.uri, size, text });
  }
  return out;
}

export function deleteAttachmentFiles(attachments: Attachment[] = []) {
  for (const a of attachments) {
    try {
      const f = new File(a.uri);
      if (f.exists) f.delete();
    } catch {
      // already gone
    }
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Text the model sees for attached files (contents for text files, a note otherwise). */
function filesAsText(attachments: Attachment[]): string {
  return attachments
    .filter((a) => a.kind === 'file')
    .map((a) =>
      a.text !== undefined
        ? `\n\n[Attached file: ${a.name}]\n\`\`\`${extOf(a.name)}\n${a.text}\n\`\`\``
        : `\n\n[Attached file: ${a.name} (${a.mimeType}, ${formatSize(a.size)}) — its contents can't be read as text here.]`,
    )
    .join('');
}

/**
 * Turns messages with attachments into OpenAI-style content parts (text + image_url data URLs).
 * Images beyond the most recent few are replaced by a short note.
 */
export async function messageContent(
  history: ChatMessage[],
): Promise<Map<string, string | ApiContentPart[]>> {
  const result = new Map<string, string | ApiContentPart[]>();
  let imageBudget = MAX_IMAGES_IN_CONTEXT;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m.attachments?.length) continue;
    const text = (m.content || '') + filesAsText(m.attachments);
    const parts: ApiContentPart[] = [];
    const notes: string[] = [];
    for (const a of m.attachments.filter((x) => x.kind === 'image')) {
      const file = new File(a.uri);
      if (imageBudget > 0 && file.exists) {
        parts.push({ type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${await file.base64()}` } });
        imageBudget--;
      } else {
        notes.push(`[Image “${a.name}” was shared earlier${file.exists ? '' : ' on another device'}.]`);
      }
    }
    const fullText = [text, ...notes].filter(Boolean).join('\n');
    result.set(m.id, parts.length ? [{ type: 'text', text: fullText || 'See the attached image.' }, ...parts] : fullText);
  }
  return result;
}
