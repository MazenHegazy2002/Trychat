import { Platform, useColorScheme } from 'react-native';

// Claude-style palette: warm ivory ground, Slate text, Clay accent, warm grays.
const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' });

const light = {
  bg: '#FAF9F5',
  surface: '#FFFFFF',
  surface2: '#F0EEE6',
  border: 'rgba(31,30,29,0.15)',
  text: '#141413',
  muted: '#5E5D59',
  primary: '#B5532F', // Clay, darkened for text contrast
  accent: '#D97757', // Clay for icon fills
  onPrimary: '#FFFFFF',
  userBubble: '#F0EEE6',
  onUserBubble: '#141413',
  codeBg: '#1F1E1D',
  codeText: '#E8E6DC',
  danger: '#B3261E',
  serif,
};

const dark: typeof light = {
  bg: '#262624',
  surface: '#30302E',
  surface2: '#1F1E1D',
  border: 'rgba(250,249,245,0.12)',
  text: '#F5F4ED',
  muted: '#C2C0B6',
  primary: '#E8957A',
  accent: '#D97757',
  onPrimary: '#141413',
  userBubble: '#141413',
  onUserBubble: '#F5F4ED',
  codeBg: '#1F1E1D',
  codeText: '#E8E6DC',
  danger: '#F2B8B5',
  serif,
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
