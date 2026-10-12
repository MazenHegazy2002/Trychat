import { router } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import { Icon } from './ui';

/** Bottom sheet to put a chat in a project (or take it out). */
export function MoveToProjectSheet({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { projects, conversations, moveConversation } = useStore();
  const conv = conversations.find((c) => c.id === conversationId);

  const rows: { id: string | undefined; name: string; count?: number }[] = [
    { id: undefined, name: 'No project' },
    ...projects.map((p) => ({ id: p.id, name: p.name, count: conversations.filter((c) => c.projectId === p.id).length })),
  ];

  return (
    <Modal visible={!!conv} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      {conv && (
        <View style={[styles.sheet, { backgroundColor: theme.bg, paddingBottom: insets.bottom + 12 }]}>
          <View style={[styles.grabber, { backgroundColor: theme.oat }]} />
          <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 22, paddingHorizontal: 20 }}>Move to project</Text>
          <Text style={{ color: theme.muted, fontSize: 13, paddingHorizontal: 20, marginTop: 2, marginBottom: 8 }} numberOfLines={1}>
            {conv.title}
          </Text>
          {rows.map((r) => {
            const selected = conv.projectId === r.id;
            return (
              <Pressable
                key={r.id ?? 'none'}
                onPress={() => {
                  moveConversation(conv.id, r.id);
                  onClose();
                }}
                style={[styles.row, selected && { backgroundColor: theme.surface2 }]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <View style={[styles.tile, { backgroundColor: r.id ? theme.surface2 : 'transparent' }]}>
                  <Icon name={r.id ? 'folder' : 'inbox'} size={16} color={theme.text} />
                </View>
                <Text style={{ color: theme.text, fontSize: 15, flex: 1 }}>{r.name}</Text>
                {r.count !== undefined && <Text style={{ color: theme.faint, fontSize: 13 }}>{r.count}</Text>}
                {selected && <Icon name="check" size={18} color={theme.accent} />}
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => {
              onClose();
              router.push({ pathname: '/projects/new', params: { moveChat: conv.id } });
            }}
            style={styles.row}
            accessibilityRole="button"
          >
            <View style={styles.tile}>
              <Icon name="plus" size={16} color={theme.primary} />
            </View>
            <Text style={{ color: theme.primary, fontSize: 15, fontWeight: '600' }}>New project</Text>
          </Pressable>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(20,20,19,0.4)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, maxHeight: '75%' },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, marginHorizontal: 8, paddingHorizontal: 12, borderRadius: 12 },
  tile: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
