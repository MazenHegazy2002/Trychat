import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../components/Text';
import { TextPrompt } from '../components/TextPrompt';
import { Banner, Divider, EmptyState, IconButton, PillButton, TextField } from '../components/ui';
import { useStore } from '../lib/store';
import { RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../lib/theme';
import type { Memory } from '../lib/types';

export default function MemoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const { memories, settings, addMemory, updateMemory, deleteMemory, clearMemories } = useStore();
  const [editing, setEditing] = useState<Memory | null>(null);
  const [text, setText] = useState('');

  const add = () => {
    if (!text.trim()) return;
    addMemory(text);
    setText('');
  };

  // An element (not a component) so the add field keeps its focus while the list re-renders.
  const header = (
    <View style={styles.header}>
      {settings.memoryEnabled ? (
        <Text style={[TYPE.callout, { color: theme.inkMuted }]}>
          These facts are shared with the model in every chat. The model adds to them when you tell it something worth
          remembering — or add your own.
        </Text>
      ) : (
        <Banner tone="warning" onPress={() => router.push('/settings')}>
          Long-term memory is turned off in Settings, so these are not sent to the model.
        </Banner>
      )}
      <View style={styles.addRow}>
        <TextField
          style={{ flex: 1 }}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          returnKeyType="done"
          placeholder="e.g. I'm learning Spanish"
          accessibilityLabel="New memory"
        />
        <PillButton title="Add" icon="plus" onPress={add} disabled={!text.trim()} style={{ minHeight: 48 }} />
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        data={memories}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: wide ? 24 : 16, paddingTop: wide ? 24 : 16, paddingBottom: insets.bottom + 32 },
        ]}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState icon="book-open" title="Nothing remembered yet">
            Try saying “Remember that my name is …” in a chat.
          </EmptyState>
        }
        renderItem={({ item, index }) => {
          const first = index === 0;
          const last = index === memories.length - 1;
          return (
            <View
              style={[
                styles.item,
                { backgroundColor: theme.surface, borderColor: theme.border },
                first && styles.first,
                last && styles.last,
              ]}
            >
              {!first && <Divider inset={16} />}
              <View style={styles.row}>
                <Pressable
                  onPress={() => setEditing(item)}
                  accessibilityRole="button"
                  accessibilityHint="Edit this memory"
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.text,
                    { backgroundColor: pressed || hovered ? theme.fill : 'transparent' },
                  ]}
                >
                  <Text style={[TYPE.callout, { color: theme.ink }]}>{item.text}</Text>
                </Pressable>
                <IconButton name="edit-2" label="Edit memory" onPress={() => setEditing(item)} />
                <IconButton name="trash-2" label="Delete memory" onPress={() => deleteMemory(item.id)} />
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          memories.length ? (
            <PillButton
              title="Forget all"
              variant="danger"
              icon="trash-2"
              style={styles.forget}
              onPress={() =>
                Alert.alert('Forget everything?', 'All memories will be deleted.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Forget all', style: 'destructive', onPress: clearMemories },
                ])
              }
            />
          ) : null
        }
      />
      <TextPrompt
        visible={editing !== null}
        title="Edit memory"
        initialValue={editing ? editing.text : ''}
        placeholder="e.g. I'm learning Spanish"
        multiline
        onSubmit={(value) => editing && updateMemory(editing.id, value)}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center' },
  header: { gap: 16, paddingBottom: 16 },
  addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  item: { borderLeftWidth: 1, borderRightWidth: 1, overflow: 'hidden' },
  first: { borderTopWidth: 1, borderTopLeftRadius: RADIUS.md, borderTopRightRadius: RADIUS.md },
  last: { borderBottomWidth: 1, borderBottomLeftRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  text: { flex: 1, minHeight: 52, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  forget: { marginTop: 24, alignSelf: 'flex-start' },
});
