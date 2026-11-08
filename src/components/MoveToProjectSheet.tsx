import { router } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useStore } from '../lib/store';
import { RADIUS, TYPE, useTheme } from '../lib/theme';
import { Sheet } from './TextPrompt';
import { Icon } from './ui';
import type { IconName } from './ui';
import { Text } from './Text';

/** Sheet to put a chat in a project (or take it out). */
export function MoveToProjectSheet({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const theme = useTheme();
  const { projects, conversations, moveConversation } = useStore();
  const conv = conversations.find((c) => c.id === conversationId);

  const rows: { id: string | undefined; name: string; count?: number }[] = [
    { id: undefined, name: 'No project' },
    ...projects.map((p) => ({ id: p.id, name: p.name, count: conversations.filter((c) => c.projectId === p.id).length })),
  ];

  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible={!!conv} transparent animationType="fade" onRequestClose={onClose}>
      {conv && (
        <Sheet title="Move to project" subtitle={conv.title} onClose={onClose}>
          <ScrollView style={{ flexShrink: 1 }} bounces={false}>
            {rows.map((r) => {
              const selected = conv.projectId === r.id;
              return (
                <Option
                  key={r.id ?? 'none'}
                  icon={r.id ? 'folder' : 'inbox'}
                  label={r.name}
                  count={r.count}
                  selected={selected}
                  onPress={() => {
                    moveConversation(conv.id, r.id);
                    onClose();
                  }}
                />
              );
            })}
            <View style={[styles.rule, { backgroundColor: theme.border }]} />
            <Option
              icon="plus"
              label="New project"
              onPress={() => {
                onClose();
                router.push({ pathname: '/projects/new', params: { moveChat: conv.id } });
              }}
            />
          </ScrollView>
        </Sheet>
      )}
    </Modal>
  );
}

/** A 52px option; the current one sits on accent-soft with an Ember check. */
function Option({ icon, label, count, selected, onPress }: { icon: IconName; label: string; count?: number; selected?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        { backgroundColor: selected ? theme.accentSoft : pressed || hovered ? theme.fill : 'transparent' },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
    >
      <View style={[styles.tile, { backgroundColor: selected ? 'transparent' : theme.fill }]}>
        <Icon name={icon} size={16} color={selected ? theme.accent : theme.ink} />
      </View>
      <Text style={[TYPE.callout, { color: theme.ink, flex: 1 }, selected && { fontWeight: '600' }]} numberOfLines={1}>
        {label}
      </Text>
      {count !== undefined && <Text style={[TYPE.caption, { color: theme.inkFaint }]}>{count}</Text>}
      {selected && <Icon name="check" size={18} color={theme.accent} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: RADIUS.sm },
  tile: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4, marginHorizontal: 12 },
});
