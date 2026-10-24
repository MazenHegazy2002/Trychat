import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { TextPrompt } from '../../components/TextPrompt';
import { Icon, PillButton } from '../../components/ui';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { describeWorkspace, wsDelete, wsList, wsMkdir, wsRename, wsSearch, wsWrite } from '../../lib/workspace/backends';
import type { Entry } from '../../lib/workspace/core';
import { branchHead, joinPath } from '../../lib/workspace/core';
import { patchWorkspace, useWorkspace } from '../../lib/workspace/store';

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

  if (!ws) return <Text style={{ padding: 20, color: theme.muted }}>This workspace was removed.</Text>;

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

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          title: ws.name,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <Pressable onPress={pull} hitSlop={8} accessibilityLabel="Refresh">
                <Icon name="refresh-cw" size={19} color={theme.text} />
              </Pressable>
              <Pressable onPress={() => setPrompt({ kind: 'file' })} hitSlop={8} accessibilityLabel="New file">
                <Icon name="file-plus" size={20} color={theme.text} />
              </Pressable>
              <Pressable onPress={() => setPrompt({ kind: 'folder' })} hitSlop={8} accessibilityLabel="New folder">
                <Icon name="folder-plus" size={20} color={theme.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <Text style={{ color: theme.muted, fontSize: 12 }}>{describeWorkspace(ws)}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
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
          <Text style={{ color: theme.faint, fontSize: 12, marginTop: 6 }}>
            Last commit {ws.lastCommit.sha.slice(0, 7)} → {ws.lastCommit.branch}
          </Text>
        )}
        <View style={[styles.search, { backgroundColor: theme.surface2 }]}>
          <Icon name="search" size={15} />
          <TextInput
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              if (!t) setResults(null);
            }}
            onSubmitEditing={search}
            returnKeyType="search"
            placeholder="Search files and text"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, color: theme.text, paddingVertical: 9, fontSize: 15 }}
          />
        </View>
        {!results && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
            <Pressable onPress={() => setDir('')}>
              <Text style={{ color: theme.primary, fontWeight: '600' }}>{ws.name}</Text>
            </Pressable>
            {crumbs.map((c, i) => (
              <Pressable key={i} onPress={() => setDir(crumbs.slice(0, i + 1).join('/'))} style={{ flexDirection: 'row' }}>
                <Text style={{ color: theme.faint }}> / </Text>
                <Text style={{ color: i === crumbs.length - 1 ? theme.text : theme.primary }}>{c}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {results ? (
        <FlatList
          data={results}
          keyExtractor={(r, i) => `${i}:${r}`}
          ListEmptyComponent={<Text style={{ color: theme.muted, padding: 16 }}>No matches.</Text>}
          renderItem={({ item }) => {
            const path = item.replace(/(:\d+:.*| \(.*\))$/, '').replace(/\/$/, '');
            return (
              <Pressable onPress={() => (item.endsWith('/') ? (setDir(path), setResults(null)) : openFile(path))} style={styles.item}>
                <Text style={{ color: theme.text, fontFamily: 'monospace', fontSize: 13 }} numberOfLines={2}>
                  {item}
                </Text>
              </Pressable>
            );
          }}
        />
      ) : entries === null ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.path}
          contentContainerStyle={{ paddingBottom: 48 }}
          ListEmptyComponent={<Text style={{ color: error ? theme.danger : theme.muted, padding: 16 }}>{error || 'Empty folder.'}</Text>}
          renderItem={({ item: e }) => (
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
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.surface2 }]}
            >
              <Icon name={e.isDir ? 'folder' : 'file-text'} size={17} color={e.isDir ? theme.accent : theme.muted} />
              <Text
                style={{
                  flex: 1,
                  color: e.status === 'deleted' ? theme.faint : theme.text,
                  textDecorationLine: e.status === 'deleted' ? 'line-through' : 'none',
                  fontSize: 15,
                }}
                numberOfLines={1}
              >
                {e.name}
              </Text>
              {e.status && (
                <Text style={{ color: e.status === 'deleted' ? theme.danger : theme.primary, fontSize: 12, fontWeight: '700' }}>
                  {e.status === 'new' ? 'A' : e.status === 'deleted' ? 'D' : 'M'}
                </Text>
              )}
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
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, marginTop: 10 },
  crumbs: { paddingVertical: 10, alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
});
