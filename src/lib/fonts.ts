import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_400Regular_Italic } from '@expo-google-fonts/geist/400Regular_Italic';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_600SemiBold_Italic } from '@expo-google-fonts/geist/600SemiBold_Italic';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { GeistMono_600SemiBold } from '@expo-google-fonts/geist-mono/600SemiBold';
import { useFonts } from 'expo-font';

import { FONT } from './theme';

/**
 * Loads Geist and Geist Mono (SIL Open Font License), one family per weight. Only the weights the
 * interface uses are bundled. Resolves to true once the fonts are in, or once loading failed, in
 * which case text falls back to the system font rather than keeping the app from starting.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    [FONT.regular]: Geist_400Regular,
    [FONT.italic]: Geist_400Regular_Italic,
    [FONT.medium]: Geist_500Medium,
    [FONT.semibold]: Geist_600SemiBold,
    [FONT.semiboldItalic]: Geist_600SemiBold_Italic,
    [FONT.mono]: GeistMono_400Regular,
    [FONT.monoMedium]: GeistMono_500Medium,
    [FONT.monoSemibold]: GeistMono_600SemiBold,
  });
  if (error) console.warn('[fonts] Geist failed to load; using the system font', error);
  return loaded || !!error;
}
