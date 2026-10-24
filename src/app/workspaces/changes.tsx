import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { DiffView } from '../../components/CodeView';
import { Card, ClaySwitch, PillButton, SectionLabel } from '../../components/ui';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { wsReadBase } from '../../lib/workspace/backends';
import type { DiffLine } from '../../lib/workspace/core';
import { commitChangeset, ConflictError, diffLines, hunks } from '../../lib/workspace/core';
import { patchWorkspace, useWorkspace } from '../../lib/workspace/store';

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

  const input = { backgroundColor: theme.surface2, color: theme.text, borderRadius: 10, padding: 12, fontSize: 15, marginTop: 8 } as const;
  const last = ws.lastCommit;
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Changes' }} />
      {last && (
        <Card>
          <Text style={{ color: theme.text, fontWeight: '600' }}>
            Committed {last.sha.slice(0, 7)} to {last.branch}
          </Text>
          <Pressable onPress={() => Linking.openURL(last.url)}>
            <Text style={{ color: theme.primary, marginTop: 4 }}>{last.url}</Text>
          </Pressable>
          {last.prUrl && (
            <Pressable onPress={() => Linking.openURL(last.prUrl!)}>
              <Text style={{ color: theme.primary, marginTop: 4 }}>Pull request: {last.prUrl}</Text>
            </Pressable>
          )}
        </Card>
      )}

      <SectionLabel>{entries.length ? `${entries.length} staged change(s) on ${ws.branch}` : 'No staged changes'}</SectionLabel>
      {entries.map(([p, c]) => (
        <View key={p} style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ color: c.op === 'delete' ? theme.danger : theme.primary, fontWeight: '700', width: 18 }}>
              {c.op === 'delete' ? 'D' : c.isNew ? 'A' : 'M'}
            </Text>
            <Text style={{ color: theme.text, flex: 1, fontFamily: 'monospace', fontSize: 13 }}>{p}</Text>
            <Pressable onPress={() => discard(p)} hitSlop={8}>
              <Text style={{ color: theme.muted }}>Discard</Text>
            </Pressable>
          </View>
          {diffs[p] ? <DiffView lines={diffs[p]} /> : <ActivityIndicator />}
        </View>
      ))}

      {entries.length > 0 && (
        <Card>
          <Text style={{ color: theme.text, fontWeight: '600' }}>Commit all as one commit</Text>
          <TextInput value={message} onChangeText={setMessage} placeholder="Commit message" placeholderTextColor={theme.faint} multiline style={input} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
            <Text style={{ color: theme.text, flex: 1 }}>Commit to a new branch</Text>
            <ClaySwitch value={toBranch} onValueChange={setToBranch} label="New branch" />
          </View>
          {toBranch && (
            <>
              <TextInput value={branch} onChangeText={setBranch} placeholder="new-branch-name" placeholderTextColor={theme.faint} autoCapitalize="none" style={input} />
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                <Text style={{ color: theme.text, flex: 1 }}>Open a pull request into {ws.branch}</Text>
                <ClaySwitch value={pr} onValueChange={setPr} label="Pull request" />
              </View>
              {pr && (
                <>
                  <TextInput value={prTitle} onChangeText={setPrTitle} placeholder="PR title (defaults to the message)" placeholderTextColor={theme.faint} style={input} />
                  <TextInput value={prBody} onChangeText={setPrBody} placeholder="PR description" placeholderTextColor={theme.faint} multiline style={[input, { minHeight: 80 }]} />
                </>
              )}
            </>
          )}
          <PillButton
            title={toBranch ? `Commit to ${branch || '…'}${pr ? ' + PR' : ''}` : `Commit to ${ws.branch}`}
            icon="git-commit"
            loading={busy}
            disabled={!message.trim() || (toBranch && !branch.trim())}
            onPress={commit}
            style={{ marginTop: 14 }}
          />
        </Card>
      )}
    </ScrollView>
  );
}
