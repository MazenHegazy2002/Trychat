import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { TextStyle } from 'react-native';

import { isPreviewable, isVisual, previewVerb, setPreview, toHtmlDocument } from '../lib/preview';
import { FONT, RADIUS, TYPE, WIDE_BREAKPOINT, useTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';
import { codePalette, hashLangName, highlightLine } from './CodeView';
import { HtmlView } from './HtmlView';
import { Text } from './Text';
import { Icon, RunningDot } from './ui';
import type { IconName } from './ui';

type Block =
  | { type: 'code'; lang: string; code: string; closed: boolean }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'rule' }
  | { type: 'table'; head: string[]; rows: string[][]; align: ('left' | 'center' | 'right')[] }
  | { type: 'paragraph'; text: string };

/** Minimal Markdown parser covering what chat models typically produce. */
export function parseBlocks(src: string): Block[] {
  const lines = src.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      const code: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (/^\s*```\s*$/.test(lines[i])) {
          closed = true;
          i++;
          break;
        }
        code.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', lang: fence[1] || '', code: code.join('\n'), closed });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }
    const listRe = /^\s*([-*+]|\d+[.)])\s+(.*)/;
    if (listRe.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && listRe.test(lines[i])) {
        items.push(lines[i].match(listRe)![2]);
        i++;
        // continuation lines indented under the item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !listRe.test(lines[i])) {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    // A table: a header row, a |---|---| divider, then rows.
    const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : 'left') as 'left' | 'center' | 'right');
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(cells(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', head, rows, align });
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !listRe.test(lines[i]) &&
      !lines[i].startsWith('>')
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: para.join('\n') });
  }
  return blocks;
}

const LINK_MD = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/;
const LINK_BARE = /^https?:\/\//;

const openLink = (url: string) => {
  Linking.openURL(url).catch(() => {});
};

function Inline({ text, style, theme }: { text: string; style?: TextStyle; theme: Theme }) {
  const parts = text.split(
    /(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>()[\]`]*[^\s<>()[\]`.,;:!?'"]|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*)/g,
  );
  return (
    <Text style={[TYPE.body, { color: theme.ink }, style]} selectable>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`') && p.length > 1)
          return (
            <Text key={i} style={[styles.inlineCode, { backgroundColor: theme.fill, color: theme.ink }]}>
              {p.slice(1, -1)}
            </Text>
          );
        const md = p.match(LINK_MD);
        if (md || LINK_BARE.test(p)) {
          const url = md ? md[2] : p;
          return (
            <Text key={i} style={{ color: theme.accent }} onPress={() => openLink(url)} accessibilityRole="link">
              {md ? md[1] : p}
            </Text>
          );
        }
        if ((p.startsWith('**') || p.startsWith('__')) && p.length > 4)
          return (
            <Text key={i} style={{ fontWeight: '600' }}>
              {p.slice(2, -2)}
            </Text>
          );
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2)
          return (
            <Text key={i} style={{ fontStyle: 'italic' }}>
              {p.slice(1, -1)}
            </Text>
          );
        return p;
      })}
    </Text>
  );
}

/** A small text button in a code block's header bar (Run, View code, Full screen, Copy). */
function BarAction({ label, icon, onPress, theme }: { label: string; icon?: IconName; onPress: () => void; theme: Theme }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.barAction,
        (pressed || hovered) && { backgroundColor: theme.fill },
      ]}
    >
      {icon && <Icon name={icon} size={14} color={theme.codeInk} />}
      <Text style={[styles.barActionText, { color: theme.codeInk }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Highlighted code on `codeBg`, scrolling sideways when lines are long. */
function CodeBody({ code, lang, theme }: { code: string; lang: string; theme: Theme }) {
  const C = useMemo(() => codePalette(theme), [theme]);
  const hash = hashLangName(lang);
  const lines = code.split('\n');
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
      <Text selectable style={[styles.codeText, { color: theme.codeInk }]}>
        {lines.map((line, i) => (
          <Text key={i}>
            {highlightLine(line, hash, C).map((k, j) => (
              <Text key={j} style={{ color: k.c }}>
                {k.t}
              </Text>
            ))}
            {i < lines.length - 1 ? '\n' : ''}
          </Text>
        ))}
      </Text>
    </ScrollView>
  );
}

/**
 * Code stays folded until you tap View code: a finished page or app runs right here instead (a live preview under
 * the header bar), and other code keeps its Run/Preview button. One- or two-line snippets are shown as they are.
 */
function CodeBlock({ lang, code, closed, theme }: { lang: string; code: string; closed: boolean; theme: Theme }) {
  const { width } = useWindowDimensions();
  const lines = code ? code.split('\n').length : 0;
  const short = closed && lines <= 2;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => (closed && isVisual(lang) ? toHtmlDocument(code, lang) : ''), [closed, code, lang]);
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const preview = () => {
    setPreview(code, lang);
    router.push('/preview');
  };
  const live = closed && isVisual(lang);
  const shown = short || open;
  const summary = !closed
    ? `Writing ${lang || 'code'}… ${lines} line${lines === 1 ? '' : 's'}`
    : `${lang || 'code'} · ${lines} line${lines === 1 ? '' : 's'}`;
  return (
    <View style={[styles.code, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
      <View style={styles.codeHeader}>
        {!closed && (
          <View style={{ marginRight: 6 }}>
            <RunningDot size={6} />
          </View>
        )}
        <Text style={[TYPE.codeLabel, styles.codeLang, { color: theme.inkMuted }]} numberOfLines={1}>
          {short ? lang || 'code' : summary}
        </Text>
        {closed && isPreviewable(lang) && (
          <BarAction
            label={live ? 'Full screen' : previewVerb(lang)}
            icon={live ? 'maximize-2' : 'play'}
            onPress={preview}
            theme={theme}
          />
        )}
        {closed && !short && <BarAction label={open ? 'Hide code' : 'View code'} onPress={() => setOpen((o) => !o)} theme={theme} />}
        {closed && <BarAction label={copied ? 'Copied' : 'Copy'} icon={copied ? 'check' : undefined} onPress={copy} theme={theme} />}
      </View>
      {live && (
        // The stage keeps the app's own colours (HtmlView paints it white).
        <View style={[styles.live, { height: width >= WIDE_BREAKPOINT ? 480 : 380, borderTopColor: theme.border }]}>
          <HtmlView html={html} />
        </View>
      )}
      {shown && <CodeBody code={code} lang={lang} theme={theme} />}
    </View>
  );
}

const NUMERIC = /^[-+−~≈]?\s*\(?[€$£¥]?\s*\d[\d,.'\s]*\s*(%|[kKMB]|€|\$|£|¥|x)?\)?$/;
const plain = (cell: string) => cell.replace(/\*\*|__|`/g, '').trim();

function Table({ head, rows, align, theme }: { head: string[]; rows: string[][]; align: ('left' | 'center' | 'right')[]; theme: Theme }) {
  // Columns follow the Markdown alignment row; numbers line up on the right when it says nothing.
  const aligns = head.map((_, c) => {
    if (align[c] && align[c] !== 'left') return align[c];
    const body = rows.map((r) => plain(r[c] ?? '')).filter(Boolean);
    return body.length > 0 && body.every((v) => NUMERIC.test(v)) ? 'right' : 'left';
  });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={[styles.table, { borderColor: theme.border, backgroundColor: theme.surface, flexGrow: 1 }]}>
        {[head, ...rows].map((row, r) => (
          <View
            key={r}
            style={[styles.tableRow, r === 0 ? { backgroundColor: theme.surfaceRaised } : { borderTopWidth: 1, borderTopColor: theme.border }]}
          >
            {head.map((_, c) => {
              const numeric = aligns[c] === 'right' && r > 0;
              return (
                <View key={c} style={styles.tableCell}>
                  <Inline
                    text={row[c] ?? ''}
                    theme={theme}
                    style={
                      r === 0
                        ? { ...TYPE.caption, fontWeight: '600', color: theme.inkMuted, textAlign: aligns[c] }
                        : {
                            fontSize: 14,
                            lineHeight: 20,
                            textAlign: aligns[c],
                            color: c === 0 || numeric ? theme.ink : theme.inkMuted,
                            ...(numeric ? { fontVariant: ['tabular-nums'] } : null),
                          }
                    }
                  />
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const HEADING: TextStyle[] = [
  { fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  { fontSize: 19, lineHeight: 26, letterSpacing: -0.2 },
  { fontSize: 17, lineHeight: 24, letterSpacing: -0.1 },
  { fontSize: 16, lineHeight: 24 },
];

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  const blocks = parseBlocks(text);
  return (
    <View style={{ gap: 12 }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'code':
            return <CodeBlock key={i} {...b} theme={theme} />;
          case 'heading':
            return (
              <Inline
                key={i}
                text={b.text}
                theme={theme}
                style={{ ...HEADING[Math.min(b.level, 4) - 1], fontFamily: FONT.semibold, marginTop: i > 0 ? 4 : 0 }}
              />
            );
          case 'list':
            return (
              <View key={i} style={{ gap: 6 }}>
                {b.items.map((item, j) => (
                  <View key={j} style={{ flexDirection: 'row', paddingRight: 8 }}>
                    <Text style={[TYPE.body, { color: theme.inkMuted, width: b.ordered ? 28 : 20, fontVariant: ['tabular-nums'] }]}>
                      {b.ordered ? `${j + 1}.` : '•'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Inline text={item} theme={theme} />
                    </View>
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: theme.borderStrong, paddingLeft: 12 }}>
                <Inline text={b.text} theme={theme} style={{ color: theme.inkMuted }} />
              </View>
            );
          case 'table':
            return <Table key={i} head={b.head} rows={b.rows} align={b.align} theme={theme} />;
          case 'rule':
            return <View key={i} style={{ height: 1, backgroundColor: theme.border, marginVertical: 8 }} />;
          default:
            return <Inline key={i} text={b.text} theme={theme} />;
        }
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  inlineCode: { fontFamily: FONT.monoMedium, fontSize: 14, borderRadius: RADIUS.xs },
  code: { borderRadius: RADIUS.md, borderWidth: 1, overflow: 'hidden' },
  codeHeader: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 12, paddingRight: 4 },
  codeLang: { flex: 1, flexShrink: 1, marginRight: 4 },
  barAction: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 8, borderRadius: RADIUS.pill },
  barActionText: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  codeText: { ...TYPE.code, paddingHorizontal: 14, paddingVertical: 12 },
  live: { borderTopWidth: 1, overflow: 'hidden' },
  table: { borderWidth: 1, borderRadius: RADIUS.md, overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  tableCell: { flex: 1, minWidth: 96, maxWidth: 220, paddingHorizontal: 12, paddingVertical: 8 },
});
