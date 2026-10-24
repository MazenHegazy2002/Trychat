import { useMemo, useRef } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

export const TERM = { bg: '#141413', fg: '#E8E6DC', dim: '#9C9A92', err: '#F2B8B5', prompt: '#8FD18F' };
export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' });

const COLORS = ['#3D3D3A', '#F07178', '#A8D982', '#FFCB6B', '#82AAFF', '#C792EA', '#89DDFF', '#E8E6DC'];
const BRIGHT = ['#73726C', '#FF8B92', '#C3E88D', '#FFE08A', '#9CC4FF', '#DDB0F6', '#A6ECFF', '#FFFFFF'];

interface Span {
  text: string;
  color?: string;
  bold?: boolean;
}

/** Splits text on basic ANSI SGR codes (colors 30–37/90–97, bold, reset); other escapes are dropped. */
export function parseAnsi(input: string): Span[] {
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
      else if (code >= 30 && code <= 37) color = COLORS[code - 30];
      else if (code >= 90 && code <= 97) color = BRIGHT[code - 90];
    }
  }
  push(input.slice(last));
  return spans;
}

/** Dark monospace log that follows new output unless the user has scrolled up. */
export function TerminalLog({ text, style, children }: { text: string; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const ref = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  // Only the last part is colored; very long logs render the rest plain for speed.
  const spans = useMemo(() => parseAnsi(text.length > 60_000 ? text.slice(-60_000) : text), [text]);
  return (
    <ScrollView
      ref={ref}
      style={[{ flex: 1, backgroundColor: TERM.bg }, style]}
      contentContainerStyle={{ padding: 12 }}
      onScroll={(e) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 40;
      }}
      scrollEventThrottle={100}
      onContentSizeChange={() => atBottom.current && ref.current?.scrollToEnd({ animated: false })}
    >
      <Text selectable style={{ color: TERM.fg, fontFamily: MONO, fontSize: 12.5, lineHeight: 18 }}>
        {spans.map((s, i) => (
          <Text key={i} style={s.color || s.bold ? { color: s.color, fontWeight: s.bold ? '700' : undefined } : undefined}>
            {s.text}
          </Text>
        ))}
      </Text>
      {children}
    </ScrollView>
  );
}
