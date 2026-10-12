import * as Clipboard from 'expo-clipboard';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Markdown } from '../../components/Markdown';
import { ModelPicker } from '../../components/ModelPicker';
import { TextPrompt } from '../../components/TextPrompt';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import type { ChatMessage } from '../../lib/types';

const SUGGESTIONS = [
  'Build me a to-do list app',
  'Make a snake game I can play',
  'Remember that I prefer short answers',
  'Explain how APIs work, simply',
];

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useStore();
  const conv = store.conversations.find((c) => c.id === id);
  const busy = !!store.busy[id];
  const [input, setInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  if (!conv) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.muted }}>This chat no longer exists.</Text>
      </View>
    );
  }

  const model = conv.model || store.settings.model;
  const lastAssistantId = [...conv.messages].reverse().find((m) => m.role === 'assistant')?.id;

  const send = (text = input) => {
    if (!text.trim() || busy) return;
    setInput('');
    store.send(id, text);
  };

  const onMessageLongPress = (m: ChatMessage) => {
    Alert.alert('Message', undefined, [
      { text: 'Copy', onPress: () => Clipboard.setStringAsync(m.content) },
      ...(m.role === 'user' ? [{ text: 'Edit & resend', onPress: () => setInput(m.content) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.role === 'user') {
      return (
        <Pressable onLongPress={() => onMessageLongPress(item)} style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: theme.userBubble }]}>
            <Text selectable style={{ color: theme.onUserBubble, fontSize: 16, lineHeight: 22 }}>
              {item.content}
            </Text>
          </View>
        </Pressable>
      );
    }
    const streaming = busy && item.id === lastAssistantId;
    return (
      <Pressable onLongPress={() => onMessageLongPress(item)} style={styles.assistantRow}>
        {item.content ? <Markdown text={item.content} /> : null}
        {streaming && !item.content && <ActivityIndicator color={theme.muted} style={{ alignSelf: 'flex-start' }} />}
        {!!item.error && (
          <View style={[styles.error, { borderColor: theme.danger }]}>
            <Text style={{ color: theme.danger }}>{item.error}</Text>
            <Pressable onPress={() => store.regenerate(id)} hitSlop={8}>
              <Text style={{ color: theme.primary, fontWeight: '600', marginTop: 6 }}>Retry</Text>
            </Pressable>
          </View>
        )}
        {!streaming && !item.error && item.id === lastAssistantId && (
          <View style={styles.actions}>
            <Pressable onPress={() => Clipboard.setStringAsync(item.content)} hitSlop={8}>
              <Text style={{ color: theme.muted, fontSize: 13 }}>Copy</Text>
            </Pressable>
            <Pressable onPress={() => store.regenerate(id)} hitSlop={8}>
              <Text style={{ color: theme.muted, fontSize: 13 }}>Regenerate</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable onPress={() => setRenaming(true)} style={{ maxWidth: 220 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                {conv.title}
              </Text>
              <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 11 }}>
                {model || 'no model'}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => setPickerOpen(true)} hitSlop={8}>
              <Text style={{ color: theme.primary, fontSize: 15, fontWeight: '600' }}>Model</Text>
            </Pressable>
          ),
        }}
      />

      {conv.messages.length === 0 ? (
        <View style={[styles.center, { padding: 24 }]}>
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: '700', marginBottom: 6 }}>What should we build?</Text>
          <Text style={{ color: theme.muted, textAlign: 'center', marginBottom: 20 }}>
            Chat, ask for apps and games (tap ▶ Preview to run them), or tell me things to remember.
          </Text>
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              onPress={() => send(s)}
              style={[styles.suggestion, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text }}>{s}</Text>
            </Pressable>
          ))}
          {!model && (
            <Pressable onPress={() => router.push('/settings')} style={{ marginTop: 16 }}>
              <Text style={{ color: theme.danger }}>No model selected — open Settings</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          inverted
          data={[...conv.messages].reverse()}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={{ paddingVertical: 12 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />
      )}

      <View
        style={[
          styles.composer,
          { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: theme.bg },
        ]}
      >
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Message"
          placeholderTextColor={theme.muted}
          multiline
          style={[styles.input, { backgroundColor: theme.surface, color: theme.text }]}
        />
        {busy ? (
          <Pressable onPress={() => store.stop(id)} style={[styles.sendBtn, { backgroundColor: theme.danger }]}>
            <Text style={styles.sendIcon}>■</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => send()}
            disabled={!input.trim()}
            style={[styles.sendBtn, { backgroundColor: input.trim() ? theme.primary : theme.border }]}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        )}
      </View>

      <ModelPicker
        visible={pickerOpen}
        selected={model}
        onSelect={(m) => store.setConversationModel(id, m)}
        onClose={() => setPickerOpen(false)}
      />
      <TextPrompt
        visible={renaming}
        title="Rename chat"
        initialValue={conv.title}
        onSubmit={(t) => store.renameConversation(id, t)}
        onClose={() => setRenaming(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  userRow: { alignItems: 'flex-end', paddingHorizontal: 12, marginVertical: 6 },
  userBubble: { maxWidth: '85%', borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 9 },
  assistantRow: { paddingHorizontal: 16, marginVertical: 8 },
  error: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 8 },
  suggestion: { width: '100%', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 140, minHeight: 42, borderRadius: 21, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '800' },
});
