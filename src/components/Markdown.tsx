import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';

import { isPreviewable, previewVerb, setPreview } from '../lib/preview';
import { useTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';

type Block =
  | { type: 'code'; lang: string; code: string; closed: boolean }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'rule' }
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

function Inline({ text, style, theme }: { text: string; style?: TextStyle; theme: Theme }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*)/g);
  return (
    <Text style={[{ color: theme.text, fontSize: 16, lineHeight: 23 }, style]} selectable>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`') && p.length > 1)
          return (
            <Text key={i} style={{ fontFamily: 'monospace', backgroundColor: theme.surface, fontSize: 14 }}>
              {p.slice(1, -1)}
            </Text>
          );
        if ((p.startsWith('**') || p.startsWith('__')) && p.length > 4)
          return (
            <Text key={i} style={{ fontWeight: '700' }}>
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

function CodeBlock({ lang, code, closed, theme }: { lang: string; code: string; closed: boolean; theme: Theme }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const preview = () => {
    setPreview(code, lang);
    router.push('/preview');
  };
  return (
    <View style={[styles.code, { backgroundColor: theme.codeBg }]}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLang}>{lang || 'code'}</Text>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          {closed && isPreviewable(lang) && (
            <Pressable onPress={preview} hitSlop={8}>
              <Text style={[styles.codeAction, { color: '#A5B4FC' }]}>▶ {previewVerb(lang)}</Text>
            </Pressable>
          )}
          <Pressable onPress={copy} hitSlop={8}>
            <Text style={styles.codeAction}>{copied ? 'Copied ✓' : 'Copy'}</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.codeText, { color: theme.codeText }]}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  const blocks = parseBlocks(text);
  return (
    <View style={{ gap: 8 }}>
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
                style={{ fontWeight: '700', fontSize: [24, 21, 19, 17, 16, 16][b.level - 1], lineHeight: 30 }}
              />
            );
          case 'list':
            return (
              <View key={i} style={{ gap: 4 }}>
                {b.items.map((item, j) => (
                  <View key={j} style={{ flexDirection: 'row', paddingRight: 8 }}>
                    <Text style={{ color: theme.muted, width: 24, fontSize: 16, lineHeight: 23 }}>
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
              <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: theme.border, paddingLeft: 10 }}>
                <Inline text={b.text} theme={theme} style={{ color: theme.muted }} />
              </View>
            );
          case 'rule':
            return <View key={i} style={{ height: 1, backgroundColor: theme.border, marginVertical: 4 }} />;
          default:
            return <Inline key={i} text={b.text} theme={theme} />;
        }
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  code: { borderRadius: 10, overflow: 'hidden' },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  codeLang: { color: '#94A3B8', fontSize: 12, fontFamily: 'monospace' },
  codeAction: { color: '#CBD5E1', fontSize: 12, fontWeight: '600' },
  codeText: { fontFamily: 'monospace', fontSize: 13, lineHeight: 19, padding: 12 },
});
