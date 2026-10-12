import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextPrompt } from '../components/TextPrompt';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString();
}

export default function ConversationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { conversations, settings, memories, createConversation, deleteConversation, renameConversation } =
    useStore();
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  const q = query.toLowerCase();
  const list = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)));

  const needsSetup = !settings.apiKey || !settings.model;

  const newChat = () => {
    const conv = createConversation();
    router.push(`/chat/${conv.id}`);
  };

  const onLongPress = (id: string, title: string) => {
    Alert.alert(title, undefined, [
      { text: 'Rename', onPress: () => setRenaming({ id, title }) },
      { text: 'Delete', style: 'destructive', onPress: () => deleteConversation(id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <Pressable onPress={() => router.push('/memory')} hitSlop={8}>
                <Text style={{ color: theme.primary, fontSize: 15, fontWeight: '600' }}>Memory ({memories.length})</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/settings')} hitSlop={8}>
                <Text style={{ color: theme.primary, fontSize: 15, fontWeight: '600' }}>Settings</Text>
              </Pressable>
            </View>
          ),
        }}
      />

      {needsSetup && (
        <Pressable
          onPress={() => router.push('/settings')}
          style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.primary }]}
        >
          <Text style={{ color: theme.text, fontWeight: '600' }}>Finish setup</Text>
          <Text style={{ color: theme.muted, marginTop: 2 }}>
            {!settings.apiKey ? 'Add your API key' : 'Pick a model'} in Settings to start chatting.
          </Text>
        </Pressable>
      )}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search chats"
        placeholderTextColor={theme.muted}
        style={[styles.search, { backgroundColor: theme.surface, color: theme.text }]}
      />

      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={
          <Text style={{ color: theme.muted, textAlign: 'center', marginTop: 48, fontSize: 15 }}>
            {query ? 'No matching chats.' : 'No chats yet. Start one below.'}
          </Text>
        }
        renderItem={({ item }) => {
          const last = [...item.messages].reverse().find((m) => !m.toolResult && m.content);
          return (
            <Pressable
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => onLongPress(item.id, item.title)}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: theme.border, backgroundColor: pressed ? theme.surface : 'transparent' },
              ]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>{timeAgo(item.updatedAt)}</Text>
              </View>
              <Text style={{ color: theme.muted, marginTop: 3 }} numberOfLines={1}>
                {last ? last.content.replace(/\s+/g, ' ') : 'Empty chat'}
              </Text>
            </Pressable>
          );
        }}
      />

      <TextPrompt
        visible={!!renaming}
        title="Rename chat"
        initialValue={renaming?.title}
        onSubmit={(t) => renaming && renameConversation(renaming.id, t)}
        onClose={() => setRenaming(null)}
      />

      <Pressable
        onPress={newChat}
        style={[styles.fab, { backgroundColor: theme.text, bottom: insets.bottom + 20 }]}
      >
        <Text style={{ color: theme.bg, fontSize: 16, fontWeight: '700' }}>＋ New chat</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { margin: 16, marginBottom: 0, padding: 14, borderRadius: 12, borderWidth: 1 },
  search: { margin: 16, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  fab: {
    position: 'absolute',
    right: 20,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 28,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
});
