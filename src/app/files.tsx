import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fileIcon, useFileUi } from '../components/FileCards';
import type { FileExtraAction } from '../components/FileCards';
import { Icon, ScreenIntro } from '../components/ui';
import { formatSize } from '../lib/attachments';
import { copyForAttachment } from '../lib/fileActions';
import { fileGroup, typeLabel } from '../lib/fileKinds';
import { listLibrary, queueAttachments, removeFromLibrary, subscribeLibrary } from '../lib/library';
import type { LibraryFile } from '../lib/library';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { Attachment } from '../lib/types';
import { displayUri } from '../lib/webFiles';

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

const ORIGIN: Record<string, string> = { assistant: 'From TryChat', upload: 'You sent', shared: 'From a friend', project: 'Project file' };

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

export default function FilesScreen() {
  const theme = useTheme();
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
    () => (files ?? []).filter((f) => matches(f, filter) && (!q || f.name.toLowerCase().includes(q) || typeLabel(f.name, f.mimeType).toLowerCase().includes(q))),
    [files, filter, q],
  );
  const total = (files ?? []).reduce((n, f) => n + (f.size || 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        data={shown}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <ScreenIntro title="Files">Every file sent, received and shared, kept on this device.</ScreenIntro>
            {files !== null && (
              <Text style={{ color: theme.muted, fontSize: 13, marginTop: -8, marginBottom: 12 }} accessibilityLabel="Storage used">
                {files.length} file{files.length === 1 ? '' : 's'} · {formatSize(total)} on this device
              </Text>
            )}
            <View style={[styles.search, { backgroundColor: theme.surface2 }]}>
              <Icon name="search" size={16} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search files"
                placeholderTextColor={theme.faint}
                style={{ flex: 1, color: theme.text, fontSize: 15, paddingVertical: 10 }}
                accessibilityLabel="Search files"
                autoCorrect={false}
              />
            </View>
            <View style={styles.filters} accessibilityRole="tablist">
              {FILTERS.map(([key, label]) => {
                const on = filter === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setFilter(key)}
                    style={[styles.filter, { backgroundColor: on ? theme.text : theme.surface, borderColor: on ? theme.text : theme.border }]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={{ color: on ? theme.bg : theme.text, fontSize: 13, fontWeight: '500' }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          files === null ? null : (
            <View style={[styles.empty, { borderColor: theme.border }]}>
              <Icon name="folder" size={24} />
              <Text style={{ color: theme.muted, textAlign: 'center', marginTop: 8 }}>
                {files.length
                  ? 'No files match.'
                  : 'No files yet. Ask TryChat for a PDF, a chart or any file, or attach one in a chat — they’ll all show up here.'}
              </Text>
            </View>
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: 64 }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            onLongPress={() => showMenu(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surface2 }]}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${typeLabel(item.name, item.mimeType)}, ${formatSize(item.size)}`}
            accessibilityHint="Opens the file. Long-press for more options."
          >
            {item.kind === 'image' ? (
              <Image source={{ uri: displayUri(item.uri) }} style={[styles.thumb, { backgroundColor: theme.surface2 }]} />
            ) : (
              <View style={[styles.thumb, styles.tile, { backgroundColor: theme.surface2 }]}>
                <Icon name={fileIcon(item)} size={20} color={theme.text} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {formatSize(item.size)} · {typeLabel(item.name, item.mimeType)} · {ORIGIN[item.origin ?? 'upload'] ?? ''} · {when(item.addedAt)}
              </Text>
            </View>
            <Pressable onPress={() => showMenu(item)} style={styles.more} accessibilityRole="button" accessibilityLabel={`Options for ${item.name}`}>
              <Icon name="more-vertical" size={18} />
            </Pressable>
          </Pressable>
        )}
      />
      {ui}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  filter: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8, borderRadius: 8 },
  thumb: { width: 48, height: 48, borderRadius: 10 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  more: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, padding: 24, alignItems: 'center', marginTop: 8 },
});
