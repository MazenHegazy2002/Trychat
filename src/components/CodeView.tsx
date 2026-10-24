import { memo } from 'react';
import { FlatList, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DiffLine } from '../lib/workspace/core';

/** Monospace code with line numbers and light regex syntax highlighting (dark code palette). */

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' });
const C = { text: '#E8E6DC', num: '#6B6A65', kw: '#D97757', str: '#9FC27A', com: '#7D7B74', lit: '#E2B86B', bg: '#1F1E1D' };

const KW =
  /^(?:import|from|export|default|const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|interface|type|enum|async|await|try|catch|finally|throw|in|of|as|def|elif|lambda|pass|yield|with|public|private|protected|static|void|fn|pub|impl|struct|use|mod|match|package|func|go|defer)$/;
const TOKEN = /(\/\/.*$|#(?!!).*$|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\d_.xXa-fA-F]*\b|\b(?:true|false|null|undefined|None|True|False|nil)\b|\b[A-Za-z_$][\w$]*\b)/g;

function tokens(line: string, hashComments: boolean): { t: string; c: string }[] {
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
              : C.text;
    out.push({ t: s, c });
    last = i + s.length;
  }
  if (last < line.length) out.push({ t: line.slice(last), c: C.text });
  return out;
}

const hashLang = (path: string) => /\.(py|rb|sh|bash|zsh|ya?ml|toml|r|pl|conf|env)$|(^|\/)(Dockerfile|Makefile)$/i.test(path);

const Line = memo(function Line({ n, text, hash, width }: { n: number; text: string; hash: boolean; width: number }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.code, styles.num, { width }]}>{n}</Text>
      <Text style={styles.code}>{tokens(text, hash).map((k, i) => <Text key={i} style={{ color: k.c }}>{k.t}</Text>)}</Text>
    </View>
  );
});

export function CodeView({ text, path }: { text: string; path: string }) {
  const lines = text.split('\n');
  const width = String(lines.length).length * 8 + 12;
  const hash = hashLang(path);
  return (
    <ScrollView horizontal style={{ backgroundColor: C.bg }} contentContainerStyle={{ minWidth: '100%' }}>
      <FlatList
        data={lines}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index }) => <Line n={index + 1} text={item} hash={hash} width={width} />}
        initialNumToRender={60}
        windowSize={11}
        contentContainerStyle={{ paddingVertical: 8 }}
      />
    </ScrollView>
  );
}

export function DiffView({ lines }: { lines: (DiffLine | null)[] }) {
  return (
    <ScrollView horizontal style={{ backgroundColor: C.bg, borderRadius: 8 }} contentContainerStyle={{ minWidth: '100%', paddingVertical: 6 }}>
      <View>
        {lines.map((l, i) =>
          l ? (
            <View key={i} style={[styles.row, l.t === '+' ? { backgroundColor: 'rgba(80,160,80,0.22)' } : l.t === '-' ? { backgroundColor: 'rgba(200,70,60,0.25)' } : null]}>
              <Text style={[styles.code, styles.num, { width: 36 }]}>{l.a ?? ''}</Text>
              <Text style={[styles.code, styles.num, { width: 36 }]}>{l.b ?? ''}</Text>
              <Text style={[styles.code, { color: l.t === ' ' ? C.text : l.t === '+' ? '#B7E3A0' : '#F2B1A8' }]}>
                {l.t} {l.text}
              </Text>
            </View>
          ) : (
            <Text key={i} style={[styles.code, { color: C.num, paddingLeft: 8 }]}>⋯</Text>
          ),
        )}
      </View>
    </ScrollView>
  );
}

export const codeFont = mono;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingRight: 16 },
  code: { fontFamily: mono, fontSize: 12.5, lineHeight: 19, color: C.text },
  num: { color: C.num, textAlign: 'right', paddingRight: 10 },
});
