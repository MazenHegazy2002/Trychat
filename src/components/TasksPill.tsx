import { router } from 'expo-router';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { useTheme } from '../lib/theme';
import { useTasks } from '../lib/useTasks';
import { Icon } from './ui';

/** Header button to the Tasks screen; shows a spinner and count while tasks run. */
export function TasksPill({ conversationId, hideWhenIdle }: { conversationId?: string; hideWhenIdle?: boolean }) {
  const theme = useTheme();
  const tasks = useTasks();
  const running = tasks.filter((t) => t.status === 'running' && (!conversationId || t.conversationId === conversationId)).length;
  if (!running && hideWhenIdle) return null;
  return (
    <Pressable
      onPress={() => router.push('/tasks')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={running ? `${running} running task${running === 1 ? '' : 's'}. Open Tasks` : 'Tasks and terminal'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 32,
        paddingHorizontal: running ? 10 : 4,
        borderRadius: 16,
        backgroundColor: running ? theme.surface2 : 'transparent',
      }}
    >
      {running ? <ActivityIndicator size="small" color={theme.primary} /> : <Icon name="terminal" size={19} color={theme.primary} />}
      {running > 0 && <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>{running}</Text>}
    </Pressable>
  );
}
