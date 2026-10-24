import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { MONO, TERM, TerminalLog } from '../../components/TerminalLog';
import { cancelTask } from '../../lib/tasks';
import { useTheme } from '../../lib/theme';
import { formatElapsed, useTasks, useTicker } from '../../lib/useTasks';

export default function TaskTerminal() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useTasks().find((t) => t.id === id);
  const running = task?.status === 'running';
  const now = useTicker(running);
  const [copied, setCopied] = useState(false);

  if (!task) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: 24 }}>
        <Stack.Screen options={{ title: 'Task' }} />
        <Text style={{ color: theme.muted }}>This task is no longer in the history.</Text>
      </View>
    );
  }
  const status = running
    ? `running · ${formatElapsed(Math.max(now, task.startedAt) - task.startedAt)}`
    : `${task.status} · ${formatElapsed((task.endedAt ?? task.startedAt) - task.startedAt)}${task.exitCode != null ? ` · exit ${task.exitCode}` : ''}`;

  return (
    <View style={{ flex: 1, backgroundColor: TERM.bg }}>
      <Stack.Screen
        options={{
          title: task.kind === 'command' ? 'Terminal' : 'Task',
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18 }}>
              {running && task.cancellable && (
                <Pressable onPress={() => cancelTask(task.id)} hitSlop={8}>
                  <Text style={{ color: theme.danger, fontSize: 15, fontWeight: '600' }}>Stop</Text>
                </Pressable>
              )}
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(task.output);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                hitSlop={8}
              >
                <Text style={{ color: theme.primary, fontSize: 15, fontWeight: '600' }}>{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#30302E' }}>
        <Text numberOfLines={3} style={{ color: TERM.prompt, fontFamily: MONO, fontSize: 13 }}>
          {task.kind === 'command' ? '$ ' : ''}
          {task.title}
        </Text>
        <Text style={{ color: task.status === 'failed' ? TERM.err : TERM.dim, fontFamily: MONO, fontSize: 11, marginTop: 2 }}>{status}</Text>
      </View>
      <TerminalLog text={task.output || (running ? '' : '(no output)')} />
    </View>
  );
}
