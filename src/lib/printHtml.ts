/**
 * Markdown → HTML and the document stylesheet for the HTML documents the assistant makes
 * (files.html): a clean page on screen that also prints well. Pure functions, no native imports
 * (tested in Node).
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Only http(s), mailto, tel, data:image, in-page anchors and relative links survive; anything else becomes "#". */
function safeUrl(url: string): string {
  const u = url.trim().replace(/^<|>$/g, '');
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(u) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(u)) return u;
  if (!/^[a-z][\w+.-]*:/i.test(u)) return u; // relative
  return '#';
}

const PH = '\u0000';

/** Inline Markdown: code, raw tags, images, links, autolinks, emphasis, strike, hard breaks. */
export function renderInline(src: string): string {
  const stash: string[] = [];
  const keep = (html: string) => `${PH}${stash.push(html) - 1}${PH}`;
  let s = src;

  // Code spans (any number of backticks).
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _t, code: string) => {
    const c = code.replace(/\n/g, ' ');
    return keep(`<code>${escapeHtml(/^ .* $/.test(c) ? c.slice(1, -1) : c)}</code>`);
  });
  // Backslash escapes.
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_m, ch: string) => keep(escapeHtml(ch)));
  // Autolinks <https://…> and raw inline HTML tags pass through.
  s = s.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi, (_m, url: string) => keep(`<a href="${escapeHtml(safeUrl(url))}">${escapeHtml(url)}</a>`));
  s = s.replace(/<\/?[A-Za-z][\w-]*(?:\s+[^<>]*?)?\s*\/?>|<!--[\s\S]*?-->/g, (tag) =>
    /^<\/?(script|iframe|object|embed)\b/i.test(tag) || /\son\w+\s*=|javascript:/i.test(tag) ? keep(escapeHtml(tag)) : keep(tag),
  );

  s = escapeHtml(s);

  // Images and links (label may contain emphasis). Titles in quotes are optional.
  const target = String.raw`\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:&quot;(.*?)&quot;|'(.*?)'))?\s*\)`;
  s = s.replace(new RegExp(String.raw`!\[([^\]]*)\]` + target, 'g'), (_m, alt: string, url: string, t1?: string, t2?: string) => {
    const title = t1 ?? t2;
    return keep(`<img src="${escapeHtml(safeUrl(decodeEntities(url)))}" alt="${alt}"${title ? ` title="${title}"` : ''}>`);
  });
  s = s.replace(new RegExp(String.raw`\[((?:[^\[\]]|\[[^\]]*\])*)\]` + target, 'g'), (_m, label: string, url: string, t1?: string, t2?: string) => {
    const title = t1 ?? t2;
    return keep(`<a href="${escapeHtml(safeUrl(decodeEntities(url)))}"${title ? ` title="${title}"` : ''}>${emphasis(label)}</a>`);
  });
  // Bare URLs.
  s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)'"\]])/g, (_m, pre: string, url: string) =>
    pre + keep(`<a href="${url.startsWith('www.') ? 'https://' + url : url}">${url}</a>`),
  );

  s = emphasis(s);
  // Hard line breaks: two trailing spaces or a backslash before a newline.
  s = s.replace(/(?: {2,}|\\)\n/g, '<br>\n');

  // Restore stashed pieces (they may nest, e.g. code inside a link label).
  for (let i = 0; i < 3 && s.includes(PH); i++) s = s.replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_m, n: string) => stash[+n]);
  return s;
}

// Entities were escaped already; turn &amp; back into & inside URLs only where it was a literal ampersand.
function decodeEntities(url: string): string {
  return url.replace(/^<|>$/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function emphasis(s: string): string {
  return s
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/==(?=\S)([^=\n]*?\S)==/g, '<mark>$1</mark>');
}

const BLOCK_TAG = /^ {0,3}<\/?(address|article|aside|blockquote|center|details|dialog|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|style|svg|img|br|hr|!--)(\s|\/?>|>|$)/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const LIST_ITEM = /^( {0,12})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const TABLE_DELIM = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const indentOf = (line: string) => line.replace(/\t/g, '    ').match(/^ */)![0].length;
const isBlank = (line: string) => !line.trim();

/** Starts a new block (so it interrupts a paragraph). */
function startsBlock(line: string, next?: string): boolean {
  return (
    FENCE.test(line) ||
    HR.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    BLOCK_TAG.test(line) ||
    /^ {0,3}([-*+]|1[.)])[ \t]+\S/.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_DELIM.test(next) && next.includes('-'))
  );
}

/** Block-level Markdown (CommonMark-ish + GitHub tables, task lists and strikethrough) → HTML. */
export function markdownToHtml(markdown: string): string {
  return renderBlocks(String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n'));
}

function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2];
      const pad = indentOf(line);
      const code: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(lines[i])) {
        code.push(lines[i].replace(new RegExp(`^ {0,${pad}}`), ''));
        i++;
      }
      i++; // closing fence
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // Indented code (4+ spaces, not inside a list)
    if (/^( {4}|\t)/.test(line)) {
      const code: string[] = [];
      while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || (isBlank(lines[i]) && i + 1 < lines.length && /^( {4}|\t)/.test(lines[i + 1])))) {
        code.push(lines[i].replace(/^( {4}|\t)/, ''));
        i++;
      }
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline((heading[2] ?? '').trim())}</h${level}>`);
      i++;
      continue;
    }

    // Raw HTML block: until a blank line.
    if (BLOCK_TAG.test(line)) {
      const html: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) html.push(lines[i++]);
      out.push(html.join('\n').replace(/<(script|iframe|object|embed)\b[\s\S]*?(<\/\1>|$)/gi, ''));
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        const q = lines[i].match(QUOTE);
        if (q) inner.push(q[1]);
        else if (startsBlock(lines[i])) break;
        else inner.push(lines[i]); // lazy continuation
        i++;
      }
      out.push(`<blockquote>${renderBlocks(inner)}</blockquote>`);
      continue;
    }

    // Table: header row + delimiter row
    if (line.includes('|') && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '',
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      const cell = (tag: string, text: string, col: number) =>
        `<${tag}${aligns[col] ? ` style="text-align:${aligns[col]}"` : ''}>${renderInline(text)}</${tag}>`;
      out.push(
        `<table><thead><tr>${head.map((h, c) => cell('th', h, c)).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_h, c) => cell('td', r[c] ?? '', c)).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item && (item[4].trim() !== '' || (i + 1 < lines.length && indentOf(lines[i + 1]) > indentOf(line)))) {
      i = renderList(lines, i, out);
      continue;
    }

    // Paragraph (with setext heading underline)
    const para: string[] = [line.replace(/^\s+/, '')];
    i++;
    while (i < lines.length && !isBlank(lines[i])) {
      if (/^ {0,3}=+\s*$/.test(lines[i]) || /^ {0,3}-+\s*$/.test(lines[i])) {
        const level = lines[i].trim().startsWith('=') ? 1 : 2;
        out.push(`<h${level}>${renderInline(para.join('\n'))}</h${level}>`);
        para.length = 0;
        i++;
        break;
      }
      if (startsBlock(lines[i], lines[i + 1])) break;
      para.push(lines[i].replace(/^\s+/, ''));
      i++;
    }
    if (para.length) out.push(`<p>${renderInline(para.join('\n'))}</p>`);
  }
  return out.join('\n');
}

/** Renders the list starting at lines[start]; returns the index after it. */
function renderList(lines: string[], start: number, out: string[]): number {
  const first = lines[start].match(LIST_ITEM)!;
  const baseIndent = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items: { lines: string[]; indent: number }[] = [];
  let loose = false;
  let i = start;
  let sawBlank = false;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      sawBlank = true;
      i++;
      continue;
    }
    const m = line.match(LIST_ITEM);
    const ind = indentOf(line);
    if (m && ind >= baseIndent && ind < baseIndent + 2 && /\d/.test(m[2]) === ordered) {
      if (sawBlank && items.length) loose = true;
      sawBlank = false;
      // Content indent: marker + spaces (continuation lines are de-indented by this much).
      const contentIndent = ind + m[2].length + Math.min(Math.max(m[3].length, 1), 4);
      items.push({ lines: [m[4]], indent: contentIndent });
      i++;
      continue;
    }
    const cur = items[items.length - 1];
    if (ind >= baseIndent + 2 || (!sawBlank && !startsBlock(line) && !m)) {
      // Nested content or lazy continuation of the current item.
      if (sawBlank) {
        cur.lines.push('');
        if (!LIST_ITEM.test(line)) loose = true; // a second paragraph in an item
      }
      sawBlank = false;
      const strip = Math.min(ind, cur.indent);
      cur.lines.push(line.replace(/\t/g, '    ').slice(strip));
      i++;
      continue;
    }
    break;
  }

  const body = items
    .map(({ lines: itemLines }) => {
      let html = renderBlocks(itemLines);
      if (!loose) html = html.replace(/^<p>([\s\S]*?)<\/p>/, '$1').replace(/\n<p>([\s\S]*?)<\/p>/g, '\n$1');
      const task = html.match(/^\[([ xX])\]\s+/);
      if (task) {
        const done = task[1] !== ' ';
        return `<li class="task"><span class="box">${done ? '☑' : '☐'}</span>${html.slice(task[0].length)}</li>`;
      }
      return `<li>${html}</li>`;
    })
    .join('\n');
  out.push(ordered ? `<ol${startNum !== 1 ? ` start="${startNum}"` : ''}>\n${body}\n</ol>` : `<ul>\n${body}\n</ul>`);
  return i;
}

export type PageSize = 'letter' | 'a4';

/** Page sizes in CSS pixels at 72 dpi (what expo-print expects). */
export const PAGE_SIZES: Record<PageSize, { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595, height: 842 },
};

/** Document stylesheet: TryChat's clean sans look on white paper, centred on screen, paginated in print. */
export const PRINT_CSS = `
@page { margin: 18mm 17mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fafafa; }
body { font-family: Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #18181b; background: #fff; margin: 0 auto; max-width: 760px; padding: 40px 28px 64px; box-sizing: border-box; word-wrap: break-word; overflow-wrap: break-word; }
@media screen and (min-width: 820px) { body { margin: 32px auto; border: 1px solid #e4e4e7; border-radius: 14px; } }
@media print { html { background: #fff; } body { max-width: none; padding: 0; margin: 0; border: 0; font-size: 11pt; } }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; color: #18181b; font-weight: 600; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 30px; letter-spacing: -0.02em; margin: 0 0 16px; }
h2 { font-size: 21px; letter-spacing: -0.01em; margin: 32px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e4e4e7; }
h3 { font-size: 17px; margin: 24px 0 8px; }
h4, h5, h6 { font-size: 15px; margin: 18px 0 6px; }
h1 + h2 { margin-top: 12px; }
p { margin: 0 0 12px; orphans: 3; widows: 3; }
a { color: #c2410c; text-decoration: underline; text-underline-offset: 2px; }
strong { font-weight: 600; }
mark { background: #fdede5; padding: 0 3px; border-radius: 3px; }
del { color: #6b6b74; }
code { font-family: 'Geist Mono', 'SF Mono', Menlo, Consolas, 'Roboto Mono', monospace; font-size: 0.88em; background: #f1f1f3; border-radius: 6px; padding: 1px 5px; }
pre { font-family: 'Geist Mono', 'SF Mono', Menlo, Consolas, 'Roboto Mono', monospace; background: #111114; color: #e4e4e7; border-radius: 14px; padding: 14px 16px; margin: 0 0 14px; white-space: pre-wrap; font-size: 13px; line-height: 1.55; page-break-inside: avoid; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: inherit; border-radius: 0; color: inherit; }
blockquote { margin: 0 0 14px; padding: 2px 0 2px 14px; border-left: 3px solid #c2410c; color: #52525b; }
blockquote p:last-child { margin-bottom: 0; }
ul, ol { margin: 0 0 12px; padding-left: 24px; }
li { margin: 3px 0; }
li > ul, li > ol { margin-bottom: 3px; }
li.task { list-style: none; margin-left: -20px; }
li.task .box { display: inline-block; width: 20px; }
table { border-collapse: separate; border-spacing: 0; width: 100%; margin: 6px 0 16px; font-size: 14px; line-height: 1.45; border: 1px solid #e4e4e7; border-radius: 14px; overflow: hidden; }
th, td { border-bottom: 1px solid #e4e4e7; padding: 9px 12px; text-align: left; vertical-align: top; }
tr:last-child td { border-bottom: 0; }
th { font-weight: 600; color: #52525b; background: #f1f1f3; }
tr { page-break-inside: avoid; break-inside: avoid; }
thead { display: table-header-group; }
hr { border: none; border-top: 1px solid #e4e4e7; margin: 28px 0; }
img, svg { max-width: 100%; height: auto; }
figure { margin: 0 0 14px; } figcaption { color: #52525b; font-size: 13px; margin-top: 6px; }
.page-break { page-break-after: always; break-after: page; height: 0; }
`;

const looksLikeDocument = (html: string) => /<html[\s>]/i.test(html) || /<!doctype\s+html/i.test(html);

/**
 * A complete HTML document. `html` that is already a full document is used as is (the model styled
 * it); fragments and Markdown get the document stylesheet.
 */
export function printableHtml(input: { html?: string; markdown?: string; title?: string; pageSize?: PageSize }): string {
  const { html, markdown, title, pageSize } = input;
  if (html && looksLikeDocument(html)) return html;
  const body = markdown !== undefined && !html ? markdownToHtml(markdown) : html ?? '';
  const size = pageSize === 'a4' ? 'A4' : 'letter';
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title ?? 'Document')}</title>
<style>${PRINT_CSS}@page { size: ${size}; }</style>
</head><body>
${body}
</body></html>`;
}
