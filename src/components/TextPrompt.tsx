import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../lib/theme';

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
export function TextPrompt({ visible, title, initialValue = '', placeholder, multiline, onSubmit, onClose }: Props) {
  const theme = useTheme();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const submit = () => {
    if (value.trim()) onSubmit(value.trim());
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.bg }]}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 12 }}>{title}</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={theme.muted}
            autoFocus
            multiline={multiline}
            onSubmitEditing={multiline ? undefined : submit}
            style={[
              styles.input,
              { backgroundColor: theme.surface, color: theme.text, minHeight: multiline ? 90 : undefined },
            ]}
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={{ color: theme.muted, fontSize: 16 }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} hitSlop={8}>
              <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '700' }}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  card: { borderRadius: 14, padding: 18 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 16 },
});
