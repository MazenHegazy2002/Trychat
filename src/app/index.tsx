import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoveToProjectSheet } from '../components/MoveToProjectSheet';
import { StorageIssuesBanner } from '../components/StorageIssues';
import { TasksPill } from '../components/TasksPill';
import { Text } from '../components/Text';
import { TextPrompt } from '../components/TextPrompt';
import { Banner, EmptyState, Icon, IconButton, Mark, PillButton, SearchField } from '../components/ui';
import type { IconName } from '../components/ui';
import { useStore } from '../lib/store';
import { RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, shadow, useTheme } from '../lib/theme';
import type { ChatMessage } from '../lib/types';

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString();
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** What the chat shows for a message: the typed "/command args", not the prompt it expanded to. */
const shownText = (m: ChatMessage) => m.displayText ?? m.content;

/** A shortcut tile on the home screen (Projects, Workspaces, Design, Memory). */
function Shortcut({ icon, label, count, onPress }: { icon: IconName; label: string; count?: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label} (${count})` : label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.tile,
        { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
      ]}
    >
      <Icon name={icon} size={20} />
      <Text style={[TYPE.callout, { flex: 1, color: theme.ink, fontFamily: undefined, fontWeight: '500' }]} numberOfLines={1}>
        {label}
      </Text>
      {!!count && <Text style={[TYPE.caption, { color: theme.inkMuted }]}>{count}</Text>}
    </Pressable>
  );
}

function SetupBanner() {
  const { settings } = useStore();
  if (settings.apiKey && settings.model) return null;
  return (
    <Banner title="Finish setup" icon="settings" onPress={() => router.push('/settings')} style={{ marginHorizontal: 16, marginTop: 12 }}>
      {!settings.apiKey ? 'Add your API key' : 'Pick a model'} in Settings to start chatting.
    </Banner>
  );
}

/** From 900px wide the chats live in the sidebar, so home becomes a welcome panel. */
function WideHome() {
  const theme = useTheme();
  const { projects, memories, createConversation } = useStore();
  const newChat = () => {
    const conv = createConversation();
    router.push(`/chat/${conv.id}`);
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={styles.wideScroll}>
      <View style={styles.wideColumn}>
        <View style={[styles.markTile, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Mark size={40} />
        </View>
        <Text style={[TYPE.display, { color: theme.ink, textAlign: 'center', marginTop: 20 }]}>{greeting()}</Text>
        <Text style={[TYPE.body, { color: theme.inkMuted, textAlign: 'center', marginTop: 8, maxWidth: 460 }]}>
          Ask anything, build an app that runs right here, or work in your projects and folders.
        </Text>
        <PillButton title="New chat" icon="edit" size="lg" onPress={newChat} style={{ marginTop: 24, paddingHorizontal: 28 }} />
        <SetupBanner />
        <View style={styles.wideGrid}>
          <Shortcut icon="folder" label="Projects" count={projects.length} onPress={() => router.push('/projects')} />
          <Shortcut icon="code" label="Workspaces" onPress={() => router.push('/workspaces')} />
          <Shortcut icon="pen-tool" label="Design studio" onPress={() => router.push('/designs')} />
          <Shortcut icon="book-open" label="Memory" count={memories.length} onPress={() => router.push('/memory')} />
        </View>
      </View>
    </ScrollView>
  );
}

export default function ConversationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { conversations, projects, memories, createConversation, deleteConversation, renameConversation } = useStore();
  const [moving, setMoving] = useState<string | null>(null);
  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name;
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  if (width >= WIDE_BREAKPOINT) return <WideHome />;

  const q = query.toLowerCase();
  const list = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => shownText(m).toLowerCase().includes(q)));

  const newChat = () => {
    const conv = createConversation();
    router.push(`/chat/${conv.id}`);
  };

  const onLongPress = (id: string, title: string) => {
    // Android shows at most three buttons, so dismissing (tap outside / back) is the cancel.
    Alert.alert(
      title,
      undefined,
      [
        { text: 'Rename', onPress: () => setRenaming({ id, title }) },
        { text: 'Move to project', onPress: () => setMoving(id) },
        { text: 'Delete', style: 'destructive', onPress: () => deleteConversation(id) },
      ],
      { cancelable: true },
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          headerTitleAlign: 'left',
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mark size={26} />
              <Text style={[TYPE.headline, { color: theme.ink }]}>TryChat</Text>
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <TasksPill hideWhenIdle />
              <IconButton name="settings" label="Settings" onPress={() => router.push('/settings')} />
            </View>
          ),
        }}
      />

      <StorageIssuesBanner />
      <SetupBanner />

      <SearchField value={query} onChangeText={setQuery} placeholder="Search chats" style={{ marginHorizontal: 16, marginTop: 12 }} />

      <FlatList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 104 }}
        ListHeaderComponent={
          query ? null : (
            <View>
              <View style={styles.grid}>
                <Shortcut icon="folder" label="Projects" count={projects.length} onPress={() => router.push('/projects')} />
                <Shortcut icon="code" label="Workspaces" onPress={() => router.push('/workspaces')} />
                <Shortcut icon="pen-tool" label="Design" onPress={() => router.push('/designs')} />
                <Shortcut icon="book-open" label="Memory" count={memories.length} onPress={() => router.push('/memory')} />
              </View>
              {list.length > 0 && (
                <Text style={[TYPE.overline, styles.overline, { color: theme.inkFaint }]} accessibilityRole="header" accessibilityLabel="Recent">
                  Recent
                </Text>
              )}
            </View>
          )
        }
        ListEmptyComponent={
          query ? (
            <EmptyState icon="search" title="No matching chats" />
          ) : (
            <EmptyState icon="message-square" title="No chats yet">
              Start one with New chat. Apps and games you ask for run right here.
            </EmptyState>
          )
        }
        renderItem={({ item, index }) => {
          const last = [...item.messages].reverse().find((m) => !m.toolResult && shownText(m));
          const project = projectName(item.projectId);
          return (
            <Pressable
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => onLongPress(item.id, item.title)}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              accessibilityHint="Opens the chat. Long press for rename, move and delete."
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.fill : 'transparent' }]}
            >
              <View style={[styles.rowInner, index < list.length - 1 && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
                  <Text style={[TYPE.callout, { flex: 1, color: theme.ink, fontFamily: undefined, fontWeight: '500' }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[TYPE.caption, { color: theme.inkFaint }]}>{timeAgo(item.updatedAt)}</Text>
                </View>
                <Text style={[TYPE.caption, { color: theme.inkMuted, marginTop: 3 }]} numberOfLines={1}>
                  {last ? shownText(last).replace(/\s+/g, ' ') : 'Empty chat'}
                </Text>
                {!!project && (
                  <View style={[styles.projectTag, { backgroundColor: theme.fill }]}>
                    <Icon name="folder" size={12} />
                    <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 16 }}>{project}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      <TextPrompt
        visible={!!renaming}
        title="Rename chat"
        initialValue={renaming?.title}
        onSubmit={(t) => renaming && renameConversation(renaming.id, t)}
        onClose={() => setRenaming(null)}
      />

      <MoveToProjectSheet conversationId={moving} onClose={() => setMoving(null)} />

      <Pressable
        onPress={newChat}
        accessibilityRole="button"
        accessibilityLabel="New chat"
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: pressed ? theme.accentPress : theme.accent, bottom: insets.bottom + 20 },
          shadow(theme, 'glow'),
        ]}
      >
        <Icon name="edit" size={20} color={theme.onAccent} />
        <Text style={{ color: theme.onAccent, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>New chat</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  overline: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 4 },
  row: { paddingHorizontal: 16 },
  rowInner: { paddingVertical: 12 },
  projectTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.xs,
  },
  fab: {
    position: 'absolute',
    right: 16,
    height: SIZE.controlLg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 18,
    paddingRight: 22,
    borderRadius: RADIUS.pill,
  },
  wideScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  wideColumn: { width: '100%', maxWidth: 560, alignItems: 'center' },
  markTile: { width: 72, height: 72, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  wideGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 32, width: '100%' },
});
