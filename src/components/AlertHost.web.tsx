import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AlertButton } from 'react-native';

import { useTheme } from '../lib/theme';

/**
 * react-native-web's Alert.alert does nothing, and the app relies on it for confirmations
 * ("Delete all chats?") and error messages. This replaces it with an in-app dialog.
 */
type Dialog = { title: string; message?: string; buttons: AlertButton[]; cancelable: boolean; onDismiss?: () => void };

const queue: Dialog[] = [];
let notify: (() => void) | null = null;

Alert.alert = (title, message, buttons, options) => {
  queue.push({
    title,
    message,
    buttons: buttons?.length ? buttons : [{ text: 'OK' }],
    cancelable: options?.cancelable ?? true,
    onDismiss: options?.onDismiss,
  });
  notify?.();
};

export function AlertHost() {
  const theme = useTheme();
  const [current, setCurrent] = useState<Dialog | null>(queue[0] ?? null);

  useEffect(() => {
    notify = () => setCurrent((c) => c ?? queue[0] ?? null);
    notify();
    return () => {
      notify = null;
    };
  }, []);

  if (!current) return null;

  const close = (button?: AlertButton) => {
    queue.shift();
    setCurrent(queue[0] ?? null);
    if (button) button.onPress?.();
    else current.onDismiss?.();
  };
  const cancel = current.buttons.find((b) => b.style === 'cancel');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => (cancel ? close(cancel) : current.cancelable && close())}>
      <Pressable style={styles.scrim} onPress={() => current.cancelable && (cancel ? close(cancel) : close())}>
        <Pressable style={[styles.box, { backgroundColor: theme.bg, borderColor: theme.border }]} onPress={() => {}} accessibilityRole="alert">
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>{current.title}</Text>
          {!!current.message && <Text style={{ color: theme.muted, fontSize: 14, marginTop: 8, textAlign: 'center' }}>{current.message}</Text>}
          <View style={[styles.buttons, current.buttons.length > 2 && { flexDirection: 'column' }]}>
            {current.buttons.map((b, i) => (
              <Pressable
                key={i}
                onPress={() => close(b)}
                style={({ hovered }: any) => [
                  styles.button,
                  { borderColor: theme.border, backgroundColor: hovered ? theme.surface2 : theme.surface },
                ]}
                accessibilityRole="button"
              >
                <Text
                  style={{
                    color: b.style === 'destructive' ? theme.danger : theme.text,
                    fontWeight: b.style === 'cancel' ? '400' : '600',
                    textAlign: 'center',
                  }}
                >
                  {b.text ?? 'OK'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(20,20,19,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { width: 340, maxWidth: '100%', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 18 },
  button: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
});
