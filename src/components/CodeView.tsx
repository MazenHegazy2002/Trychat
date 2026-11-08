import { memo, useMemo } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';

import { FONT, RADIUS, TYPE, useTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';
import type { DiffLine } from '../lib/workspace/core';
import { Text } from './Text';

/** Monospace code with line numbers and light regex syntax highlighting, on `codeBg` in both themes. */

const KW =
  /^(?:import|from|export|default|const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|interface|type|enum|async|await|try|catch|finally|throw|in|of|as|def|elif|lambda|pass|yield|with|public|private|protected|static|void|fn|pub|impl|struct|use|mod|match|package|func|go|defer)$/;
const TOKEN = /(\/\/.*$|#(?!!).*$|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\d_.xXa-fA-F]*\b|\b(?:true|false|null|undefined|None|True|False|nil)\b|\b[A-Za-z_$][\w$]*\b)/g;

/** Syntax colours from the theme (the same in both themes, since code always sits on `codeBg`). */
export interface CodePalette {
  text: string;
  num: string;
  kw: string;
  str: string;
  com: string;
  lit: string;
  fn: string;
}

export function codePalette(theme: Theme): CodePalette {
  return {
    text: theme.codeInk,
    num: theme.syntaxComment,
    kw: theme.syntaxKeyword,
    str: theme.syntaxString,
    com: theme.syntaxComment,
    lit: theme.syntaxNumber,
    fn: theme.syntaxFunction,
  };
}

/** One line split into coloured runs. `hashComments` treats "# …" as a comment (Python, shell, YAML…). */
export function highlightLine(line: string, hashComments: boolean, C: CodePalette): { t: string; c: string }[] {
  const out: { t: string; c: string }[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const s = m[0];
    const i = m.index ?? 0;
    if (s[0] === '#' && !hashComments) continue;
    if (i > last) out.push({ t: line.slice(last, i), c: C.text });
    const c =
      s.startsWith('//') || s.startsWith('/*') || s[0] === '#'
        ? C.com
        : /^["'`]/.test(s)
          ? C.str
          : /^\d/.test(s) || /^(true|false|null|undefined|None|True|False|nil)$/.test(s)
            ? C.lit
            : KW.test(s)
              ? C.kw
              : line[i + s.length] === '('
                ? C.fn
                : C.text;
    out.push({ t: s, c });
    last = i + s.length;
  }
  if (last < line.length) out.push({ t: line.slice(last), c: C.text });
  return out;
}

const hashLang = (path: string) => /\.(py|rb|sh|bash|zsh|ya?ml|toml|r|pl|conf|env)$|(^|\/)(Dockerfile|Makefile)$/i.test(path);

/** Whether a fenced code block's language uses "#" comments. */
export const hashLangName = (lang: string) =>
  /^(py|python3?|rb|ruby|sh|bash|zsh|shell|console|ya?ml|toml|r|pl|perl|conf|ini|env|dockerfile|makefile|ps1|powershell|elixir|ex|nim|coffee)$/i.test(lang);

const Line = memo(function Line({ n, text, hash, width, C }: { n: number; text: string; hash: boolean; width: number; C: CodePalette }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.code, { color: C.num, width }, styles.num]}>{n}</Text>
      <Text style={[styles.code, { color: C.text }]}>
        {highlightLine(text, hash, C).map((k, i) => (
          <Text key={i} style={{ color: k.c }}>
            {k.t}
          </Text>
        ))}
      </Text>
    </View>
  );
});

export function CodeView({ text, path }: { text: string; path: string }) {
  const theme = useTheme();
  const C = useMemo(() => codePalette(theme), [theme]);
  const lines = text.split('\n');
  const width = String(lines.length).length * 8 + 12;
  const hash = hashLang(path);
  return (
    <ScrollView horizontal style={{ backgroundColor: theme.codeBg }} contentContainerStyle={{ minWidth: '100%' }}>
      <FlatList
        data={lines}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index }) => <Line n={index + 1} text={item} hash={hash} width={width} C={C} />}
        initialNumToRender={60}
        windowSize={11}
        contentContainerStyle={{ paddingVertical: 8 }}
      />
    </ScrollView>
  );
}

export function DiffView({ lines }: { lines: (DiffLine | null)[] }) {
  const theme = useTheme();
  // Tints of the output colours (hex alpha), so added/removed lines read on the dark code ground in both themes.
  const added = `${theme.codeOk}24`;
  const removed = `${theme.codeError}29`;
  return (
    <ScrollView
      horizontal
      style={{ backgroundColor: theme.codeBg, borderRadius: RADIUS.sm }}
      contentContainerStyle={{ minWidth: '100%', paddingVertical: 6 }}
    >
      <View>
        {lines.map((l, i) =>
          l ? (
            <View key={i} style={[styles.row, l.t === '+' ? { backgroundColor: added } : l.t === '-' ? { backgroundColor: removed } : null]}>
              <Text style={[styles.code, styles.num, { color: theme.syntaxComment, width: 36 }]}>{l.a ?? ''}</Text>
              <Text style={[styles.code, styles.num, { color: theme.syntaxComment, width: 36 }]}>{l.b ?? ''}</Text>
              <Text style={[styles.code, { color: l.t === ' ' ? theme.codeInk : l.t === '+' ? theme.codeOk : theme.codeError }]}>
                {l.t} {l.text}
              </Text>
            </View>
          ) : (
            <Text key={i} style={[styles.code, { color: theme.syntaxComment, paddingLeft: 8 }]}>
              ⋯
            </Text>
          ),
        )}
      </View>
    </ScrollView>
  );
}

export const codeFont = FONT.mono;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingRight: 16 },
  code: { ...TYPE.code },
  num: { textAlign: 'right', paddingRight: 10 },
});
