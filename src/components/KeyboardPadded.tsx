import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';

/**
 * A flex:1 container whose bottom padding follows the keyboard, so what sits at its bottom (a composer, a prompt
 * bar, an editor) stays just above the keyboard. Use it as the root of a screen that reaches the bottom edge of the
 * window; `bottomInset` is the space its content already keeps there (the safe area), which the keyboard covers.
 *
 * Unlike KeyboardAvoidingView it doesn't work out where the view sits in the window (that comes out short on
 * Android edge-to-edge and under a header, leaving the input behind the keyboard): the keyboard's height is all
 * it needs.
 */
export function KeyboardPadded({ bottomInset = 0, style, children }: { bottomInset?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { height } = useReanimatedKeyboardAnimation(); // 0 when closed, -keyboard height when open
  const padding = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, -height.value - bottomInset) }), [bottomInset]);
  return <Reanimated.View style={[{ flex: 1 }, style, padding]}>{children}</Reanimated.View>;
}
