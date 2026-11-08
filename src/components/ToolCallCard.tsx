import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { DesignToolCard } from './DesignViews';
import { InstallCard } from './InstallCard';
import { storeToolLabel } from '../lib/storeTools';
import { FONT, RADIUS, shadow, useTheme } from '../lib/theme';
import { toolLabel, toolService } from '../lib/tools';
import type { Service } from '../lib/tools';
import type { ToolApproval } from '../lib/store';
import type { ToolCall } from '../lib/types';
import { Text } from './Text';
import { Icon, PillButton, StatusBadge } from './ui';
import type { IconName, StatusTone } from './ui';

interface Props {
  call: ToolCall;
  /** `extra` carries values typed into the card (see store.approveTool). */
  onApprove: (extra?: ToolApproval) => void;
  onDeny: () => void;
}

/** Short status word and its tone; never colour alone. */
const STATUS: Record<ToolCall['status'], [string, StatusTone]> = {
  pending: ['Needs OK', 'warning'],
  running: ['Running', 'running'],
  done: ['Done', 'success'],
  denied: ['Denied', 'neutral'],
  error: ['Failed', 'danger'],
};

const SERVICE_ICON: Record<Service, IconName> = {
  github: 'github',
  laptop: 'monitor',
  code: 'terminal',
  agents: 'users',
  skills: 'zap',
  mcp: 'server',
  files: 'file-text',
  friends: 'user-plus',
  store: 'package',
  phone: 'smartphone',
  web: 'globe',
  workspace: 'git-branch',
};

/** Shows a GitHub/laptop action the model wants to take, with Run/Deny when it needs approval. */
export function ToolCallCard({ call, onApprove, onDeny }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const service = toolService(call);
  // store.install has its own card: what it adds, the assistant's reason, and fields for keys.
  if (call.name === 'store.install') return <InstallCard call={call} onApprove={onApprove} onDeny={onDeny} />;
  if (call.name.startsWith('design.') && call.status !== 'pending') return <DesignToolCard call={call} />;
  const label = storeToolLabel(call) ?? toolLabel(call);
  const where =
    {
      github: 'GitHub',
      laptop: 'Laptop',
      code: 'Code',
      agents: 'Agents',
      files: 'Files',
      phone: 'Phone',
      friends: 'Friends',
      store: 'Store',
      web: 'Web',
      workspace: 'Workspace',
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

  // A one- or two-line command is shown as is; longer code folds behind "View code".
  const detailLines = detail?.split('\n').length ?? 0;
  const shortDetail = detail !== null && detailLines <= 2 && detail.length <= 160;

  const icon: IconName = service ? SERVICE_ICON[service] : 'tool';

  if (call.status !== 'pending') {
    const [word, tone] = STATUS[call.status];
    return (
      <View style={[styles.step, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={`${where}: ${label}. ${word}`}
          accessibilityState={{ expanded: open }}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.stepRow,
            (pressed || hovered) && { backgroundColor: theme.fill },
          ]}
        >
          <Icon name={icon} size={16} color={theme.inkMuted} />
          <Text style={{ color: theme.ink, flex: 1, fontSize: 14, lineHeight: 20 }} numberOfLines={open ? undefined : 1}>
            {label}
          </Text>
          <StatusBadge tone={tone}>{word}</StatusBadge>
          {call.status !== 'running' && <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.inkFaint} />}
        </Pressable>
        {open && !!call.result && (
          <ScrollView style={[styles.output, { backgroundColor: theme.codeBg }]} nestedScrollEnabled>
            <Text selectable style={[styles.mono, { color: theme.codeInk }]}>
              {call.result}
            </Text>
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.warning }, shadow(theme, 'raised')]}>
      <View style={styles.ask}>
        <Icon name={icon} size={16} color={theme.warning} />
        <Text style={{ color: theme.warning, fontSize: 13, lineHeight: 18, fontWeight: '600' }}>{where} · needs your OK</Text>
      </View>
      <Text style={{ color: theme.ink, fontSize: 16, lineHeight: 22, fontWeight: '600' }}>{label}</Text>
      {detail !== null && (
        <View style={[styles.detail, { backgroundColor: theme.codeBg }]}>
          {!shortDetail && (
            <Pressable
              onPress={() => setShowDetail((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showDetail }}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.detailBar,
                (pressed || hovered) && { backgroundColor: theme.fill },
              ]}
            >
              <Text style={{ flex: 1, color: theme.codeInk, fontSize: 13, lineHeight: 18, fontWeight: '500' }}>
                {showDetail ? 'Hide code' : `View code (${detailLines} lines)`}
              </Text>
              <Icon name={showDetail ? 'chevron-up' : 'chevron-down'} size={16} color={theme.codeInk} />
            </Pressable>
          )}
          {(shortDetail || showDetail) && (
            <ScrollView
              style={[styles.detailCode, !shortDetail && { borderTopWidth: 1, borderTopColor: theme.border }]}
              nestedScrollEnabled
            >
              <Text selectable style={[styles.mono, { color: theme.codeInk }]}>
                {detail}
              </Text>
            </ScrollView>
          )}
        </View>
      )}
      <View style={styles.buttons}>
        <PillButton title="Deny" variant="secondary" onPress={onDeny} style={styles.button} />
        <PillButton
          title={service === 'laptop' && call.name === 'laptop.run' ? 'Run' : 'Allow'}
          onPress={() => onApprove()}
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  step: { borderWidth: 1, borderRadius: RADIUS.md, marginTop: 8, overflow: 'hidden' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 48 },
  output: { maxHeight: 220, borderRadius: RADIUS.sm, marginHorizontal: 8, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: RADIUS.md, padding: 16, gap: 12, marginTop: 8 },
  ask: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detail: { borderRadius: RADIUS.sm, overflow: 'hidden' },
  detailBar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  detailCode: { maxHeight: 220 },
  mono: { fontFamily: FONT.monoMedium, fontSize: 12, lineHeight: 18, padding: 12 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 4 },
  button: { flex: 1 },
});
