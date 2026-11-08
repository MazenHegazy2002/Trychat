import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, View } from 'react-native';
import type { AlertButton } from 'react-native';

import { TYPE, useTheme } from '../lib/theme';
import { Text } from './Text';
import { Sheet, useWideSheet } from './TextPrompt';
import { PillButton } from './ui';

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
  const wide = useWideSheet();
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

  // One primary at most: the last plain button. Cancel is secondary, destructive buttons are danger.
  const primary = current.buttons.reduce((last, b, i) => (b.style !== 'cancel' && b.style !== 'destructive' ? i : last), -1);
  const stacked = current.buttons.length > 2;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => (cancel ? close(cancel) : current.cancelable && close())}>
      <AlertBody
        title={current.title}
        message={current.message}
        onScrim={current.cancelable ? () => (cancel ? close(cancel) : close()) : undefined}
      >
        <View style={[styles.buttons, stacked ? styles.stacked : wide ? { justifyContent: 'flex-end' } : null]}>
          {current.buttons.map((b, i) => (
            <PillButton
              key={i}
              title={b.text ?? 'OK'}
              onPress={() => close(b)}
              variant={b.style === 'destructive' ? 'danger' : i === primary ? 'primary' : 'secondary'}
              size={wide || stacked ? 'md' : 'lg'}
              style={!wide && !stacked ? { flex: 1 } : undefined}
            />
          ))}
        </View>
      </AlertBody>
    </Modal>
  );
}

function AlertBody({ title, message, onScrim, children }: { title: string; message?: string; onScrim?: () => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Sheet title={title} onClose={onScrim} closeButton={false} alert>
      {!!message && (
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }}>
          <Text style={[TYPE.callout, { color: theme.inkMuted }]}>{message}</Text>
        </ScrollView>
      )}
      {children}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: 8, marginTop: 20 },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
});
