import { useMemo, useRef } from 'react';
import { ScrollView } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { RADIUS, THEMES, TYPE, useTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';
import { Text } from './Text';

/**
 * Terminal palette. Code surfaces are `codeBg` in both themes, so everything on them uses the code
 * tokens (and the dark theme's ink for the brightest text, which stays readable on `codeBg`).
 */
export function terminalColors(theme: Theme) {
  return {
    bg: theme.codeBg,
    fg: theme.codeInk,
    bright: THEMES.dark.ink,
    dim: theme.syntaxComment,
    ok: theme.codeOk,
    err: theme.codeError,
    warn: THEMES.dark.warning,
    prompt: theme.syntaxKeyword,
    border: THEMES.dark.border,
  };
}

/** ANSI colours mapped onto the code palette (black, red, green, yellow, blue, magenta, cyan, white), then bright white. */
function ansiColors(theme: Theme): string[] {
  const t = terminalColors(theme);
  return [t.dim, t.err, t.ok, t.warn, theme.syntaxFunction, theme.syntaxKeyword, t.ok, t.fg, t.bright];
}

interface Span {
  text: string;
  color?: string;
  bold?: boolean;
}

/** Splits text on basic ANSI SGR codes (colors 30–37/90–97, bold, reset); other escapes are dropped. */
export function parseAnsi(input: string, palette: string[] = ansiColors(THEMES.dark)): Span[] {
  const spans: Span[] = [];
  let color: string | undefined;
  let bold = false;
  const re = /\x1b\[([\d;]*)([A-Za-z])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string) => {
    text = text.replace(/\x1b\][^\x07]*\x07|\r(?!\n)/g, '');
    if (text) spans.push({ text, color, bold });
  };
  while ((m = re.exec(input))) {
    push(input.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] !== 'm') continue;
    for (const code of (m[1] || '0').split(';').map(Number)) {
      if (code === 0) {
        color = undefined;
        bold = false;
      } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = undefined;
      else if (code >= 30 && code <= 37) color = palette[code - 30];
      else if (code >= 90 && code <= 97) color = code === 97 ? (palette[8] ?? palette[7]) : palette[code - 90];
    }
  }
  push(input.slice(last));
  return spans;
}

/** Colour for an uncoloured line, from what it looks like: a prompt, a note, success, an error or a warning. */
function lineColor(line: string, theme: Theme): string | undefined {
  const t = terminalColors(theme);
  const s = line.trimStart();
  if (/^(\S*\s)?\$\s/.test(s) || s.startsWith('$ ')) return t.bright;
  if (/^(>|#|…\[earlier output trimmed\]…)/.test(s)) return t.dim;
  if (/^(✓|✔|√)|\b(passed|succeeded|success)\b/i.test(s) && !/\bfail/i.test(s)) return t.ok;
  if (/^(✕|✗|×)|^(error|fatal|err!)\b|\bfailed\b|\bexception\b/i.test(s)) return t.err;
  if (/^(\(!\)|⚠)|^warn(ing)?\b/i.test(s)) return t.warn;
  return undefined;
}

/** Splits plain spans into lines so each uncoloured line can pick up its own colour. */
function colourLines(spans: Span[], theme: Theme): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (s.color) {
      out.push(s);
      continue;
    }
    for (const part of s.text.split(/(?<=\n)/)) {
      if (part) out.push({ ...s, text: part, color: lineColor(part, theme) });
    }
  }
  return out;
}

/** Monospace log on `codeBg` that follows new output unless the user has scrolled up. */
export function TerminalLog({ text, style, children }: { text: string; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const theme = useTheme();
  const t = terminalColors(theme);
  const ref = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  // Only the last part is colored; very long logs render the rest plain for speed.
  const spans = useMemo(
    () => colourLines(parseAnsi(text.length > 60_000 ? text.slice(-60_000) : text, ansiColors(theme)), theme),
    [text, theme],
  );
  return (
    <ScrollView
      ref={ref}
      style={[{ flex: 1, backgroundColor: t.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border }, style]}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
      onScroll={(e) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 40;
      }}
      scrollEventThrottle={100}
      onContentSizeChange={() => atBottom.current && ref.current?.scrollToEnd({ animated: false })}
    >
      <Text selectable style={[TYPE.code, { color: t.fg }]}>
        {spans.map((s, i) => (
          <Text key={i} style={s.color || s.bold ? { color: s.color, fontWeight: s.bold ? '600' : undefined } : undefined}>
            {s.text}
          </Text>
        ))}
      </Text>
      {children}
    </ScrollView>
  );
}
