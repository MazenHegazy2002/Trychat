import { Stack, router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../components/ui';
import type { IconName } from '../components/ui';
import { useStore } from '../lib/store';
import { cancelTask, clearTaskHistory } from '../lib/tasks';
import type { Task, TaskKind } from '../lib/tasks';
import { useTheme } from '../lib/theme';
import { laptopConnected } from '../lib/tools';
import { formatElapsed, useTasks, useTicker } from '../lib/useTasks';

const KIND_ICON: Record<TaskKind, IconName> = {
  reply: 'message-circle',
  tool: 'tool',
  command: 'terminal',
  code: 'code',
  subagent: 'users',
  install: 'download',
  sync: 'refresh-cw',
};

function TaskRow({ task, now }: { task: Task; now: number }) {
  const theme = useTheme();
  const running = task.status === 'running';
  const tone = task.status === 'failed' ? theme.danger : task.status === 'cancelled' ? theme.faint : theme.muted;
  const when = running
    ? formatElapsed(Math.max(now, task.startedAt) - task.startedAt)
    : `${task.status === 'done' ? 'Done' : task.status === 'failed' ? 'Failed' : 'Stopped'} · ${formatElapsed((task.endedAt ?? task.startedAt) - task.startedAt)} · ${new Date(task.startedAt).toLocaleString()}`;
  return (
    <Pressable
      onPress={() => router.push(`/tasks/${task.id}`)}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.border }, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.icon}>
        {running ? <ActivityIndicator size="small" color={theme.primary} /> : <Icon name={KIND_ICON[task.kind]} size={18} color={tone} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} style={{ color: theme.text, fontSize: 15 }}>
          {task.title}
        </Text>
        <Text numberOfLines={1} style={{ color: tone, fontSize: 12, marginTop: 2 }}>
          {when}
          {task.exitCode != null && !running ? ` · exit ${task.exitCode}` : ''}
        </Text>
      </View>
      {running && task.cancellable && (
        <Pressable
          onPress={() => cancelTask(task.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Stop ${task.title}`}
          style={[styles.stop, { borderColor: theme.danger }]}
        >
          <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>Stop</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

export default function TasksScreen() {
  const theme = useTheme();
  const { settings } = useStore();
  const tasks = useTasks();
  const running = tasks.filter((t) => t.status === 'running');
  const history = tasks.filter((t) => t.status !== 'running');
  const now = useTicker(running.length > 0);
  const data: (Task | { header: string; action?: () => void })[] = [
    ...(running.length ? [{ header: `Running (${running.length})` }, ...running] : []),
    { header: 'History', action: history.length ? clearTaskHistory : undefined },
    ...history,
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          headerRight: () =>
            laptopConnected(settings) ? (
              <Pressable onPress={() => router.push('/terminal')} hitSlop={8} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Icon name="terminal" size={18} color={theme.primary} />
                <Text style={{ color: theme.primary, fontSize: 15, fontWeight: '600' }}>Terminal</Text>
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        data={data}
        extraData={now}
        keyExtractor={(item, i) => ('id' in item ? item.id : `h${i}`)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        renderItem={({ item }) =>
          'id' in item ? (
            <TaskRow task={item} now={now} />
          ) : (
            <View style={styles.header}>
              <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', flex: 1 }}>{item.header}</Text>
              {item.action && (
                <Pressable onPress={item.action} hitSlop={8}>
                  <Text style={{ color: theme.primary, fontSize: 13, fontWeight: '600' }}>Clear</Text>
                </Pressable>
              )}
            </View>
          )
        }
        ListFooterComponent={
          history.length === 0 ? (
            <Text style={{ color: theme.muted, fontSize: 14, marginTop: 8 }}>
              Replies, tool calls, laptop commands and sub-agents show up here as they run.
              {laptopConnected(settings) ? '' : ' Connect your laptop (Settings → Connections) to use the terminal.'}
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  icon: { width: 24, alignItems: 'center' },
  stop: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, minHeight: 30, justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 4 },
});
