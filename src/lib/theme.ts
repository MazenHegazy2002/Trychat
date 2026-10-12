import { useColorScheme } from 'react-native';

const light = {
  bg: '#FFFFFF',
  surface: '#F3F4F6',
  border: '#E5E7EB',
  text: '#111827',
  muted: '#6B7280',
  primary: '#4F46E5',
  onPrimary: '#FFFFFF',
  userBubble: '#4F46E5',
  onUserBubble: '#FFFFFF',
  codeBg: '#0F172A',
  codeText: '#E2E8F0',
  danger: '#DC2626',
};

const dark: typeof light = {
  bg: '#0B0F17',
  surface: '#161B26',
  border: '#262D3B',
  text: '#F3F4F6',
  muted: '#9CA3AF',
  primary: '#818CF8',
  onPrimary: '#0B0F17',
  userBubble: '#4F46E5',
  onUserBubble: '#FFFFFF',
  codeBg: '#05080F',
  codeText: '#E2E8F0',
  danger: '#F87171',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
