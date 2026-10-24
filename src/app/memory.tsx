import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextPrompt } from '../components/TextPrompt';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { Memory } from '../lib/types';

export default function MemoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { memories, settings, addMemory, updateMemory, deleteMemory, clearMemories } = useStore();
  const [editing, setEditing] = useState<Memory | 'new' | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Text style={{ color: theme.muted, padding: 16, paddingBottom: 8 }}>
        {settings.memoryEnabled
          ? 'These facts are shared with the model in every chat. The model adds to them when you tell it something worth remembering — or add your own.'
          : 'Long-term memory is turned off in Settings, so these are not sent to the model.'}
      </Text>
      <FlatList keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        data={memories}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={
          <Text style={{ color: theme.muted, textAlign: 'center', marginTop: 40 }}>
            Nothing remembered yet.{'\n'}Try saying “Remember that my name is …” in a chat.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setEditing(item)}
            style={[styles.row, { borderBottomColor: theme.border }]}
          >
            <Text style={{ color: theme.text, fontSize: 15, flex: 1 }}>{item.text}</Text>
            <Pressable onPress={() => deleteMemory(item.id)} hitSlop={10}>
              <Text style={{ color: theme.danger, fontSize: 18 }}>✕</Text>
            </Pressable>
          </Pressable>
        )}
        ListFooterComponent={
          memories.length ? (
            <Pressable
              onPress={() =>
                Alert.alert('Forget everything?', 'All memories will be deleted.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Forget all', style: 'destructive', onPress: clearMemories },
                ])
              }
              style={{ padding: 16 }}
            >
              <Text style={{ color: theme.danger }}>Forget all</Text>
            </Pressable>
          ) : null
        }
      />
      <Pressable
        onPress={() => setEditing('new')}
        style={[styles.fab, { backgroundColor: theme.text, bottom: insets.bottom + 20 }]}
      >
        <Text style={{ color: theme.bg, fontWeight: '700', fontSize: 16 }}>＋ Add memory</Text>
      </Pressable>
      <TextPrompt
        visible={editing !== null}
        title={editing === 'new' ? 'New memory' : 'Edit memory'}
        initialValue={editing && editing !== 'new' ? editing.text : ''}
        placeholder="e.g. I'm learning Spanish"
        multiline
        onSubmit={(text) => (editing === 'new' ? addMemory(text) : editing && updateMemory(editing.id, text))}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fab: { position: 'absolute', right: 20, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 28, elevation: 4 },
});
