import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

import {
  MAX_TEXT_PREVIEW_BYTES,
  assertSize,
  base64Size,
  cleanMime,
  isTextLike,
  kindFor,
  parseBase64,
  resolveMime,
  sanitizeFileName,
  typeLabel,
} from './fileKinds';
import { desktop } from './desktop';
import { uid } from './id';
import { listLibrary } from './library';
import type { LibraryFile } from './library';
import { PAGE_SIZES, printableHtml } from './printHtml';
import type { PageSize } from './printHtml';
import { canRunCode, runCodeWithFiles } from './runner';
import type { RunnerFile } from './runner';
import { withFiles } from './toolResult';
import type { Args, ToolContext, ToolDef } from './tools';
import type { Attachment, Settings } from './types';

/** Tools that create files (images, PDFs, any type) and send them to the user in the chat, and read the Files library. */

// ---------- Saving files on the device ----------

/** Each file gets its own folder (files/<id>/<name>) so it keeps a clean name when shared. */
function newFileTarget(name: string): { id: string; file: File } {
  const id = uid();
  const dir = new Directory(Paths.document, 'files', id);
  if (!dir.exists) dir.create({ intermediates: true });
  return { id, file: new File(dir, name) };
}

function attachment(id: string, file: File, name: string, mimeType: string, size: number): Attachment {
  return { id, kind: kindFor(mimeType), name, mimeType, uri: file.uri, size: size || file.size || 0, origin: 'assistant' };
}

function prepare(name: string, mimeType?: string | null) {
  const mime0 = cleanMime(mimeType) || resolveMime(String(name ?? ''));
  const safe = sanitizeFileName(name, mime0);
  return { name: safe, mime: resolveMime(safe, mimeType) };
}

export function saveText(name: string, text: string, mimeType?: string | null): Attachment {
  const { name: safe, mime } = prepare(name, mimeType ?? 'text/plain');
  const size = new TextEncoder().encode(text).length;
  assertSize(size);
  const { id, file } = newFileTarget(safe);
  file.write(text);
  return attachment(id, file, safe, mime, size);
}

export function saveBase64(name: string, base64: string, mimeType?: string | null): Attachment {
  const parsed = parseBase64(base64);
  const { name: safe, mime } = prepare(name, mimeType || parsed.mimeType);
  const size = base64Size(parsed.base64);
  assertSize(size);
  const { id, file } = newFileTarget(safe);
  file.write(parsed.base64, { encoding: 'base64' });
  return attachment(id, file, safe, mime, size);
}

export function saveBytes(name: string, bytes: Uint8Array, mimeType?: string | null): Attachment {
  assertSize(bytes.length);
  const { name: safe, mime } = prepare(name, mimeType);
  const { id, file } = newFileTarget(safe);
  file.write(bytes);
  return attachment(id, file, safe, mime, bytes.length);
}

/** Saves files that code.run produced with saveFile(). */
export function saveRunnerFiles(files: RunnerFile[]): Attachment[] {
  return files.map((f) => saveBase64(f.name, f.base64, f.mimeType || undefined));
}

/** Downloads a URL with a size limit. */
export async function fetchBytes(url: string, headers: Record<string, string> = {}): Promise<{ bytes: Uint8Array; mimeType: string; finalUrl: string }> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Download failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared) assertSize(declared, 'That download');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assertSize(bytes.length, 'That download');
  return { bytes, mimeType: cleanMime(res.headers.get('content-type')), finalUrl: res.url || url };
}

const encodePath = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');

/** URL and headers for a file's raw bytes on GitHub (API with a token, so private repos work; raw host otherwise). */
export function githubRawRequest(settings: Pick<Settings, 'githubToken'>, repo: string, path: string, ref?: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('fromGithub.repo must look like "owner/name".');
  if (!path) throw new Error('fromGithub.path is required.');
  if (settings.githubToken) {
    return {
      url: `https://api.github.com/repos/${repo}/contents/${encodePath(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
      headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${settings.githubToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
    };
  }
  return { url: `https://raw.githubusercontent.com/${repo}/${ref ? encodePath(ref) : 'HEAD'}/${encodePath(path)}`, headers: {} as Record<string, string> };
}

async function readFromLaptop(settings: Settings, path: string): Promise<{ text?: string; base64?: string }> {
  if (!settings.bridgeUrl || !settings.bridgeToken) throw new Error('The laptop isn’t connected (Settings → Connections).');
  const res = await fetch(settings.bridgeUrl.replace(/\/+$/, '') + '/read', {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.bridgeToken}`, 'Content-Type': 'application/json' },
    // A bridge that supports binary reads answers with `base64`; the current one sends text `content`.
    body: JSON.stringify({ path, encoding: 'base64' }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Laptop ${res.status}: ${json?.error ?? res.statusText}`);
  if (typeof json?.base64 === 'string') return { base64: json.base64 };
  return { text: String(json?.content ?? '') };
}

/** Text of a stored file, if it's a text file small enough to read. */
export async function readFileText(a: Pick<Attachment, 'uri' | 'name' | 'mimeType' | 'size' | 'text'>): Promise<string | null> {
  if (a.text !== undefined) return a.text;
  if (!isTextLike(a.name, a.mimeType) || a.size > MAX_TEXT_PREVIEW_BYTES) return null;
  try {
    const f = new File(a.uri);
    return f.exists ? await f.text() : null;
  } catch {
    return null;
  }
}

// ---------- PDF & image rendering ----------

async function makePdf(name: string, input: { html?: string; markdown?: string; pageSize?: PageSize }): Promise<Attachment> {
  const safe = sanitizeFileName(name.replace(/\.pdf$/i, '') + '.pdf', 'application/pdf');
  const html = printableHtml({ ...input, title: safe.replace(/\.pdf$/i, '') });
  const size = PAGE_SIZES[input.pageSize === 'a4' ? 'a4' : 'letter'];
  const margin = 50;
  if (Platform.OS === 'web') {
    // No expo-print PDFs on web; the desktop app prints with Chromium instead.
    if (!desktop) throw new Error('Making PDFs needs the TryChat app (phone or Mac). Offer the document as HTML or Markdown instead.');
    const bytes = await desktop.htmlToPdf(html, { width: size.width / 72, height: size.height / 72, margin: margin / 72 });
    assertSize(bytes.length, 'The PDF');
    const { id, file } = newFileTarget(safe);
    file.write(bytes);
    return attachment(id, file, safe, 'application/pdf', file.size ?? bytes.length);
  }
  const result = await Print.printToFileAsync({
    html,
    ...size,
    ...(Platform.OS === 'ios' ? { margins: { top: margin, bottom: margin, left: margin, right: margin } } : {}),
  });
  const printed = new File(result.uri);
  assertSize(printed.size ?? 0, 'The PDF');
  const { id, file } = newFileTarget(safe);
  printed.move(file);
  return attachment(id, file, safe, 'application/pdf', file.size ?? 0);
}

/** JavaScript for the hidden runner that draws an SVG onto a canvas and saves it as PNG. */
export function svgToPngCode(svg: string, name: string, opts: { width?: number; background?: string } = {}): string {
  return `
const doc = new DOMParser().parseFromString(${JSON.stringify(svg)}, 'image/svg+xml');
const root = doc.documentElement;
if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('That is not valid SVG.');
if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
const vb = (root.getAttribute('viewBox') || '').trim().split(/[\\s,]+/).map(Number);
const num = (v) => (v && !/%/.test(v) && parseFloat(v) > 0 ? parseFloat(v) : 0);
let w = num(root.getAttribute('width')), h = num(root.getAttribute('height'));
const ratio = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[3] / vb[2] : 0;
if (!w && !h) { w = vb.length === 4 && vb[2] > 0 ? vb[2] : 1024; h = ratio ? w * ratio : w; }
else if (!w) w = ratio ? h / ratio : h;
else if (!h) h = ratio ? w * ratio : w;
root.setAttribute('width', String(w)); root.setAttribute('height', String(h));
const longSide = Math.max(w, h);
const target = ${opts.width ? Number(opts.width) : 0} || Math.min(2048, Math.max(1024, longSide * 2));
const scale = Math.min(target, 4096) / longSide;
const img = new Image();
img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('The SVG could not be drawn.')); });
const canvas = document.createElement('canvas');
canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
const ctx = canvas.getContext('2d');
const bg = ${JSON.stringify(opts.background ?? 'white')};
if (bg && bg !== 'transparent') { ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
await saveFile(${JSON.stringify(name)}, canvas, 'image/png');
`;
}

async function makeImage(name: string, svg: string, opts: { width?: number; background?: string; format?: string }) {
  if (!/<svg[\s>]/i.test(svg ?? '')) throw new Error('svg must be an <svg>…</svg> document.');
  const base = String(name || 'image').replace(/\.(png|svg|jpe?g)$/i, '');
  if (opts.format !== 'svg' && canRunCode()) {
    try {
      const { files } = await runCodeWithFiles('javascript', svgToPngCode(svg, `${base}.png`, opts));
      if (files.length) return { file: saveBase64(files[0].name, files[0].base64, 'image/png'), note: '' };
    } catch (e) {
      return { file: saveText(`${base}.svg`, svg, 'image/svg+xml'), note: ` (PNG rendering failed: ${e instanceof Error ? e.message : e}; sent as SVG)` };
    }
  }
  return { file: saveText(`${base}.svg`, svg, 'image/svg+xml'), note: '' };
}

// ---------- Tools ----------

const describe = (a: Attachment) => `${a.name} (${typeLabel(a.name, a.mimeType)}, ${a.size < 1024 ? `${a.size} B` : `${Math.round(a.size / 1024)} KB`})`;
const sent = (a: Attachment, extra = '') => withFiles(`Sent ${describe(a)} to the user${extra}. It appears in the chat with Open, Share and Save buttons.`, [a]);

function findInLibrary(list: LibraryFile[], key: string): LibraryFile | undefined {
  const k = String(key ?? '').trim().toLowerCase();
  return list.find((f) => f.id === key) ?? list.find((f) => f.name.toLowerCase() === k) ?? list.find((f) => f.name.toLowerCase().includes(k));
}

async function send(ctx: ToolContext, a: Args) {
  const name = String(a.name ?? '').trim();
  if (a.fromLibrary) {
    const entry = findInLibrary(await listLibrary(), a.fromLibrary);
    if (!entry) throw new Error(`No file "${a.fromLibrary}" in the Files library. Use files.list.`);
    const { addedAt: _a, conversationId: _c, ...file } = entry;
    return sent(file);
  }
  if (a.fromGithub) {
    const g = a.fromGithub ?? {};
    const req = githubRawRequest(ctx.settings, g.repo, g.path, g.ref);
    const { bytes, mimeType } = await fetchBytes(req.url, req.headers);
    const fileName = name || String(g.path).split('/').pop() || 'file';
    return sent(saveBytes(fileName, bytes, a.mimeType || (mimeType === 'text/plain' ? undefined : mimeType)), ` from ${g.repo}`);
  }
  if (a.fromLaptop) {
    const path = String(a.fromLaptop);
    const fileName = name || path.split(/[\\/]/).pop() || 'file';
    const r = await readFromLaptop(ctx.settings, path);
    if (r.base64 !== undefined) return sent(saveBase64(fileName, r.base64, a.mimeType), ' from your laptop');
    if (!isTextLike(fileName, a.mimeType)) {
      throw new Error('The laptop bridge can only read text files, so this binary file can’t be sent. Ask the user to update the bridge, or send a text file.');
    }
    const truncated = /…\[truncated \d+ chars\]$/.test(r.text ?? '');
    return sent(saveText(fileName, r.text ?? '', a.mimeType), truncated ? ' from your laptop (the bridge cut it off at 64 KB)' : ' from your laptop');
  }
  if (!name) throw new Error('name is required, e.g. "report.csv".');
  if (typeof a.text === 'string') return sent(saveText(name, a.text, a.mimeType));
  if (typeof a.base64 === 'string') return sent(saveBase64(name, a.base64, a.mimeType));
  if (typeof a.url === 'string') {
    if (!/^https?:\/\//i.test(a.url)) throw new Error('url must start with http:// or https://');
    const { bytes, mimeType } = await fetchBytes(a.url);
    return sent(saveBytes(name, bytes, a.mimeType || mimeType));
  }
  throw new Error('Give the content as one of: text, base64, url, fromLaptop, fromGithub or fromLibrary.');
}

export const FILE_TOOL_LABELS: Record<string, (a: Args) => string> = {
  'files.send': (a) => `Sent ${a.name || a.fromLaptop || a.fromGithub?.path || 'a file'}`,
  'files.pdf': (a) => `Made ${String(a.name || 'document').replace(/\.pdf$/i, '')}.pdf`,
  'files.image': (a) => `Drew ${a.name || 'an image'}`,
  'files.list': () => 'Looked through your files',
  'files.read': (a) => `Read ${a.id || a.name || 'a file'} from your files`,
};

export function fileTools(ctx: ToolContext): Record<string, ToolDef> {
  const laptop = !!ctx.settings.bridgeUrl && !!ctx.settings.bridgeToken;
  const sources = ['"text":"file contents"', '"base64":"…"', '"url":"https://…"', '"fromGithub":{"repo":"owner/name","path":"file","ref":"optional"}', '"fromLibrary":"file id or name"'];
  if (laptop) sources.splice(3, 0, '"fromLaptop":"path/on/laptop"');
  return {
    'files.send': {
      service: 'files',
      kind: 'read',
      description:
        'Send the user a file of ANY type (CSV, JSON, code, Markdown, HTML, .ics, .vcf, images, zips…) as a downloadable card in the chat they can open, share, save and forward. Use this whenever the user asks for a file instead of pasting long content. Give exactly one source.',
      params: `{"name":"report.csv","mimeType":"optional",${sources.join(' | ')}}`,
      label: FILE_TOOL_LABELS['files.send'],
      run: (c, a) => send(c, a),
    },
    'files.pdf': {
      service: 'files',
      kind: 'read',
      description:
        'Make a nicely typeset PDF from Markdown (headings, lists, tables, code, images by URL) or from HTML, and send it to the user. Use for reports, letters, CVs, invoices, worksheets — whenever they ask for a PDF. <div class="page-break"></div> starts a new page.',
      params: '{"name":"report.pdf","markdown":"# Title…" | "html":"<h1>…</h1>","pageSize":"letter|a4"}',
      label: FILE_TOOL_LABELS['files.pdf'],
      run: async (_c, a) => {
        if (typeof a.markdown !== 'string' && typeof a.html !== 'string') throw new Error('Give "markdown" or "html".');
        return sent(await makePdf(String(a.name || 'document'), { markdown: a.markdown, html: a.html, pageSize: a.pageSize === 'a4' ? 'a4' : 'letter' }));
      },
    },
    'files.image': {
      service: 'files',
      kind: 'read',
      description:
        'Draw an image as SVG (diagrams, logos, icons, illustrations, simple charts) and send it as a PNG. Include width/height or a viewBox. For data charts you can also use code.run with saveFile.',
      params: '{"name":"logo.png","svg":"<svg xmlns=…>…</svg>","width":"optional px","background":"white|transparent|#hex","format":"png|svg"}',
      label: FILE_TOOL_LABELS['files.image'],
      run: async (_c, a) => {
        const { file, note } = await makeImage(String(a.name || 'image'), String(a.svg ?? ''), {
          width: Number(a.width) || undefined,
          background: typeof a.background === 'string' ? a.background : undefined,
          format: a.format,
        });
        return sent(file, note);
      },
    },
    'files.list': {
      service: 'files',
      kind: 'read',
      description: "List the user's Files library: files sent in chats, attached, or shared by friends (newest first).",
      params: '{"query":"optional text to match","limit":"optional, default 50"}',
      label: FILE_TOOL_LABELS['files.list'],
      run: async (_c, a) => {
        const q = String(a.query ?? '').toLowerCase();
        const list = (await listLibrary()).filter((f) => !q || f.name.toLowerCase().includes(q) || f.mimeType.includes(q));
        if (!list.length) return q ? `No files match "${a.query}".` : 'The Files library is empty.';
        return list
          .slice(0, Math.min(200, Number(a.limit) || 50))
          .map((f) => `${f.id} · ${describe(f)} · ${f.origin === 'assistant' ? 'made by you' : f.origin === 'shared' ? 'from a friend' : 'from the user'} · ${new Date(f.addedAt).toISOString().slice(0, 10)}`)
          .join('\n');
      },
    },
    'files.read': {
      service: 'files',
      kind: 'read',
      description: 'Read a file from the Files library by id or name (text files return their contents; others are described). Re-send one with files.send {"fromLibrary":id}.',
      params: '{"id":"file id or name"}',
      label: FILE_TOOL_LABELS['files.read'],
      run: async (_c, a) => {
        const f = findInLibrary(await listLibrary(), a.id ?? a.name);
        if (!f) throw new Error(`No file "${a.id ?? a.name}" in the Files library. Use files.list.`);
        const text = await readFileText(f);
        if (text !== null) return `${describe(f)}:\n${text}`;
        return `${describe(f)} is a ${typeLabel(f.name, f.mimeType)} that can’t be read as text here.${f.kind === 'image' ? ' The user can attach it to a message if you need to see it.' : ''}`;
      },
    },
  };
}
