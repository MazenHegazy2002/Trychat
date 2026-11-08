import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { FileTile, fileTypeLabel, useFileUi } from '../components/FileCards';
import type { FileExtraAction } from '../components/FileCards';
import { EmptyState, IconButton, ScreenIntro, SearchField } from '../components/ui';
import { formatSize } from '../lib/attachments';
import { copyForAttachment } from '../lib/fileActions';
import { fileGroup } from '../lib/fileKinds';
import { listLibrary, queueAttachments, removeFromLibrary, subscribeLibrary } from '../lib/library';
import type { LibraryFile } from '../lib/library';
import { useStore } from '../lib/store';
import { RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../lib/theme';
import type { Attachment } from '../lib/types';
import { displayUri } from '../lib/webFiles';
import { Text } from '../components/Text';

type Filter = 'all' | 'images' | 'documents' | 'friends';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['images', 'Images'],
  ['documents', 'Documents'],
  ['friends', 'From friends'],
];

function matches(f: LibraryFile, filter: Filter): boolean {
  if (filter === 'images') return f.kind === 'image' || fileGroup(f.name, f.mimeType) === 'image';
  if (filter === 'documents') return f.kind !== 'image' && fileGroup(f.name, f.mimeType) !== 'image';
  if (filter === 'friends') return f.origin === 'shared';
  return true;
}

const ORIGIN: Record<string, string> = { assistant: 'from TryChat', upload: 'from you', shared: 'from a friend', project: 'project file' };

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

export default function FilesScreen() {
  const theme = useTheme();
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;
  const store = useStore();
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const refresh = useCallback(() => {
    listLibrary()
      .then(setFiles)
      .catch(() => setFiles([]));
  }, []);
  useEffect(() => {
    refresh();
    return subscribeLibrary(refresh);
  }, [refresh]);

  const attachToNewChat = async (a: Attachment) => {
    try {
      const copy = await copyForAttachment(a);
      const conv = store.createConversation();
      queueAttachments(conv.id, [copy]);
      router.push(`/chat/${conv.id}`);
    } catch (e) {
      Alert.alert('Couldn’t attach', e instanceof Error ? e.message : String(e));
    }
  };

  const remove = (a: Attachment) =>
    Alert.alert('Delete file?', `${a.name} will be removed from this device${a.origin === 'upload' ? ' and from the chat it was sent in' : ''}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeFromLibrary(a.id).catch(() => {}) },
    ]);

  const extra: FileExtraAction[] = [
    { label: 'Attach to a new chat', icon: 'message-circle', onPress: attachToNewChat },
    { label: 'Delete', icon: 'trash-2', destructive: true, onPress: remove },
  ];
  const { open, showMenu, ui } = useFileUi(extra);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (files ?? []).filter((f) => matches(f, filter) && (!q || f.name.toLowerCase().includes(q) || fileTypeLabel(f).toLowerCase().includes(q))),
    [files, filter, q],
  );
  const total = (files ?? []).reduce((n, f) => n + (f.size || 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        keyboardDismissMode="on-drag"
        data={shown}
        keyExtractor={(f) => f.id}
        contentContainerStyle={[styles.page, wide && styles.pageWide]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ marginBottom: 12 }}>
            <ScreenIntro title="Files">Every file sent, received and shared, kept on this device.</ScreenIntro>
            {files !== null && (
              <Text style={[TYPE.caption, { color: theme.inkMuted, marginTop: -12, marginBottom: 16 }]} accessibilityLabel="Storage used">
                {files.length} file{files.length === 1 ? '' : 's'} · {formatSize(total)} on this device
              </Text>
            )}
            <SearchField value={query} onChangeText={setQuery} placeholder="Search files" accessibilityLabel="Search files" />
            <View style={styles.filters} accessibilityRole="tablist">
              {FILTERS.map(([key, label]) => {
                const on = filter === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setFilter(key)}
                    hitSlop={{ top: 4, bottom: 4 }}
                    style={[styles.filter, { backgroundColor: on ? theme.accentSoft : theme.fill }]}
                    accessibilityRole="tab"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[TYPE.subhead, { color: on ? theme.ink : theme.inkMuted }, on && { fontWeight: '600' }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          files === null ? null : files.length ? (
            <EmptyState icon="search" title="No files match">
              Try another name or filter.
            </EmptyState>
          ) : (
            <EmptyState icon="folder" title="No files yet">
              Ask TryChat for a PDF, a spreadsheet or any file, or attach one in a chat. They all show up here.
            </EmptyState>
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            onLongPress={() => showMenu(item)}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.row,
              { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${fileTypeLabel(item)}, ${formatSize(item.size)}`}
            accessibilityHint="Opens the file. Long-press for more options."
          >
            {item.kind === 'image' ? (
              <Image source={{ uri: displayUri(item.uri) }} style={[styles.thumb, { backgroundColor: theme.fill }]} />
            ) : (
              <FileTile file={item} />
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '500' }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[TYPE.codeLabel, { color: theme.inkFaint, marginTop: 2 }]} numberOfLines={1}>
                {fileTypeLabel(item)} · {formatSize(item.size)} · {ORIGIN[item.origin ?? 'upload'] ?? ''} · {when(item.addedAt)}
              </Text>
            </View>
            <IconButton name="more-horizontal" label={`Options for ${item.name}`} onPress={() => showMenu(item)} />
          </Pressable>
        )}
      />
      {ui}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },
  pageWide: { width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 28 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  filter: { minHeight: 36, paddingHorizontal: 14, borderRadius: RADIUS.pill, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingLeft: 12, paddingRight: 4, paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1 },
  thumb: { width: 40, height: 40, borderRadius: RADIUS.sm },
});
