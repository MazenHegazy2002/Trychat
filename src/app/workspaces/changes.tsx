import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card, ClaySwitch, Divider, EmptyState, Icon, PillButton, SectionLabel, StatusBadge, TextAction, TextField } from '../../components/ui';
import { useStore } from '../../lib/store';
import { FONT, TYPE, useTheme } from '../../lib/theme';
import { wsReadBase } from '../../lib/workspace/backends';
import type { DiffLine } from '../../lib/workspace/core';
import { commitChangeset, ConflictError, diffLines, hunks } from '../../lib/workspace/core';
import { patchWorkspace, useWorkspace } from '../../lib/workspace/store';
import { Text } from '../../components/Text';

/** A unified diff on the code ground: line numbers dim, added lines in code-ok, removed lines in code-error. */
function Diff({ lines }: { lines: (DiffLine | null)[] }) {
  const theme = useTheme();
  return (
    <ScrollView horizontal style={{ backgroundColor: theme.codeBg }} contentContainerStyle={{ minWidth: '100%', paddingVertical: 10 }}>
      <View>
        {lines.map((l, i) =>
          l ? (
            <View key={i} style={{ flexDirection: 'row', paddingRight: 16 }}>
              <Text style={[TYPE.code, styles.num, { color: theme.syntaxComment }]}>{l.a ?? ''}</Text>
              <Text style={[TYPE.code, styles.num, { color: theme.syntaxComment }]}>{l.b ?? ''}</Text>
              <Text style={[TYPE.code, { color: l.t === '+' ? theme.codeOk : l.t === '-' ? theme.codeError : theme.codeInk }]}>
                {l.t === '-' ? '−' : l.t} {l.text}
              </Text>
            </View>
          ) : (
            <Text key={i} style={[TYPE.code, { color: theme.syntaxComment, paddingLeft: 12 }]}>
              ⋯
            </Text>
          ),
        )}
      </View>
    </ScrollView>
  );
}

export default function ChangesScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useWorkspace(id);
  const { settings } = useStore();
  const [diffs, setDiffs] = useState<Record<string, (DiffLine | null)[]>>({});
  const [message, setMessage] = useState('');
  const [toBranch, setToBranch] = useState(false);
  const [branch, setBranch] = useState('');
  const [pr, setPr] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [busy, setBusy] = useState(false);
  const entries = ws ? Object.entries(ws.changes) : [];

  useEffect(() => {
    if (!ws) return;
    let off = false;
    (async () => {
      const out: Record<string, (DiffLine | null)[]> = {};
      for (const [p, c] of Object.entries(ws.changes)) {
        const base = c.isNew ? '' : ((await wsReadBase(settings, ws, p).catch(() => '')) ?? '');
        out[p] = hunks(diffLines(base, c.op === 'delete' ? '' : (c.content ?? '')));
      }
      if (!off) setDiffs(out);
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.changes, ws?.baseSha]);

  if (!ws) return null;

  const discard = (p: string) => {
    const next = { ...ws.changes };
    delete next[p];
    patchWorkspace(ws.id, { changes: next });
  };

  const commit = async () => {
    setBusy(true);
    try {
      const r = await commitChangeset(settings, ws, {
        message,
        newBranch: toBranch ? branch : undefined,
        pr: toBranch && pr ? { title: prTitle, body: prBody } : undefined,
      });
      patchWorkspace(ws.id, { changes: {}, baseSha: r.baseSha, branch: r.branch, lastCommit: { sha: r.sha, url: r.url, branch: r.branch, prUrl: r.prUrl, at: Date.now() } });
      setMessage('');
    } catch (e) {
      Alert.alert(e instanceof ConflictError ? 'Conflict' : 'Commit failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const last = ws.lastCommit;
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Changes' }} />
      {last && (
        <Card style={{ padding: 16, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="check-circle" size={20} color={theme.success} />
            <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '600', flex: 1 }]}>
              Committed <Text style={{ fontFamily: FONT.monoSemibold }}>{last.sha.slice(0, 7)}</Text> to {last.branch}
            </Text>
          </View>
          <Pressable onPress={() => Linking.openURL(last.url)} accessibilityRole="link" style={styles.link}>
            <Text style={{ color: theme.accent, fontSize: 13, lineHeight: 18 }} numberOfLines={1} ellipsizeMode="middle">
              {last.url}
            </Text>
          </Pressable>
          {last.prUrl && (
            <Pressable onPress={() => Linking.openURL(last.prUrl!)} accessibilityRole="link" style={styles.link}>
              <Text style={{ color: theme.accent, fontSize: 13, lineHeight: 18 }} numberOfLines={1} ellipsizeMode="middle">
                Pull request: {last.prUrl}
              </Text>
            </Pressable>
          )}
        </Card>
      )}

      {entries.length ? (
        <SectionLabel style={{ marginTop: last ? 12 : 4, marginBottom: 0 }}>{`${entries.length} staged change(s) on ${ws.branch}`}</SectionLabel>
      ) : (
        <EmptyState icon="git-commit" title="No staged changes">
          Edits you make in this workspace wait here until you commit them.
        </EmptyState>
      )}
      {entries.map(([p, c]) => {
        const lines = diffs[p];
        const added = lines?.filter((l) => l?.t === '+').length ?? 0;
        const removed = lines?.filter((l) => l?.t === '-').length ?? 0;
        const status = c.op === 'delete' ? (['danger', 'Deleted'] as const) : c.isNew ? (['success', 'Added'] as const) : (['warning', 'Modified'] as const);
        return (
          <Card key={p}>
            <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <StatusBadge tone={status[0]}>{status[1]}</StatusBadge>
                <Text style={[TYPE.code, { color: theme.ink, flex: 1 }]} numberOfLines={2}>
                  {p}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {lines ? (
                  <Text accessibilityLabel={`${added} lines added, ${removed} removed`} style={{ fontFamily: FONT.mono, fontSize: 12, lineHeight: 16, flex: 1 }}>
                    <Text style={{ color: theme.success }}>+{added} added</Text>
                    <Text style={{ color: theme.inkFaint }}>  </Text>
                    <Text style={{ color: theme.danger }}>−{removed} removed</Text>
                  </Text>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <TextAction title="Discard" tone="danger" onPress={() => discard(p)} />
              </View>
            </View>
            <Divider />
            {lines ? <Diff lines={lines} /> : <ActivityIndicator color={theme.inkMuted} style={{ marginVertical: 16 }} />}
          </Card>
        );
      })}

      {entries.length > 0 && (
        <Card style={{ padding: 16, gap: 14, marginTop: 12 }}>
          <Text style={[TYPE.headline, { color: theme.ink }]}>Commit all as one commit</Text>
          <TextField value={message} onChangeText={setMessage} placeholder="Commit message" accessibilityLabel="Commit message" multiline />
          <View style={styles.switchRow}>
            <Text style={[TYPE.callout, { color: theme.ink, flex: 1 }]}>Commit to a new branch</Text>
            <ClaySwitch value={toBranch} onValueChange={setToBranch} label="New branch" />
          </View>
          {toBranch && (
            <>
              <TextField value={branch} onChangeText={setBranch} placeholder="new-branch-name" accessibilityLabel="Branch name" autoCapitalize="none" mono />
              <View style={styles.switchRow}>
                <Text style={[TYPE.callout, { color: theme.ink, flex: 1 }]}>Open a pull request into {ws.branch}</Text>
                <ClaySwitch value={pr} onValueChange={setPr} label="Pull request" />
              </View>
              {pr && (
                <>
                  <TextField value={prTitle} onChangeText={setPrTitle} placeholder="PR title (defaults to the message)" accessibilityLabel="Pull request title" />
                  <TextField value={prBody} onChangeText={setPrBody} placeholder="PR description" accessibilityLabel="Pull request description" multiline />
                </>
              )}
            </>
          )}
          <PillButton
            title={toBranch ? `Commit to ${branch || '…'}${pr ? ' + PR' : ''}` : `Commit to ${ws.branch}`}
            icon="git-commit"
            size="lg"
            loading={busy}
            disabled={!message.trim() || (toBranch && !branch.trim())}
            onPress={commit}
          />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  num: { width: 36, textAlign: 'right', paddingRight: 10 },
  link: { minHeight: 44, justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
});
