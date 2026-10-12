import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../lib/theme';
import { toolLabel, toolService } from '../lib/tools';
import type { ToolCall } from '../lib/types';

interface Props {
  call: ToolCall;
  onApprove: () => void;
  onDeny: () => void;
}

const STATUS_TEXT: Record<ToolCall['status'], string> = {
  pending: 'Waiting for your OK',
  running: 'Running…',
  done: 'Done',
  denied: 'You denied this',
  error: 'Failed',
};

/** Shows a GitHub/laptop action the model wants to take, with Run/Deny when it needs approval. */
export function ToolCallCard({ call, onApprove, onDeny }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const service = toolService(call);
  const where =
    {
      github: 'GitHub',
      laptop: 'Laptop',
      code: 'Code',
      agents: 'Agents',
      skills: 'Skill',
      mcp: call.name.split('.')[1] ?? 'MCP',
    }[service ?? 'code'] ?? 'Tool';

  // What the user is approving: the command, or the file content being written.
  const detail =
    typeof call.args.code === 'string'
      ? call.args.code
      : Array.isArray(call.args.tasks)
        ? call.args.tasks.map((t: any, i: number) => `${i + 1}. ${typeof t === 'string' ? t : t?.task}`).join('\n')
        : typeof call.args.command === 'string'
      ? call.args.command + (call.args.cwd ? `\n# in ${call.args.cwd}` : '')
      : typeof call.args.content === 'string'
        ? call.args.content
        : typeof call.args.body === 'string'
          ? call.args.body
          : service === 'mcp'
            ? JSON.stringify(call.args, null, 2)
            : null;

  if (call.status !== 'pending') {
    return (
      <View style={[styles.step, { borderColor: theme.border }]}>
        <Pressable onPress={() => setOpen((o) => !o)} style={styles.stepRow} accessibilityRole="button">
          <View style={[styles.badge, { backgroundColor: theme.surface }]}>
            <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '600' }}>{where}</Text>
          </View>
          <Text style={{ color: theme.text, flex: 1, fontSize: 14 }} numberOfLines={open ? undefined : 1}>
            {toolLabel(call)}
          </Text>
          {call.status === 'running' ? (
            <ActivityIndicator size="small" color={theme.muted} />
          ) : (
            <Text
              style={{
                color: call.status === 'done' ? theme.muted : theme.danger,
                fontSize: 12,
              }}
            >
              {STATUS_TEXT[call.status]} {open ? '▾' : '▸'}
            </Text>
          )}
        </Pressable>
        {open && !!call.result && (
          <ScrollView style={[styles.output, { backgroundColor: theme.codeBg }]} nestedScrollEnabled>
            <Text selectable style={[styles.mono, { color: theme.codeText }]}>
              {call.result}
            </Text>
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={{ color: theme.muted, fontSize: 13 }}>{where} · needs your OK</Text>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 4 }}>{toolLabel(call)}</Text>
      {detail !== null && (
        <ScrollView style={[styles.output, { backgroundColor: theme.codeBg }]} nestedScrollEnabled>
          <Text selectable style={[styles.mono, { color: theme.codeText }]}>
            {detail}
          </Text>
        </ScrollView>
      )}
      <View style={styles.buttons}>
        <Pressable onPress={onApprove} style={[styles.button, { backgroundColor: theme.text }]}>
          <Text style={{ color: theme.bg, fontWeight: '700' }}>
            {service === 'laptop' && call.name === 'laptop.run' ? 'Run' : 'Allow'}
          </Text>
        </Pressable>
        <Pressable onPress={onDeny} style={[styles.button, { borderWidth: 1, borderColor: theme.border }]}>
          <Text style={{ color: theme.text, fontWeight: '600' }}>Deny</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  step: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, marginTop: 8, overflow: 'hidden' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 44 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 8 },
  output: { maxHeight: 220, borderRadius: 10, marginTop: 10 },
  mono: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18, padding: 10 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  button: { minHeight: 44, paddingHorizontal: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
