import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { EmptyState, Icon, IconButton, PillButton, RunningDot, SegmentedControl, StatusBadge, TextAction } from '../components/ui';
import type { IconName } from '../components/ui';
import { useStore } from '../lib/store';
import { cancelTask, clearTaskHistory } from '../lib/tasks';
import type { Task, TaskKind } from '../lib/tasks';
import { FONT, RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../lib/theme';
import { laptopConnected } from '../lib/tools';
import { formatElapsed, useTasks, useTicker } from '../lib/useTasks';
import { Text } from '../components/Text';

const KIND_ICON: Record<TaskKind, IconName> = {
  reply: 'message-circle',
  tool: 'tool',
  command: 'terminal',
  code: 'code',
  subagent: 'users',
  install: 'download',
  sync: 'refresh-cw',
};

/** Short live status for a running task: the newest output line, or what kind of work it is. */
function liveStatus(task: Task, elapsed: string): string {
  const lines = task.output.trimEnd().split('\n');
  const lastLine = lines[lines.length - 1]?.replace(/\x1b\[[\d;]*[A-Za-z]/g, '').trim();
  if (task.kind === 'command' && lastLine) return `${lastLine.slice(0, 80)} · ${elapsed}`;
  if (task.output && task.kind !== 'command') return `Writing… ${lines.length} line${lines.length === 1 ? '' : 's'} · ${elapsed}`;
  return `${task.kind} · ${elapsed}`;
}

/** A running task: Ember dot, title, a Geist Mono status line and Stop. */
function RunningCard({ task, now }: { task: Task; now: number }) {
  const theme = useTheme();
  const elapsed = formatElapsed(Math.max(now, task.startedAt) - task.startedAt);
  return (
    <Pressable
      onPress={() => router.push(`/tasks/${task.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, running`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.card,
        { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
      ]}
    >
      <RunningDot />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[TYPE.callout, { color: theme.ink, fontWeight: '500' }]}>
          {task.title}
        </Text>
        <Text numberOfLines={1} style={[TYPE.codeLabel, { color: theme.inkMuted, fontFamily: FONT.mono }]}>
          {liveStatus(task, elapsed)}
        </Text>
      </View>
      {task.cancellable ? (
        <PillButton title="Stop" variant="secondary" size="sm" onPress={() => cancelTask(task.id)} accessibilityHint={`Stops ${task.title}`} />
      ) : (
        <Icon name="chevron-right" size={16} color={theme.inkFaint} />
      )}
    </Pressable>
  );
}

/** A finished task as a tool step: kind icon, title, details and a status word. */
function FinishedRow({ task }: { task: Task }) {
  const theme = useTheme();
  const failed = task.status === 'failed';
  const detail = `${formatElapsed((task.endedAt ?? task.startedAt) - task.startedAt)} · ${new Date(task.startedAt).toLocaleString()}${
    task.exitCode != null ? ` · exit ${task.exitCode}` : ''
  }`;
  return (
    <Pressable
      onPress={() => router.push(`/tasks/${task.id}`)}
      accessibilityRole="button"
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.step,
        { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
      ]}
    >
      <Icon name={failed ? 'alert-circle' : KIND_ICON[task.kind]} size={16} color={failed ? theme.danger : theme.inkMuted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[TYPE.subhead, { color: theme.ink, fontFamily: undefined, fontWeight: '400' }]}>
          {task.title}
        </Text>
        <Text numberOfLines={1} style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 16 }}>
          {detail}
        </Text>
      </View>
      {task.status === 'done' ? (
        <StatusBadge tone="success">Done</StatusBadge>
      ) : failed ? (
        <StatusBadge tone="danger">Failed</StatusBadge>
      ) : (
        <StatusBadge tone="neutral">Stopped</StatusBadge>
      )}
    </Pressable>
  );
}

export default function TasksScreen() {
  const theme = useTheme();
  const { settings } = useStore();
  const { width } = useWindowDimensions();
  const tasks = useTasks();
  const running = tasks.filter((t) => t.status === 'running');
  const history = tasks.filter((t) => t.status !== 'running');
  const now = useTicker(running.length > 0);
  const [tab, setTab] = useState<'running' | 'recent'>(() => (running.length ? 'running' : 'recent'));
  const laptop = laptopConnected(settings);
  const hint = `Replies, tool calls, laptop commands and sub-agents show up here as they run.${
    laptop ? '' : ' Connect your laptop (Settings → Connections) to use the terminal.'
  }`;
  const data = tab === 'running' ? running : history;
  const gutter = width >= WIDE_BREAKPOINT ? 24 : 16;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (laptop ? <IconButton name="terminal" label="Terminal" onPress={() => router.push('/terminal')} /> : null),
        }}
      />
      <FlatList
        data={data}
        extraData={now}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 32, gap: 8, maxWidth: SIZE.contentMax + gutter * 2, width: '100%', alignSelf: 'center' }}
        ListHeaderComponent={
          <View style={{ paddingTop: 8, paddingBottom: 8, gap: 4 }}>
            <SegmentedControl
              label="Tasks"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'running', label: running.length ? `Running · ${running.length}` : 'Running' },
                { value: 'recent', label: 'Recent' },
              ]}
              style={{ borderRadius: RADIUS.pill }}
            />
            {tab === 'recent' && history.length > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <TextAction title="Clear" onPress={clearTaskHistory} />
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (item.status === 'running' ? <RunningCard task={item} now={now} /> : <FinishedRow task={item} />)}
        ListEmptyComponent={
          tab === 'running' ? (
            <EmptyState
              icon="activity"
              title="Nothing running"
              action={history.length ? <PillButton title="Show recent" variant="secondary" onPress={() => setTab('recent')} /> : undefined}
            >
              {hint}
            </EmptyState>
          ) : (
            <EmptyState icon="clock" title="No tasks yet">
              {hint}
            </EmptyState>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 64, borderRadius: RADIUS.md, borderWidth: 1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 6, minHeight: 56, borderRadius: RADIUS.md, borderWidth: 1 },
});
