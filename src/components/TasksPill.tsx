import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { RADIUS, SIZE, useTheme } from '../lib/theme';
import { useTasks } from '../lib/useTasks';
import { Text } from './Text';
import { IconButton, RunningDot } from './ui';

/**
 * Header button to Tasks & terminal. While something runs it is a small pill with the Ember dot and
 * "N running"; idle it is a terminal icon (or nothing, with `hideWhenIdle`).
 */
export function TasksPill({ conversationId, hideWhenIdle }: { conversationId?: string; hideWhenIdle?: boolean }) {
  const theme = useTheme();
  const tasks = useTasks();
  const running = tasks.filter((t) => t.status === 'running' && (!conversationId || t.conversationId === conversationId)).length;
  if (!running && hideWhenIdle) return null;
  if (!running) return <IconButton name="terminal" label="Tasks and terminal" onPress={() => router.push('/tasks')} />;
  return (
    <Pressable
      onPress={() => router.push('/tasks')}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${running} running task${running === 1 ? '' : 's'}. Open Tasks`}
      style={{ minHeight: SIZE.controlMd, justifyContent: 'center' }}
    >
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 32,
            paddingHorizontal: 12,
            borderRadius: RADIUS.pill,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: pressed ? theme.fill : theme.surfaceRaised,
          }}
        >
          <RunningDot size={8} />
          <Text style={{ color: theme.ink, fontSize: 13, lineHeight: 18, fontWeight: '500' }}>{running} running</Text>
        </View>
      )}
    </Pressable>
  );
}
