import { addBoard, allDesigns, boardDocument, createDesign, findBoard, getDesign, prototypeDocument, updateBoard } from './designs';
import type { Board, Design } from './designs';
import { makePdf, saveBase64, saveText } from './fileTools';
import { canRunCode, runCodeWithFiles } from './runner';
import type { Args, ToolContext, ToolDef } from './tools';
import type { Attachment } from './types';

/** Design guidance shared by the design.* tools and the canvas prompt bar. */
export const DESIGN_GUIDE = `Design rules (follow strictly):
- Each board is ONE self-contained HTML document with inline <style>. No external CSS, JS, fonts or images: use system fonts (-apple-system, "Inter", system-ui, sans-serif), inline SVG icons, CSS gradients, and data: URIs only.
- Sizes: mobile screens 390x844, desktop / landing pages 1440x900 (taller is fine for scrolling pages, e.g. 1440x2400). Fill the frame; body margin 0.
- Use realistic, specific content (real-sounding names, prices, dates, copy) — never lorem ipsum or "Item 1".
- Keep ONE consistent design system across all boards in a design: define CSS variables (--bg, --surface, --text, --muted, --accent, --radius, spacing scale) and reuse the same type scale, colors, radii, buttons and nav.
- Strong hierarchy, generous whitespace, 8px spacing grid, aligned edges, at most 2 type families; polished details (subtle borders/shadows, states, icons).
- Accessible: text contrast ≥ 4.5:1 (3:1 for large text), tap targets ≥ 44px, semantic HTML (header, nav, main, button, label).
- Link screens like a prototype: <a href="Board Name.html"> where "Board Name" is another board's exact name (e.g. href="Checkout.html").
- Mobile screens: include a status-bar area (~44px) and a bottom tab bar or primary action where natural.`;

export const DESIGN_TOOL_LABELS: Record<string, (a: Args) => string> = {
  'design.create': (a) => `Started the design “${a.title || 'Untitled'}”`,
  'design.add_board': (a) => `Designed ${a.name || 'a screen'}`,
  'design.update_board': (a) => `Updated ${a.boardId || 'a screen'}`,
  'design.list': () => 'Listed designs',
  'design.read': () => 'Read a design',
};

const summary = (d: Design) =>
  `${d.title} (design id: ${d.id}) — ${d.boards.length} board${d.boards.length === 1 ? '' : 's'}${d.boards.length ? ': ' + d.boards.map((b) => `${b.name} [${b.id}, ${b.width}x${b.height}]`).join(', ') : ''}`;

async function need(id: unknown): Promise<Design> {
  const d = await getDesign(String(id ?? ''));
  if (!d) throw new Error(`No design "${id}". Use design.list, or design.create first.`);
  return d;
}

export function designTools(_ctx: ToolContext): Record<string, ToolDef> {
  // Designs live on this device and are only shown to the user, so these run without asking (kind 'agent').
  const tool = (description: string, params: string, name: string, run: ToolDef['run'], kind: ToolDef['kind'] = 'agent'): ToolDef => ({
    service: 'files',
    kind,
    description,
    params,
    label: DESIGN_TOOL_LABELS[name],
    run,
  });
  return {
    'design.create': tool(
      `Start a new design (like Claude Design): a canvas of screens the user sees in the Design studio and inline in chat. Use when the user asks to design / mock up an app, screens, a landing page, dashboard, UI. Then add each screen with design.add_board (one per call). \n${DESIGN_GUIDE}`,
      '{"title":"Pocket — budgeting app","brief":"audience, style, colors, screens planned"}',
      'design.create',
      async (_c, a) => {
        const d = await createDesign(String(a.title ?? ''), String(a.brief ?? ''));
        return `Created design id: ${d.id} ("${d.title}"). Now add screens with design.add_board {"designId":"${d.id}",…}.`;
      },
    ),
    'design.add_board': tool(
      'Add one screen (board) to a design: a complete self-contained HTML document following the design rules. width/height default to 390x844 (use 1440x900 for desktop).',
      '{"designId":"…","name":"Home","html":"<!doctype html><html>…</html>","width":390,"height":844}',
      'design.add_board',
      async (_c, a) => {
        if (!String(a.html ?? '').trim()) throw new Error('html is required.');
        const d = await need(a.designId);
        const b = await addBoard(d.id, { name: String(a.name ?? ''), html: String(a.html), width: a.width, height: a.height });
        return `Added board "${b.name}" (board id: ${b.id}, ${b.width}x${b.height}) to design id: ${d.id}. The user sees it on the canvas.`;
      },
    ),
    'design.update_board': tool(
      'Replace a board’s HTML (send the full new document, keeping the design system). boardId can be the id or the board name.',
      '{"designId":"…","boardId":"… or name","html":"<!doctype html>…","name":"optional new name"}',
      'design.update_board',
      async (_c, a) => {
        const d = await need(a.designId);
        const b = findBoard(d, String(a.boardId ?? ''));
        if (!b) throw new Error(`No board "${a.boardId}" in ${d.title}. Boards: ${d.boards.map((x) => x.name).join(', ')}`);
        if (!String(a.html ?? '').trim()) throw new Error('html is required.');
        updateBoard(d.id, b.id, { html: String(a.html), ...(a.name ? { name: String(a.name) } : {}) });
        return `Updated board "${a.name || b.name}" (board id: ${b.id}) in design id: ${d.id}.`;
      },
    ),
    'design.list': tool('List the user’s designs and their boards.', '{}', 'design.list', async () => {
      const list = await allDesigns();
      return list.length ? list.map(summary).join('\n') : 'No designs yet.';
    }, 'read'),
    'design.read': tool(
      'Read a design: its notes and boards; give boardId to get that board’s full HTML.',
      '{"designId":"…","boardId":"optional"}',
      'design.read',
      async (_c, a) => {
        const d = await need(a.designId);
        if (a.boardId) {
          const b = findBoard(d, String(a.boardId));
          if (!b) throw new Error(`No board "${a.boardId}".`);
          return `${b.name} [${b.id}] ${b.width}x${b.height}\n${b.html}`;
        }
        return `${summary(d)}\nNotes: ${d.notes || '(none)'}`;
      },
      'read',
    ),
  };
}

/** The design a design.* tool call touched (for the chat card). */
export function designIdOfCall(args: Record<string, unknown>, result?: string): string | null {
  const m = /design id: (\S+?)[).\s]/.exec(result ?? '');
  return m?.[1] ?? (typeof args.designId === 'string' ? args.designId : null);
}

// ---------- Exports ----------

const fileBase = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'design';

export function exportBoardHtml(b: Board): Attachment {
  return saveText(`${fileBase(b.name)}.html`, boardDocument(b.html), 'text/html');
}

export function exportPrototypeHtml(d: Design): Attachment {
  return saveText(`${fileBase(d.title)}.html`, prototypeDocument(d), 'text/html');
}

export function exportBoardPdf(b: Board): Promise<Attachment> {
  const pageSize = b.width >= 900 ? 'letter' : 'a4';
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(b.html)?.[1] ?? b.html;
  const styles = (b.html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('');
  return makePdf(fileBase(b.name), { html: styles + body, pageSize });
}

/** Renders the board to PNG with an SVG foreignObject in the hidden runner (Chromium-based web views). */
export async function exportBoardPng(b: Board): Promise<Attachment> {
  if (!canRunCode()) throw new Error('PNG export isn’t available here. Export as HTML instead.');
  const name = `${fileBase(b.name)}.png`;
  const code = `
const doc = new DOMParser().parseFromString(${JSON.stringify(boardDocument(b.html))}, 'text/html');
doc.querySelectorAll('script').forEach((s) => s.remove());
const css = [...doc.querySelectorAll('style')].map((s) => s.outerHTML).join('');
doc.querySelectorAll('style').forEach((s) => s.remove());
const wrap = document.createElement('div');
wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
wrap.style.cssText = 'width:${b.width}px;height:${b.height}px;overflow:hidden;background:#fff';
wrap.innerHTML = css + doc.body.innerHTML;
const xhtml = new XMLSerializer().serializeToString(wrap);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}"><foreignObject width="100%" height="100%">' + xhtml + '</foreignObject></svg>';
const img = new Image();
img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('The board could not be drawn.')); });
const canvas = document.createElement('canvas');
canvas.width = ${b.width * 2}; canvas.height = ${b.height * 2};
const ctx = canvas.getContext('2d'); ctx.scale(2, 2); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ${b.width}, ${b.height});
ctx.drawImage(img, 0, 0);
await saveFile(${JSON.stringify(name)}, canvas, 'image/png');
`;
  const { files } = await runCodeWithFiles('javascript', code);
  if (!files.length) throw new Error('PNG export failed. Export as HTML instead.');
  return saveBase64(files[0].name, files[0].base64, 'image/png');
}

// ---------- Prompt bar ----------

export function canvasSystemPrompt(d: Design): string {
  const boards = d.boards
    .map((b) => `<board id="${b.id}" name="${b.name}" width="${b.width}" height="${b.height}">\n${b.html.length > 12000 ? b.html.slice(0, 12000) + '\n<!-- truncated -->' : b.html}\n</board>`)
    .join('\n\n');
  return `You are a world-class product designer working in a design canvas. The design is "${d.title}".${d.notes ? `\nBrief: ${d.notes}` : ''}
${DESIGN_GUIDE}

Reply with a one-sentence summary, then one <board> block per screen you add or change:
<board name="Screen name" width="390" height="844">FULL HTML DOCUMENT</board>
To change an existing screen include its id: <board id="EXISTING_ID" name="…">FULL NEW HTML</board>. Unchanged screens: omit.
Current boards:
${boards || '(none yet — create the first screens)'}`;
}

export interface BoardEdit {
  id?: string;
  name: string;
  html: string;
  width?: number;
  height?: number;
}

export function parseBoardEdits(text: string): BoardEdit[] {
  const out: BoardEdit[] = [];
  const re = /<board\b([^>]*)>([\s\S]*?)<\/board>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const attr = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(m![1])?.[1];
    const html = m[2].replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    if (!html) continue;
    out.push({ id: attr('id'), name: attr('name') ?? '', html, width: Number(attr('width')) || undefined, height: Number(attr('height')) || undefined });
  }
  return out;
}
