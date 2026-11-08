import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { HtmlView } from './HtmlView';
import { Icon, RunningDot, StatusBadge } from './ui';
import { designIdOfCall } from '../lib/designTools';
import { thumbnailDocument, useDesign } from '../lib/designs';
import type { Board } from '../lib/designs';
import { RADIUS, TYPE, useTheme } from '../lib/theme';
import { toolLabel } from '../lib/tools';
import type { ToolCall } from '../lib/types';
import { Text } from './Text';

/** A non-interactive rendering of a board, scaled to fit its box. */
export function BoardThumb({ board, height = 160 }: { board?: Board; height?: number }) {
  const theme = useTheme();
  // The stage behind a board: the code ground in dark, a light fill in light.
  const stage = theme.dark ? theme.codeBg : theme.fill;
  const html = useMemo(() => (board ? thumbnailDocument(board, stage) : ''), [board, stage]);
  return (
    <View style={{ height, backgroundColor: stage, overflow: 'hidden' }} pointerEvents="none">
      {board ? (
        <HtmlView html={html} background={stage} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="layout" size={28} color={theme.inkFaint} />
        </View>
      )}
    </View>
  );
}

/** design.* tool calls in a chat: a thumbnail card that opens the canvas. */
export function DesignToolCard({ call }: { call: ToolCall }) {
  const theme = useTheme();
  const id = designIdOfCall(call.args, call.result);
  const design = useDesign(id ?? undefined);
  const running = call.status === 'running' || call.status === 'pending';
  const board =
    design?.boards.find((b) => b.id === /board id: (\S+?)[,)]/.exec(call.result ?? '')?.[1]) ?? design?.boards[design.boards.length - 1];
  const showThumb = !!design && call.status === 'done' && call.name !== 'design.list' && call.name !== 'design.read';
  const screens = design ? `${design.boards.length} screen${design.boards.length === 1 ? '' : 's'}` : '';
  return (
    <Pressable
      disabled={!design}
      onPress={() => design && router.push(`/designs/${design.id}`)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.card,
        { borderColor: theme.border, backgroundColor: (pressed || hovered) && design ? theme.fill : theme.surface },
      ]}
      accessibilityRole="button"
      accessibilityLabel={design ? `Open ${design.title} on the canvas` : toolLabel(call)}
    >
      {showThumb && <BoardThumb board={board} height={180} />}
      <View style={styles.row}>
        {running ? (
          <RunningDot />
        ) : (
          <Icon name={call.status === 'error' ? 'alert-circle' : 'pen-tool'} size={16} color={call.status === 'error' ? theme.danger : theme.inkMuted} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[TYPE.subhead, { color: theme.ink }]} numberOfLines={1}>
            {toolLabel(call)}
          </Text>
          {!!design && (
            <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 1 }} numberOfLines={1}>
              {design.title} · {screens}
            </Text>
          )}
          {call.status === 'error' && !!call.result && (
            <Text style={{ color: theme.danger, fontSize: 12, lineHeight: 16, marginTop: 2 }} numberOfLines={3}>
              {call.result}
            </Text>
          )}
        </View>
        {running ? (
          <StatusBadge tone="running">Running</StatusBadge>
        ) : call.status === 'error' ? (
          <StatusBadge tone="danger">Failed</StatusBadge>
        ) : design ? (
          <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '600' }}>Open</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.md, overflow: 'hidden', marginTop: 8, maxWidth: 420 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56 },
});
