import { router } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { HtmlView } from './HtmlView';
import { Icon } from './ui';
import { designIdOfCall } from '../lib/designTools';
import { thumbnailDocument, useDesign } from '../lib/designs';
import type { Board } from '../lib/designs';
import { useTheme } from '../lib/theme';
import { toolLabel } from '../lib/tools';
import type { ToolCall } from '../lib/types';

/** A non-interactive rendering of a board, scaled to fit its box. */
export function BoardThumb({ board, height = 160 }: { board?: Board; height?: number }) {
  const theme = useTheme();
  const html = useMemo(() => (board ? thumbnailDocument(board, theme.surface2) : ''), [board, theme.surface2]);
  return (
    <View style={{ height, backgroundColor: theme.surface2, overflow: 'hidden' }} pointerEvents="none">
      {board ? (
        <HtmlView html={html} background={theme.surface2} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="layout" size={28} color={theme.faint} />
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
  return (
    <Pressable
      disabled={!design}
      onPress={() => design && router.push(`/designs/${design.id}`)}
      style={({ pressed }) => [styles.card, { borderColor: theme.border, backgroundColor: theme.surface }, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={design ? `Open ${design.title} on the canvas` : toolLabel(call)}
    >
      {showThumb && <BoardThumb board={board} height={180} />}
      <View style={styles.row}>
        {running ? <ActivityIndicator size="small" color={theme.accent} /> : <Icon name={call.status === 'error' ? 'alert-circle' : 'pen-tool'} size={16} color={theme.accent} />}
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
            {toolLabel(call)}
          </Text>
          {!!design && (
            <Text style={{ color: theme.muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
              {design.title} · {design.boards.length} board{design.boards.length === 1 ? '' : 's'}
            </Text>
          )}
          {call.status === 'error' && !!call.result && (
            <Text style={{ color: theme.danger, fontSize: 12, marginTop: 2 }} numberOfLines={3}>
              {call.result}
            </Text>
          )}
        </View>
        {!!design && <Text style={{ color: theme.primary, fontSize: 13, fontWeight: '600' }}>Open</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden', marginTop: 8, maxWidth: 420 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
});
