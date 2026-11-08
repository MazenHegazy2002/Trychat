import { createContext, forwardRef, useContext } from 'react';
import type { ComponentRef } from 'react';
import { Platform, StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';
import type { TextInputProps, TextProps, TextStyle } from 'react-native';

import { FONT, useTheme } from '../lib/theme';

/**
 * `Text` and `TextInput` that set in Geist (and Geist Mono for code) on every platform.
 *
 * Each weight is its own font family (see `FONT`), so the weight a style asks for is turned into the
 * matching family and `fontWeight` is reset; nested text inherits its parent's face unless it asks
 * for another weight, style or family. 700 and bold map to 600: the interface never goes above it.
 */

type Kind = 'sans' | 'mono';
type Weight = 400 | 500 | 600;
interface Face {
  kind: Kind;
  weight: Weight;
  italic: boolean;
}

const KNOWN: Record<string, Face> = {
  [FONT.regular]: { kind: 'sans', weight: 400, italic: false },
  [FONT.italic]: { kind: 'sans', weight: 400, italic: true },
  [FONT.medium]: { kind: 'sans', weight: 500, italic: false },
  [FONT.semibold]: { kind: 'sans', weight: 600, italic: false },
  [FONT.semiboldItalic]: { kind: 'sans', weight: 600, italic: true },
  [FONT.mono]: { kind: 'mono', weight: 400, italic: false },
  [FONT.monoMedium]: { kind: 'mono', weight: 500, italic: false },
  [FONT.monoSemibold]: { kind: 'mono', weight: 600, italic: false },
};

const FaceContext = createContext<Face | null>(null);

function weightOf(w: TextStyle['fontWeight']): Weight | undefined {
  if (w == null) return undefined;
  const n = w === 'bold' ? 700 : w === 'normal' ? 400 : typeof w === 'number' ? w : Number(w);
  if (!Number.isFinite(n)) return undefined;
  return n >= 600 ? 600 : n >= 500 ? 500 : 400;
}

/** The kind of an explicit family, or 'other' for a family we leave alone (an icon font, say). */
function kindOf(family: string): Kind | 'other' {
  if (family.startsWith('GeistMono')) return 'mono';
  if (family.startsWith('Geist')) return 'sans';
  if (/mono|menlo|courier|consol/i.test(family)) return 'mono';
  if (/serif|georgia|system|sans|helvetica|arial|inter|roboto/i.test(family)) return 'sans';
  return 'other';
}

export function familyFor({ kind, weight, italic }: Face): string {
  if (kind === 'mono') return weight === 600 ? FONT.monoSemibold : weight === 500 ? FONT.monoMedium : FONT.mono;
  if (italic) return weight === 600 ? FONT.semiboldItalic : FONT.italic;
  return weight === 600 ? FONT.semibold : weight === 500 ? FONT.medium : FONT.regular;
}

/** The face this text should use, or null to leave the style as it is (inherit, or a foreign font). */
function resolveFace(style: TextStyle | undefined, parent: Face | null): Face | null {
  const family = typeof style?.fontFamily === 'string' ? style.fontFamily : undefined;
  const known = family ? KNOWN[family] : undefined;
  const kind = known?.kind ?? (family ? kindOf(family) : undefined);
  if (kind === 'other') return null;
  const weight = weightOf(style?.fontWeight);
  const italic = style?.fontStyle === 'italic' ? true : style?.fontStyle === 'normal' ? false : undefined;
  if (parent && !family && weight === undefined && italic === undefined) return null;
  return {
    kind: kind ?? parent?.kind ?? 'sans',
    weight: weight ?? known?.weight ?? parent?.weight ?? 400,
    italic: italic ?? known?.italic ?? parent?.italic ?? false,
  };
}

function faceStyle(face: Face): TextStyle {
  return { fontFamily: familyFor(face), fontWeight: 'normal', fontStyle: 'normal' };
}

/** The instance type, like React Native's own Text. */
export type Text = RNText;
// eslint-disable-next-line @typescript-eslint/no-redeclare -- value and type share the name on purpose
export const Text = forwardRef<ComponentRef<typeof RNText>, TextProps>(function Text({ style, ...rest }, ref) {
  const parent = useContext(FaceContext);
  const face = resolveFace(StyleSheet.flatten(style), parent);
  const text = <RNText ref={ref} {...rest} style={face ? [style, faceStyle(face)] : style} />;
  return face ? <FaceContext.Provider value={face}>{text}</FaceContext.Provider> : text;
});

/** The instance type, like React Native's own TextInput. */
export type TextInput = RNTextInput;
// eslint-disable-next-line @typescript-eslint/no-redeclare -- value and type share the name on purpose
export const TextInput = forwardRef<ComponentRef<typeof RNTextInput>, TextInputProps>(function TextInput(
  { style, placeholderTextColor, selectionColor, cursorColor, selectionHandleColor, keyboardAppearance, ...rest },
  ref,
) {
  const theme = useTheme();
  const face = resolveFace(StyleSheet.flatten(style), null);
  return (
    <RNTextInput
      ref={ref}
      {...rest}
      placeholderTextColor={placeholderTextColor ?? theme.inkFaint}
      // iOS tints the caret with this colour too, so it stays solid there.
      selectionColor={selectionColor ?? (Platform.OS === 'ios' ? theme.accent : theme.glow)}
      cursorColor={cursorColor ?? theme.accent}
      selectionHandleColor={selectionHandleColor ?? theme.accent}
      keyboardAppearance={keyboardAppearance ?? (theme.dark ? 'dark' : 'light')}
      style={face ? [style, faceStyle(face)] : style}
    />
  );
});
