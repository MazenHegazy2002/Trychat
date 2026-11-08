import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { TerminalLog } from '../../components/TerminalLog';
import { EmptyState, IconButton, PillButton, RunningDot, StatusBadge } from '../../components/ui';
import { cancelTask } from '../../lib/tasks';
import { FONT, TYPE, useTheme } from '../../lib/theme';
import { formatElapsed, useTasks, useTicker } from '../../lib/useTasks';
import { Text } from '../../components/Text';

export default function TaskTerminal() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useTasks().find((t) => t.id === id);
  const running = task?.status === 'running';
  const now = useTicker(running);
  const [copied, setCopied] = useState(false);

  if (!task) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Task' }} />
        <EmptyState icon="terminal" title="This task is no longer in the history." />
      </View>
    );
  }
  const status = running
    ? formatElapsed(Math.max(now, task.startedAt) - task.startedAt)
    : `${formatElapsed((task.endedAt ?? task.startedAt) - task.startedAt)}${task.exitCode != null ? ` · exit ${task.exitCode}` : ''}`;
  const badge = running ? null : task.status === 'done' ? (
    <StatusBadge tone="success">Done</StatusBadge>
  ) : task.status === 'failed' ? (
    <StatusBadge tone="danger">Failed</StatusBadge>
  ) : (
    <StatusBadge tone="neutral">Stopped</StatusBadge>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16, paddingBottom: 16 }}>
      <Stack.Screen
        options={{
          title: task.kind === 'command' ? 'Terminal' : 'Task',
          headerRight: () => (
            <IconButton
              name={copied ? 'check' : 'copy'}
              label={copied ? 'Copied' : 'Copy'}
              color={copied ? theme.success : undefined}
              onPress={async () => {
                await Clipboard.setStringAsync(task.output);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
          ),
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
        {running && <RunningDot />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={3} style={task.kind === 'command' ? [TYPE.code, { color: theme.ink, fontFamily: FONT.monoMedium, fontSize: 14 }] : [TYPE.callout, { color: theme.ink, fontWeight: '500' }]}>
            {task.kind === 'command' ? '$ ' : ''}
            {task.title}
          </Text>
          <Text style={[TYPE.codeLabel, { color: theme.inkMuted, fontFamily: FONT.mono, marginTop: 2 }]}>{running ? `Running · ${status}` : status}</Text>
        </View>
        {badge}
        {running && task.cancellable && <PillButton title="Stop" variant="secondary" size="sm" onPress={() => cancelTask(task.id)} />}
      </View>
      <TerminalLog text={task.output || (running ? '' : '(no output)')} />
    </View>
  );
}
