import type { Attachment } from './types';

/** Pure helpers for files sent in chats: MIME types, safe names, size limits. No native imports (tested in Node). */

/** Largest file the assistant may send (and code may save) in one go. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Text files up to this size are read back for "Copy text", the viewer and files.read. */
export const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  // documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  // text & code
  txt: 'text/plain',
  text: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/x-typescript',
  tsx: 'text/x-typescript',
  json: 'application/json',
  jsonl: 'application/jsonl',
  geojson: 'application/geo+json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  ini: 'text/plain',
  env: 'text/plain',
  py: 'text/x-python',
  rb: 'text/x-ruby',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java',
  kt: 'text/x-kotlin',
  swift: 'text/x-swift',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  hpp: 'text/x-c++',
  cs: 'text/x-csharp',
  php: 'text/x-php',
  sh: 'application/x-sh',
  bash: 'application/x-sh',
  zsh: 'application/x-sh',
  sql: 'application/sql',
  graphql: 'application/graphql',
  vue: 'text/plain',
  svelte: 'text/plain',
  dart: 'text/plain',
  lua: 'text/x-lua',
  r: 'text/plain',
  ics: 'text/calendar',
  vcf: 'text/vcard',
  srt: 'text/plain',
  vtt: 'text/vtt',
  // archives
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  // audio & video
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  mid: 'audio/midi',
  midi: 'audio/midi',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // fonts & misc
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  apk: 'application/vnd.android.package-archive',
  bin: 'application/octet-stream',
};

/** Preferred extension for a MIME type (first match wins, so list the canonical one first). */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/x-javascript': 'js',
  'text/x-typescript': 'ts',
  'application/yaml': 'yaml',
  'text/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'text/x-c': 'c',
  'text/x-c++': 'cpp',
  'application/x-sh': 'sh',
  'application/gzip': 'gz',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/midi': 'mid',
  'video/mp4': 'mp4',
  'application/octet-stream': 'bin',
  'text/xml': 'xml',
  'application/x-zip-compressed': 'zip',
};
for (const [ext, mime] of Object.entries(MIME_BY_EXT)) if (!EXT_BY_MIME[mime]) EXT_BY_MIME[mime] = ext;

const TEXT_MIME = /^text\/|[/+](json|xml|javascript|yaml|toml|csv|sql|graphql|jsonl|x-sh)$|^application\/(x-)?(sh|ecmascript)$/;

/** Raster formats React Native's <Image> can show; everything else (incl. SVG) is a file card. */
const INLINE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/heic', 'image/heif', 'image/avif']);

/** Lower-case extension without the dot ("" if none). */
export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Normalises "Image/PNG; charset=x" → "image/png"; '' for junk. */
export function cleanMime(mime?: string | null): string {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(m) ? m : '';
}

export function mimeFromName(name: string): string {
  return MIME_BY_EXT[extOf(name)] ?? 'application/octet-stream';
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[cleanMime(mime)] ?? '';
}

/** The given MIME type if it's meaningful, else one guessed from the file name. */
export function resolveMime(name: string, mime?: string | null): string {
  const m = cleanMime(mime);
  const guessed = mimeFromName(name);
  if (!m || m === 'application/octet-stream' || m === 'binary/octet-stream') return guessed;
  // Servers often say text/plain for code or Markdown; the extension is more precise.
  if (m === 'text/plain' && guessed !== 'application/octet-stream' && isTextLike(name, guessed)) return guessed;
  return m;
}

export function isTextLike(name: string, mime?: string | null): boolean {
  const m = cleanMime(mime);
  if (m && TEXT_MIME.test(m)) return true;
  if (m === 'image/svg+xml') return true;
  return TEXT_MIME.test(MIME_BY_EXT[extOf(name)] ?? '');
}

export function kindFor(mime: string): Attachment['kind'] {
  return INLINE_IMAGE.has(cleanMime(mime)) ? 'image' : 'file';
}

const MAX_NAME_CHARS = 120;

/**
 * A safe file name: no folders, control or reserved characters, no leading dots, sensible length,
 * and an extension that matches the MIME type when the name has none. Keeps non-Latin letters.
 */
export function sanitizeFileName(raw: string, mime?: string | null): string {
  let name = String(raw ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s+\.(?=[^.]*$)/, '.');
  if (!name) name = 'file';
  let ext = extOf(name);
  const wanted = extForMime(mime ?? '');
  if (!ext && wanted) {
    name = `${name}.${wanted}`;
    ext = wanted;
  }
  if (name.length > MAX_NAME_CHARS) {
    const keep = ext ? ext.length + 1 : 0;
    name = name.slice(0, MAX_NAME_CHARS - keep).trimEnd() + (ext ? `.${ext}` : '');
  }
  return name;
}

/** Bytes that a base64 string decodes to (ignores whitespace and padding). */
export function base64Size(b64: string): number {
  const s = b64.replace(/[\s]/g, '');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

/** Splits "data:image/png;base64,AAAA" into its parts; plain base64 passes through. Throws on invalid base64. */
export function parseBase64(input: string): { base64: string; mimeType?: string } {
  let s = String(input ?? '').trim();
  let mimeType: string | undefined;
  const m = s.match(/^data:([^;,]*)(;[^,]*)?,/);
  if (m) {
    if (!/;base64/i.test(m[2] ?? '')) throw new Error('Only base64 data URLs are supported (data:…;base64,…).');
    mimeType = cleanMime(m[1]) || undefined;
    s = s.slice(m[0].length);
  }
  s = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!s) throw new Error('base64 is empty.');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) throw new Error('base64 is not valid base64.');
  if (s.length % 4) s += '='.repeat(4 - (s.length % 4));
  return { base64: s, mimeType };
}

export function assertSize(bytes: number, what = 'File'): void {
  if (bytes > MAX_FILE_BYTES) {
    throw new Error(`${what} is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
}

/** Short human type, e.g. "PDF", "PNG image", "Word document". */
export function typeLabel(name: string, mime: string): string {
  const m = cleanMime(mime);
  const ext = extOf(name).toUpperCase();
  if (m === 'application/pdf') return 'PDF';
  if (m === 'image/svg+xml') return 'SVG image';
  if (m.startsWith('image/')) return `${ext || m.slice(6).toUpperCase()} image`;
  if (m.startsWith('audio/')) return `${ext || 'Audio'} audio`;
  if (m.startsWith('video/')) return `${ext || 'Video'} video`;
  if (/wordprocessing|msword|opendocument\.text|rtf/.test(m)) return 'Word document';
  if (/spreadsheet|ms-excel/.test(m)) return 'Spreadsheet';
  if (/presentation|powerpoint/.test(m)) return 'Presentation';
  if (m === 'text/csv') return 'CSV';
  if (m === 'text/markdown') return 'Markdown';
  if (m === 'text/html') return 'HTML';
  if (m === 'application/json') return 'JSON';
  if (/zip|gzip|tar|7z|rar/.test(m)) return `${ext || 'Archive'} archive`;
  if (isTextLike(name, m)) return ext ? `${ext} file` : 'Text';
  return ext ? `${ext} file` : 'File';
}

export type FileGroup = 'image' | 'pdf' | 'text' | 'code' | 'sheet' | 'doc' | 'slides' | 'archive' | 'audio' | 'video' | 'other';

/** Rough family of a file, for icons and filters. */
export function fileGroup(name: string, mime: string): FileGroup {
  const m = cleanMime(mime);
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (/spreadsheet|ms-excel|text\/csv|tab-separated/.test(m)) return 'sheet';
  if (/presentation|powerpoint/.test(m)) return 'slides';
  if (/wordprocessing|msword|opendocument\.text|rtf|epub/.test(m)) return 'doc';
  if (/zip|gzip|tar|7z|rar/.test(m)) return 'archive';
  if (m === 'text/plain' || m === 'text/markdown') return 'text';
  if (isTextLike(name, m)) return 'code';
  return 'other';
}
