import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TextPrompt } from '../../components/TextPrompt';
import { Banner, EmptyState, Icon, IconButton, PillButton, SearchField, StatusBadge } from '../../components/ui';
import { useStore } from '../../lib/store';
import { FONT, RADIUS, TYPE, useTheme } from '../../lib/theme';
import type { Theme } from '../../lib/theme';
import { describeWorkspace, wsDelete, wsList, wsMkdir, wsRename, wsSearch, wsWrite } from '../../lib/workspace/backends';
import type { Entry } from '../../lib/workspace/core';
import { branchHead, joinPath } from '../../lib/workspace/core';
import { patchWorkspace, useWorkspace } from '../../lib/workspace/store';
import { Text } from '../../components/Text';

function formatSize(n?: number): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Rows of one list drawn as a single card: the first and last rows carry the rounded ends. */
function groupStyle(theme: Theme, index: number, count: number) {
  const first = index === 0;
  const last = index === count - 1;
  return {
    borderColor: theme.border,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: first ? 1 : 0,
    borderBottomWidth: last ? 1 : 0,
    borderTopLeftRadius: first ? RADIUS.md : 0,
    borderTopRightRadius: first ? RADIUS.md : 0,
    borderBottomLeftRadius: last ? RADIUS.md : 0,
    borderBottomRightRadius: last ? RADIUS.md : 0,
  };
}

const STATUS = {
  new: { tone: 'success', word: 'Added' },
  modified: { tone: 'warning', word: 'Modified' },
  deleted: { tone: 'danger', word: 'Deleted' },
} as const;

type PromptKind = { kind: 'file' | 'folder' } | { kind: 'rename'; entry: Entry } | null;

export default function WorkspaceScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useWorkspace(id);
  const { settings, createConversation } = useStore();
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[] | null>(null);
  const [prompt, setPrompt] = useState<PromptKind>(null);
  const changes = ws ? Object.keys(ws.changes).length : 0;

  const load = useCallback(async () => {
    if (!ws) return;
    try {
      const list = await wsList(settings, ws, dir);
      setError('');
      setEntries(list);
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : String(e));
    }
    // reload when the changeset changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, ws?.changes, ws?.baseSha, dir, settings]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  if (!ws)
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center' }}>
        <EmptyState icon="folder" title="This workspace was removed." />
      </View>
    );

  const run = async (fn: () => Promise<unknown>, confirm?: string) => {
    const go = async () => {
      try {
        await fn();
        await load();
      } catch (e) {
        Alert.alert('Couldn’t do that', e instanceof Error ? e.message : String(e));
      }
    };
    if (confirm && ws.kind !== 'github') {
      Alert.alert(confirm, `This changes the ${ws.kind} folder right away.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: go },
      ]);
    } else await go();
  };

  const search = async () => {
    if (!query.trim()) return setResults(null);
    try {
      setResults(await wsSearch(settings, ws, query));
    } catch (e) {
      Alert.alert('Search failed', e instanceof Error ? e.message : String(e));
    }
  };

  const pull = async () => {
    if (ws.kind !== 'github') return load();
    try {
      const head = await branchHead(settings, ws.repo!, ws.branch!);
      if (head === ws.baseSha) return Alert.alert('Up to date', `${ws.branch} has no new commits.`);
      // Staged changes stay; the commit step checks for conflicts.
      patchWorkspace(ws.id, { baseSha: head });
    } catch (e) {
      Alert.alert('Couldn’t refresh', e instanceof Error ? e.message : String(e));
    }
  };

  const openFile = (path: string) => router.push({ pathname: '/workspaces/file', params: { id: ws.id, path } });
  const crumbs = dir ? dir.split('/') : [];

  const ask = () => {
    const conv = createConversation(undefined, ws.id);
    router.push(`/chat/${conv.id}`);
  };

  const separator = () => (
    <View style={{ backgroundColor: theme.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: theme.border }}>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: 46 }} />
    </View>
  );
  const rowStyle = (index: number, count: number) => ({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
    styles.item,
    groupStyle(theme, index, count),
    { backgroundColor: pressed || hovered ? theme.fill : theme.surface },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          title: ws.name,
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton name="refresh-cw" label="Refresh" size={19} onPress={pull} />
              <IconButton name="file-plus" label="New file" onPress={() => setPrompt({ kind: 'file' })} />
              <IconButton name="folder-plus" label="New folder" onPress={() => setPrompt({ kind: 'folder' })} />
            </View>
          ),
        }}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
        <Text style={{ color: theme.inkMuted, fontFamily: FONT.mono, fontSize: 12, lineHeight: 16 }} numberOfLines={1} ellipsizeMode="middle">
          {describeWorkspace(ws)}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <PillButton title="Ask the assistant" icon="message-circle" onPress={ask} style={{ flex: 1 }} />
          {ws.kind === 'github' && (
            <PillButton
              title={changes ? `Changes (${changes})` : 'Changes'}
              icon="git-commit"
              variant="secondary"
              onPress={() => router.push({ pathname: '/workspaces/changes', params: { id: ws.id } })}
            />
          )}
        </View>
        {ws.lastCommit && (
          <Text style={{ color: theme.inkFaint, fontSize: 12, lineHeight: 16 }}>
            Last commit <Text style={{ fontFamily: FONT.mono }}>{ws.lastCommit.sha.slice(0, 7)}</Text> → {ws.lastCommit.branch}
          </Text>
        )}
        <SearchField
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (!t) setResults(null);
          }}
          onSubmitEditing={search}
          placeholder="Search files and text"
        />
        {!results && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
            <Pressable onPress={() => setDir('')} accessibilityRole="link" accessibilityLabel={`${ws.name}, top folder`} style={styles.crumb}>
              <Text style={[styles.crumbText, { color: crumbs.length ? theme.accent : theme.ink, fontFamily: FONT.monoMedium }]}>{ws.name}</Text>
            </Pressable>
            {crumbs.map((c, i) => {
              const current = i === crumbs.length - 1;
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.crumbText, { color: theme.inkFaint, fontFamily: FONT.mono }]}>/</Text>
                  <Pressable onPress={() => setDir(crumbs.slice(0, i + 1).join('/'))} accessibilityRole="link" disabled={current} style={styles.crumb}>
                    <Text style={[styles.crumbText, { color: current ? theme.ink : theme.accent, fontFamily: FONT.mono }]}>{c}</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      {results ? (
        <FlatList
          data={results}
          keyExtractor={(r, i) => `${i}:${r}`}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={separator}
          ListEmptyComponent={<EmptyState icon="search" title="No matches." />}
          renderItem={({ item, index }) => {
            const path = item.replace(/(:\d+:.*| \(.*\))$/, '').replace(/\/$/, '');
            return (
              <Pressable onPress={() => (item.endsWith('/') ? (setDir(path), setResults(null)) : openFile(path))} style={rowStyle(index, results.length)}>
                <Icon name={item.endsWith('/') ? 'folder' : 'file-text'} size={16} />
                <Text style={[TYPE.code, { color: theme.ink, flex: 1 }]} numberOfLines={2}>
                  {item}
                </Text>
              </Pressable>
            );
          }}
        />
      ) : entries === null ? (
        <ActivityIndicator color={theme.inkMuted} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.path}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={separator}
          ListEmptyComponent={
            error ? (
              <Banner tone="danger" title="Couldn’t open this folder">
                {error}
              </Banner>
            ) : (
              <EmptyState icon="folder" title="Empty folder." />
            )
          }
          renderItem={({ item: e, index }) => (
            <Pressable
              onPress={() => (e.isDir ? setDir(e.path) : e.status !== 'deleted' && openFile(e.path))}
              onLongPress={() =>
                Alert.alert(e.name, undefined, [
                  { text: 'Rename / move', onPress: () => setPrompt({ kind: 'rename', entry: e }) },
                  {
                    text: ws.kind === 'github' ? 'Stage delete' : 'Delete',
                    style: 'destructive',
                    onPress: () => run(() => wsDelete(settings, ws, e.path), `Delete ${e.name}?`),
                  },
                  { text: 'Cancel', style: 'cancel' },
                ])
              }
              accessibilityRole="button"
              accessibilityLabel={e.status ? `${e.name}, ${STATUS[e.status].word}` : e.name}
              accessibilityHint="Long-press to rename, move or delete."
              style={rowStyle(index, entries.length)}
            >
              <Icon name={e.isDir ? 'folder' : 'file-text'} size={20} />
              <Text
                style={[
                  TYPE.callout,
                  {
                    flex: 1,
                    color: e.status === 'deleted' ? theme.inkFaint : theme.ink,
                    textDecorationLine: e.status === 'deleted' ? 'line-through' : 'none',
                  },
                ]}
                numberOfLines={1}
              >
                {e.name}
              </Text>
              {e.status && <StatusBadge tone={STATUS[e.status].tone}>{STATUS[e.status].word}</StatusBadge>}
              {!e.isDir && e.size !== undefined && (
                <Text style={{ color: theme.inkFaint, fontFamily: FONT.mono, fontSize: 12, lineHeight: 16 }}>{formatSize(e.size)}</Text>
              )}
              {e.isDir && <Icon name="chevron-right" size={16} color={theme.inkFaint} />}
            </Pressable>
          )}
        />
      )}

      <TextPrompt
        visible={!!prompt}
        title={prompt?.kind === 'rename' ? `Rename ${prompt.entry.name}` : prompt?.kind === 'folder' ? 'New folder' : 'New file'}
        initialValue={prompt?.kind === 'rename' ? prompt.entry.path : dir ? `${dir}/` : ''}
        placeholder="path/name"
        onClose={() => setPrompt(null)}
        onSubmit={(value) => {
          const p = prompt;
          setPrompt(null);
          if (!p || !value.trim()) return;
          if (p.kind === 'rename') run(() => wsRename(settings, ws, p.entry.path, value), `Rename ${p.entry.name}?`);
          else if (p.kind === 'folder') run(() => wsMkdir(settings, ws, joinPath('', value)));
          else
            run(async () => {
              await wsWrite(settings, ws, value, '');
              openFile(joinPath('', value));
            });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  crumbs: { alignItems: 'center', minHeight: 44 },
  crumb: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  crumbText: { fontSize: 13, lineHeight: 18 },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 48 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 52, overflow: 'hidden' },
});
