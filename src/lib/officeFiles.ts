import { strToU8, zipSync } from 'fflate';
import PptxGenJS from 'pptxgenjs';

/**
 * Real Office files made on the device: Excel (.xlsx) and Word (.docx) are written as Office Open
 * XML zipped with fflate; PowerPoint (.pptx) uses pptxgenjs. No network, no native code.
 */

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 forbids.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function zip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) entries[path] = strToU8(text);
  return zipSync(entries, { level: 6 });
}

// ---------- Excel ----------

export type Cell = string | number | boolean | null | undefined;
export interface Sheet {
  name?: string;
  rows: Cell[][];
  /** Column widths in characters. */
  widths?: number[];
  /** Bold, frozen first row with filters (default true). */
  header?: boolean;
}

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetNames(sheets: Sheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = (String(s.name ?? '').replace(/[[\]:*?/\\]/g, ' ').trim() || `Sheet${i + 1}`).slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function sheetXml(sheet: Sheet): string {
  const rows = (Array.isArray(sheet.rows) ? sheet.rows : []).map((r) => (Array.isArray(r) ? r : [r]));
  const header = sheet.header !== false && rows.length > 1;
  const width = Math.max(1, ...rows.map((r) => r.length));
  const widths = Array.from({ length: width }, (_, c) => {
    const given = sheet.widths?.[c];
    if (typeof given === 'number' && given > 0) return Math.min(given, 120);
    const longest = Math.max(4, ...rows.slice(0, 200).map((r) => String(r[c] ?? '').length));
    return Math.min(60, longest + 2);
  });
  const body = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          const style = header && ri === 0 ? ' s="1"' : '';
          if (v === null || v === undefined || v === '') return '';
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
          if (typeof v === 'boolean') return `<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`;
          const text = String(v);
          if (text.startsWith('=') && text.length > 1) return `<c r="${ref}"${style}><f>${esc(text.slice(1))}</f></c>`;
          // Numbers that came as text ("1,250" stays text; "1250" or "12.5" become numbers).
          if (/^-?\d+(\.\d+)?$/.test(text.trim()) && text.trim().length < 16) return `<c r="${ref}"${style}><v>${text.trim()}</v></c>`;
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  const last = `${colName(width - 1)}${Math.max(rows.length, 1)}`;
  return (
    XML +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    (header
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>') +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${body}</sheetData>` +
    (header ? `<autoFilter ref="A1:${last}"/>` : '') +
    '</worksheet>'
  );
}

export function makeXlsx(sheets: Sheet[]): Uint8Array {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('Give "sheets": [{"name":"Sheet1","rows":[[…],[…]]}].');
  const names = sheetNames(sheets);
  const files: Record<string, string> = {
    '[Content_Types].xml':
      XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>',
    '_rels/.rels':
      XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      XML +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
      '</workbook>',
    'xl/_rels/workbook.xml.rels':
      XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
    'xl/styles.xml':
      XML +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F1F3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>',
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s)));
  return zip(files);
}

// ---------- Word ----------

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

interface DocCtx {
  links: string[];
  numIds: number;
  numbered: number[];
}

/** Inline Markdown → runs: **bold**, *italic*, `code`, ~~strike~~ and [links](url). */
function runs(text: string, ctx: DocCtx, base = ''): string {
  const out: string[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|~~([^~]+)~~|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  const run = (t: string, props: string) =>
    t ? `<w:r>${props || base ? `<w:rPr>${base}${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>` : '';
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push(run(text.slice(last, m.index), ''));
    if (m[2] || m[3]) out.push(run(m[2] ?? m[3], '<w:b/>'));
    else if (m[4] || m[5]) out.push(run(m[4] ?? m[5], '<w:i/>'));
    else if (m[6]) out.push(run(m[6], '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F1F1F3"/>'));
    else if (m[7]) out.push(run(m[7], '<w:strike/>'));
    else if (m[8] && /^(https?:|mailto:)/i.test(m[9])) {
      ctx.links.push(m[9]);
      const id = `rIdL${ctx.links.length}`;
      out.push(`<w:hyperlink r:id="${id}">${run(m[8], '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`);
    } else out.push(run(m[0], ''));
    last = m.index + m[0].length;
  }
  out.push(run(text.slice(last), ''));
  return out.join('');
}

const para = (content: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;

function markdownToBody(md: string, ctx: DocCtx): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let paraBuf: string[] = [];
  const flush = () => {
    if (paraBuf.length) out.push(para(runs(paraBuf.join(' '), ctx)));
    paraBuf = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      i++;
      continue;
    }
    if (/^<div class="page-break"><\/div>$/i.test(trimmed) || /^\\pagebreak$/.test(trimmed)) {
      flush();
      out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      i++;
      continue;
    }
    const fence = /^(```|~~~)/.exec(trimmed);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      for (const c of code.length ? code : ['']) out.push(para(`<w:r><w:t xml:space="preserve">${esc(c)}</w:t></w:r>`, '<w:pStyle w:val="Code"/>'));
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flush();
      const level = Math.min(h[1].length, 3);
      out.push(para(runs(h[2].replace(/\s+#+$/, ''), ctx), `<w:pStyle w:val="Heading${level}"/>`));
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      out.push(para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D4D4D8"/></w:pBdr>'));
      i++;
      continue;
    }
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      flush();
      const cellsOf = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cellsOf(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) body.push(cellsOf(lines[i++]));
      const cell = (t: string, header: boolean) =>
        `<w:tc><w:tcPr>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F1F3"/>' : ''}</w:tcPr>${para(runs(t, ctx, header ? '<w:b/>' : ''))}</w:tc>`;
      out.push(
        '<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
          `<w:tr><w:trPr><w:tblHeader/></w:trPr>${head.map((c) => cell(c, true)).join('')}</w:tr>` +
          body.map((r) => `<w:tr>${head.map((_, ci) => cell(r[ci] ?? '', false)).join('')}</w:tr>`).join('') +
          '</w:tbl>',
        para(''),
      );
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) quote.push(lines[i++].trim().replace(/^>\s?/, ''));
      out.push(para(runs(quote.join(' '), ctx), '<w:pStyle w:val="Quote"/>'));
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      let numId = 1;
      if (ordered) {
        numId = ++ctx.numIds;
        ctx.numbered.push(numId);
      }
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        const level = Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
        let text = m[3];
        const task = /^\[([ xX])\]\s+/.exec(text);
        if (task) text = `${task[1] === ' ' ? '☐' : '☑'} ${text.slice(task[0].length)}`;
        out.push(para(runs(text, ctx), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`));
        i++;
      }
      continue;
    }
    paraBuf.push(trimmed);
    i++;
  }
  flush();
  return out.join('');
}

const STYLES =
  XML +
  `<w:styles ${W}>` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/><w:color w:val="18181B"/></w:rPr></w:style>' +
  [1, 2, 3]
    .map(
      (n) =>
        `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${[360, 280, 200][n - 1]}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[36, 28, 24][n - 1]}"/><w:color w:val="${n === 1 ? 'C2410C' : '18181B'}"/></w:rPr></w:style>`,
    )
    .join('') +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C2410C"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="52525B"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F1F1F3"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>' +
  '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="C2410C"/><w:u w:val="single"/></w:rPr></w:style>' +
  '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="D4D4D8"/>`).join('') +
  '</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

function numbering(ordered: number[]): string {
  const level = (i: number, fmt: string, text: string) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
  return (
    XML +
    `<w:numbering ${W}>` +
    `<w:abstractNum w:abstractNumId="0">${['•', '◦', '▪'].map((b, i) => level(i, 'bullet', b)).join('')}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1">${['decimal', 'lowerLetter', 'lowerRoman'].map((f, i) => level(i, f, `%${i + 1}.`)).join('')}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    ordered.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('') +
    '</w:numbering>'
  );
}

export function makeDocx(markdown: string, title?: string): Uint8Array {
  const ctx: DocCtx = { links: [], numIds: 1, numbered: [] };
  const body =
    (title ? para(runs(title, ctx), '<w:pStyle w:val="Title"/>') : '') +
    markdownToBody(markdown, ctx) +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1304" w:right="1247" w:bottom="1304" w:left="1247" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return zip({
    '[Content_Types].xml':
      XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>',
    '_rels/.rels':
      XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>',
    'docProps/core.xml':
      XML +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${esc(title ?? '')}</dc:title><dc:creator>TryChat</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created>` +
      '</cp:coreProperties>',
    'word/_rels/document.xml.rels':
      XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      ctx.links
        .map((url, i) => `<Relationship Id="rIdL${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`)
        .join('') +
      '</Relationships>',
    'word/document.xml': XML + `<w:document ${W}><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': STYLES,
    'word/numbering.xml': numbering(ctx.numbered),
  });
}

// ---------- PowerPoint ----------

export interface Slide {
  layout?: 'title' | 'section' | 'content';
  title?: string;
  subtitle?: string;
  bullets?: string[];
  text?: string;
  table?: Cell[][];
  chart?: { type?: 'bar' | 'line' | 'pie' | 'doughnut' | 'area'; labels?: string[]; series?: { name?: string; values?: number[] }[] };
  notes?: string;
}
export interface Deck {
  title?: string;
  theme?: 'dark' | 'light';
  accent?: string;
  slides: Slide[];
}

const hex = (c: unknown, fallback: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c ?? '').trim());
  return (m ? m[1] : fallback).toUpperCase();
};

export async function makePptx(deck: Deck): Promise<Uint8Array> {
  const dark = deck.theme === 'dark';
  const C = {
    bg: dark ? '0A0A0B' : 'FFFFFF',
    ink: dark ? 'F4F4F5' : '18181B',
    muted: dark ? 'A1A1AA' : '52525B',
    line: dark ? '2C2C32' : 'E4E4E7',
    fill: dark ? '1C1C20' : 'F1F1F3',
    accent: hex(deck.accent, dark ? 'FF7A45' : 'C2410C'),
  };
  const font = 'Calibri';
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = deck.title ?? deck.slides[0]?.title ?? 'Presentation';
  pptx.author = 'TryChat';

  deck.slides.forEach((sl, index) => {
    const s = pptx.addSlide();
    s.background = { color: C.bg };
    if (sl.layout === 'title' || (index === 0 && sl.layout !== 'content' && sl.layout !== 'section' && !sl.bullets && !sl.table && !sl.chart && !sl.text)) {
      s.addShape(pptx.ShapeType.rect, { x: 0.8, y: 3.05, w: 0.9, h: 0.08, fill: { color: C.accent }, line: { color: C.accent } });
      s.addText(sl.title ?? '', { x: 0.8, y: 1.6, w: 11.7, h: 1.4, fontFace: font, fontSize: 44, bold: true, color: C.ink, valign: 'bottom' });
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.8, y: 3.35, w: 11.7, h: 1, fontFace: font, fontSize: 22, color: C.muted, valign: 'top' });
    } else if (sl.layout === 'section') {
      s.background = { color: C.fill };
      s.addShape(pptx.ShapeType.rect, { x: 0.8, y: 3.55, w: 0.9, h: 0.08, fill: { color: C.accent }, line: { color: C.accent } });
      s.addText(sl.title ?? '', { x: 0.8, y: 2.2, w: 11.7, h: 1.3, fontFace: font, fontSize: 36, bold: true, color: C.ink, valign: 'bottom' });
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.8, y: 3.8, w: 11.7, h: 0.8, fontFace: font, fontSize: 18, color: C.muted });
    } else {
      s.addText(sl.title ?? '', { x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontFace: font, fontSize: 30, bold: true, color: C.ink, valign: 'middle' });
      s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.25, w: 0.7, h: 0.06, fill: { color: C.accent }, line: { color: C.accent } });
      let top = 1.55;
      if (sl.subtitle) {
        s.addText(sl.subtitle, { x: 0.6, y: 1.4, w: 12.1, h: 0.5, fontFace: font, fontSize: 16, color: C.muted });
        top = 2.0;
      }
      const visual = sl.table?.length || sl.chart?.series?.length;
      const words = (sl.bullets?.length ?? 0) > 0 || !!sl.text;
      const textBox = { x: 0.6, y: top, w: visual && words ? 5.6 : 12.1, h: 7.0 - top };
      const visBox = { x: words ? 6.5 : 0.6, y: top, w: words ? 6.2 : 12.1, h: 7.0 - top };
      if (sl.bullets?.length) {
        s.addText(
          sl.bullets.map((b) => {
            const str = String(b ?? '');
            const level = /^\s{2,}/.test(str) ? 1 : 0;
            return { text: str.trim(), options: { bullet: { indent: 18 }, indentLevel: level, fontSize: level ? 16 : 20, color: level ? C.muted : C.ink, breakLine: true } };
          }),
          { ...textBox, fontFace: font, valign: 'top', paraSpaceAfter: 8 },
        );
      } else if (sl.text) {
        s.addText(sl.text, { ...textBox, fontFace: font, fontSize: 18, color: C.ink, valign: 'top' });
      }
      if (sl.table?.length) {
        const rows = sl.table.map((r, ri) =>
          (Array.isArray(r) ? r : [r]).map((c) => ({
            text: String(c ?? ''),
            options: ri === 0 ? { bold: true, color: dark ? '170A04' : 'FFFFFF', fill: { color: C.accent } } : { color: C.ink, fill: { color: ri % 2 ? C.bg : C.fill } },
          })),
        );
        s.addTable(rows, { ...visBox, h: undefined, fontFace: font, fontSize: 14, border: { type: 'solid', pt: 0.75, color: C.line }, autoPage: false });
      } else if (sl.chart?.series?.length) {
        const types: Record<string, PptxGenJS.CHART_NAME> = { bar: pptx.ChartType.bar, line: pptx.ChartType.line, pie: pptx.ChartType.pie, doughnut: pptx.ChartType.doughnut, area: pptx.ChartType.area };
        const labels = (sl.chart.labels ?? []).map(String);
        const data = sl.chart.series.map((se, i) => ({ name: se.name ?? `Series ${i + 1}`, labels, values: (se.values ?? []).map(Number) }));
        const round = sl.chart.type === 'pie' || sl.chart.type === 'doughnut';
        s.addChart(types[sl.chart.type ?? 'bar'] ?? pptx.ChartType.bar, data, {
          ...visBox,
          chartColors: [C.accent, '38C9E8', '8AB4FF', 'F5C451', '9FE2BF', 'A1A1AA'],
          showLegend: round || data.length > 1,
          legendPos: 'b',
          legendColor: C.muted,
          catAxisLabelColor: C.muted,
          valAxisLabelColor: C.muted,
          valGridLine: { color: C.line, size: 0.5 },
          catGridLine: { style: 'none' },
          showPercent: round,
          dataLabelColor: C.ink,
        });
      }
    }
    if (sl.notes) s.addNotes(String(sl.notes));
  });
  const out = await pptx.write({ outputType: 'uint8array' });
  return out as Uint8Array;
}
