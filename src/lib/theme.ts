import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

/**
 * TryChat design tokens ("Dark & modern"): charcoal grounds in four steps, Geist type and one
 * Ember accent kept for the few things that matter. Dark is the default; light uses the same
 * names with their light values. See the TryChat design system for the rules behind each token.
 */

/** Font family names as loaded by `useAppFonts` (one family per weight, so every platform matches). */
export const FONT = {
  regular: 'Geist_400Regular',
  italic: 'Geist_400Regular_Italic',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  semiboldItalic: 'Geist_600SemiBold_Italic',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
  monoSemibold: 'GeistMono_600SemiBold',
} as const;

const dark = {
  dark: true,
  // Grounds: bg for screens, surface for grouped content, surfaceRaised for floating things, fill for inputs and chips.
  bg: '#0A0A0B',
  surface: '#141416',
  surfaceRaised: '#1C1C20',
  fill: '#26262B',
  border: '#2C2C32',
  borderStrong: '#72727C',
  // Text
  ink: '#F4F4F5',
  inkMuted: '#A1A1AA',
  inkFaint: '#8E8E98',
  // Ember
  accent: '#FF7A45',
  accentHover: '#FF8F63',
  accentPress: '#F26A33',
  onAccent: '#170A04',
  accentSoft: '#2A1710',
  glow: '#FF7A4559',
  focusRing: '#FF7A45',
  // Status (always with a word or an icon)
  success: '#38C9E8',
  successSoft: '#0C2A31',
  danger: '#FF6166',
  dangerSoft: '#2D1315',
  warning: '#F5C451',
  warningSoft: '#2B230D',
  // Chat and code
  userBubble: '#232327',
  codeBg: '#111114',
  codeInk: '#E4E4E7',
  syntaxKeyword: '#FF8F63',
  syntaxString: '#9FE2BF',
  syntaxNumber: '#F5C451',
  syntaxFunction: '#8AB4FF',
  syntaxComment: '#8E8E98',
  codeOk: '#38C9E8',
  codeError: '#FF6166',
  scrim: '#000000A6',
  // Depth: only floating things get a shadow.
  shadowRaised: '0px 8px 24px #00000080',
  shadowSheet: '0px -12px 40px #000000B3',
  shadowGlow: '0px 0px 0px 1px #FF7A4573, 0px 6px 20px #FF7A454D',

  // Older names, kept so every screen picks up the new look.
  surface2: '#26262B',
  text: '#F4F4F5',
  muted: '#A1A1AA',
  faint: '#8E8E98',
  primary: '#FF7A45',
  onPrimary: '#170A04',
  onUserBubble: '#F4F4F5',
  codeText: '#E4E4E7',
  oat: '#26262B',
  serif: FONT.semibold as string,
};

export type Theme = typeof dark;

const light: Theme = {
  dark: false,
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  fill: '#F1F1F3',
  border: '#E4E4E7',
  borderStrong: '#8A8A93',
  ink: '#18181B',
  inkMuted: '#52525B',
  inkFaint: '#6B6B74',
  accent: '#C2410C',
  accentHover: '#A8380A',
  accentPress: '#8F2F08',
  onAccent: '#FFFFFF',
  accentSoft: '#FDEDE5',
  glow: '#C2410C33',
  focusRing: '#C2410C',
  success: '#0B7285',
  successSoft: '#E3F6F9',
  danger: '#C8202F',
  dangerSoft: '#FDECEE',
  warning: '#8A5A00',
  warningSoft: '#FDF6E3',
  userBubble: '#F1F1F3',
  codeBg: '#111114',
  codeInk: '#E4E4E7',
  syntaxKeyword: '#FF8F63',
  syntaxString: '#9FE2BF',
  syntaxNumber: '#F5C451',
  syntaxFunction: '#8AB4FF',
  syntaxComment: '#8E8E98',
  codeOk: '#38C9E8',
  codeError: '#FF6166',
  scrim: '#18181B66',
  shadowRaised: '0px 8px 24px #18181B14',
  shadowSheet: '0px -12px 40px #18181B26',
  shadowGlow: '0px 6px 16px #C2410C40',

  surface2: '#F1F1F3',
  text: '#18181B',
  muted: '#52525B',
  faint: '#6B6B74',
  primary: '#C2410C',
  onPrimary: '#FFFFFF',
  onUserBubble: '#18181B',
  codeText: '#E4E4E7',
  oat: '#F1F1F3',
  serif: FONT.semibold,
};

export const THEMES = { dark, light };

/** Type scale. Use `TYPE.x` in a style (`[TYPE.callout, { color: theme.ink }]`). Never 700. */
export const TYPE = {
  display: { fontFamily: FONT.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  title: { fontFamily: FONT.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  headline: { fontFamily: FONT.semibold, fontSize: 17, lineHeight: 24, letterSpacing: -0.1 },
  body: { fontFamily: FONT.regular, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: FONT.regular, fontSize: 15, lineHeight: 21 },
  subhead: { fontFamily: FONT.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: FONT.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.8, textTransform: 'uppercase' },
  code: { fontFamily: FONT.mono, fontSize: 13, lineHeight: 20 },
  codeLabel: { fontFamily: FONT.monoMedium, fontSize: 12, lineHeight: 16 },
} satisfies Record<string, TextStyle>;

export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 12: 48 } as const;
export const RADIUS = { xs: 6, sm: 10, md: 14, lg: 22, pill: 999 } as const;
export const SIZE = { controlSm: 36, controlMd: 44, controlLg: 52, sidebar: 300, contentMax: 760 } as const;
/** From this width (iPad, Mac, Windows, web) the chat list becomes a sidebar beside the open chat. */
export const WIDE_BREAKPOINT = 900;

/** `boxShadow` styles for floating things (composer, menus, sheets) and the Ember glow. */
export function shadow(theme: Theme, kind: 'raised' | 'sheet' | 'glow'): ViewStyle {
  const value = kind === 'raised' ? theme.shadowRaised : kind === 'sheet' ? theme.shadowSheet : theme.shadowGlow;
  return { boxShadow: value } as ViewStyle;
}

// ---------- Appearance preference (Dark by default) ----------

export type AppearancePref = 'dark' | 'light' | 'system';

const APPEARANCE_KEY = 'trychat.appearance';
let appearance: AppearancePref = 'dark';
const listeners = new Set<() => void>();

function applyNativeScheme(pref: AppearancePref) {
  if (Platform.OS === 'web') return;
  try {
    // Alerts, the keyboard and other system views follow the app's choice, not just our own views.
    Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
  } catch {
    // Older runtimes without an app-level override: only our own views change.
  }
}

export function getAppearance(): AppearancePref {
  return appearance;
}

export function setAppearance(pref: AppearancePref) {
  appearance = pref;
  applyNativeScheme(pref);
  listeners.forEach((l) => l());
  AsyncStorage.setItem(APPEARANCE_KEY, pref).catch(() => {});
}

/** Reads the saved choice once at startup; the app renders after this settles. */
export async function loadAppearance(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(APPEARANCE_KEY);
    if (saved === 'dark' || saved === 'light' || saved === 'system') appearance = saved;
  } catch {
    // Keep the default.
  }
  applyNativeScheme(appearance);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppearance(): AppearancePref {
  return useSyncExternalStore(subscribe, getAppearance, getAppearance);
}

export function useTheme(): Theme {
  const pref = useAppearance();
  const system = useColorScheme();
  if (pref === 'light') return light;
  if (pref === 'dark') return dark;
  return system === 'light' ? light : dark;
}
