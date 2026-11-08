import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RADIUS, TYPE, WIDE_BREAKPOINT, shadow, useTheme } from '../lib/theme';
import { Text } from './Text';
import { IconButton, PillButton, TextField } from './ui';

/** From 900px wide (iPad, desktop, web) sheets open as centred dialogs. */
export function useWideSheet(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}

/**
 * The design system's Sheet, drawn inside a transparent Modal (use `animationType="fade"`).
 * On phones it rises from the bottom: surface-raised, top radius 22, a grabber, the scrim behind.
 * From 900px it is a centred 440px dialog. Tapping the scrim or the Close button calls `onClose`.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  closeButton = true,
  keyboard,
  alert,
  children,
  style,
}: {
  title?: string;
  subtitle?: string;
  /** Omit (or pass undefined) while the sheet must stay open, e.g. during a send. */
  onClose?: () => void;
  closeButton?: boolean;
  /** Ride above the keyboard (sheets with a text field). */
  keyboard?: boolean;
  alert?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useWideSheet();
  const [rise] = useState(() => new Animated.Value(wide ? 0 : 1));

  useEffect(() => {
    Animated.timing(rise, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [rise]);

  const panel = (
    <Animated.View
      accessibilityRole={alert ? 'alert' : undefined}
      accessibilityViewIsModal
      style={[
        { backgroundColor: theme.surfaceRaised },
        shadow(theme, 'sheet'),
        wide ? styles.dialog : [styles.sheet, { paddingBottom: insets.bottom + 16 }],
        { transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, 600] }) }] },
        style,
      ]}
    >
      {!wide && <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />}
      {!!title && (
        <View style={styles.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[TYPE.headline, { color: theme.ink }]} numberOfLines={2} accessibilityRole="header">
              {title}
            </Text>
            {!!subtitle && (
              <Text style={[TYPE.caption, { color: theme.inkMuted, marginTop: 2 }]} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
          {closeButton && !!onClose && <IconButton name="x" label="Close" onPress={onClose} style={styles.close} />}
        </View>
      )}
      {children}
    </Animated.View>
  );

  const place = wide ? styles.center : styles.bottom;
  return (
    <View style={styles.fill}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}
        onPress={onClose}
        disabled={!onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      {keyboard ? (
        // The keyboard already covers the bottom inset, so subtract it to avoid a doubled gap.
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={wide ? 0 : -insets.bottom} style={place} pointerEvents="box-none">
          {panel}
        </KeyboardAvoidingView>
      ) : (
        <View style={place} pointerEvents="box-none">
          {panel}
        </View>
      )}
    </View>
  );
}

/** Cancel (secondary) beside the main action: equal halves on phones, right-aligned in a dialog. */
export function SheetActions({ children }: { children: ReactNode }) {
  const wide = useWideSheet();
  return <View style={[styles.actions, wide ? { justifyContent: 'flex-end' } : styles.actionsPhone]}>{children}</View>;
}

interface Props {
  visible: boolean;
  title: string;
  initialValue?: string;
  placeholder?: string;
  multiline?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/** Cross-platform replacement for the iOS-only Alert.prompt. */
export function TextPrompt(props: Props) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={props.onClose}>
      {/* Mounted only while open, so each opening starts from initialValue. */}
      {props.visible && <PromptBody {...props} />}
    </Modal>
  );
}

function PromptBody({ title, initialValue = '', placeholder, multiline, onSubmit, onClose }: Props) {
  const wide = useWideSheet();
  const [value, setValue] = useState(initialValue);

  const submit = () => {
    if (value.trim()) onSubmit(value.trim());
    onClose();
  };

  const size = wide ? 'md' : 'lg';
  return (
    <Sheet title={title} onClose={onClose} closeButton={false} keyboard>
      <TextField
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        accessibilityLabel={title}
        autoFocus
        multiline={multiline}
        onSubmitEditing={multiline ? undefined : submit}
        returnKeyType={multiline ? 'default' : 'done'}
        submitBehavior={multiline ? 'newline' : 'submit'}
        style={{ marginTop: 4 }}
      />
      <SheetActions>
        <PillButton title="Cancel" variant="secondary" size={size} onPress={onClose} style={!wide && { flex: 1 }} />
        <PillButton title="Save" size={size} onPress={submit} style={!wide && { flex: 1 }} />
      </SheetActions>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, paddingTop: 8, paddingHorizontal: 16, maxHeight: '90%' },
  dialog: { width: '100%', maxWidth: 440, maxHeight: '90%', borderRadius: RADIUS.lg, paddingTop: 20, paddingHorizontal: 24, paddingBottom: 24 },
  grabber: { width: 36, height: 5, borderRadius: RADIUS.pill, alignSelf: 'center', marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingTop: 4, paddingBottom: 12 },
  close: { marginTop: -10, marginRight: -10 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 20 },
  actionsPhone: { alignItems: 'stretch' },
});
