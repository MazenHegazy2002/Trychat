import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Card, Divider, EmptyState, Icon, IconButton, IconTile, PillButton, ScreenIntro, SearchField, SectionLabel } from '../../components/ui';
import { useStore } from '../../lib/store';
import { RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../../lib/theme';
import type { ChatMessage, Conversation } from '../../lib/types';
import { Text } from '../../components/Text';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shownText = (m: ChatMessage) => m.displayText ?? m.content;

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ProjectsScreen() {
  const theme = useTheme();
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;
  const { projects, conversations } = useStore();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const shown = [...projects]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  const loose = [...conversations].filter((c) => !c.projectId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const newProject = () => router.push('/projects/new');

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[styles.page, wide && styles.pageWide]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Stack.Screen options={{ headerRight: () => <IconButton name="plus" label="New project" onPress={newProject} /> }} />
      <ScreenIntro title="Projects">Folders of chats that share instructions and files.</ScreenIntro>

      {projects.length === 0 ? (
        <Card>
          <EmptyState icon="folder" title="No projects yet" action={<PillButton title="New project" icon="plus" onPress={newProject} />}>
            Group chats into a project and give them shared instructions and files.
          </EmptyState>
        </Card>
      ) : (
        <>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search projects" style={{ marginBottom: 12 }} />
          <View style={{ gap: 8 }}>
            {shown.map((p) => {
              const chats = conversations.filter((c) => c.projectId === p.id).length;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => router.push(`/projects/${p.id}`)}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.project,
                    { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
                  ]}
                  accessibilityRole="button"
                >
                  <IconTile name="folder" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '600' }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {!!p.description && (
                      <Text style={[TYPE.caption, { color: theme.inkMuted }]} numberOfLines={1}>
                        {p.description}
                      </Text>
                    )}
                    <Text style={[TYPE.caption, { color: theme.inkFaint, fontSize: 12, lineHeight: 16, marginTop: 2 }]}>
                      {plural(chats, 'chat')} · {plural(p.files.length, 'file')}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={16} color={theme.inkFaint} />
                </Pressable>
              );
            })}
          </View>
          {!!q && !shown.length && <EmptyState icon="search" title="No matching projects">{`Nothing matches “${query}”.`}</EmptyState>}
        </>
      )}

      {loose.length > 0 && (
        <>
          <SectionLabel>Chats not in a project</SectionLabel>
          <Card>
            {loose.map((c, i) => (
              <View key={c.id}>
                {i > 0 && <Divider inset={16} />}
                <ChatRow chat={c} />
              </View>
            ))}
          </Card>
          <Text style={[TYPE.caption, { color: theme.inkFaint, marginTop: 8, marginHorizontal: 4 }]}>
            Long-press a chat in your chat list to move it into a project.
          </Text>
        </>
      )}
    </KeyboardAwareScrollView>
  );
}

/** Title and time, then the last message on one line (like the chat list). */
function ChatRow({ chat }: { chat: Conversation }) {
  const theme = useTheme();
  const last = [...chat.messages].reverse().find((m) => !m.toolResult && shownText(m));
  return (
    <Pressable
      onPress={() => router.push(`/chat/${chat.id}`)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.chatRow, (pressed || hovered) && { backgroundColor: theme.fill }]}
      accessibilityRole="button"
      accessibilityLabel={chat.title}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        <Text style={[TYPE.callout, { flex: 1, color: theme.ink, fontWeight: '500' }]} numberOfLines={1}>
          {chat.title}
        </Text>
        <Text style={[TYPE.caption, { color: theme.inkFaint }]}>{timeAgo(chat.updatedAt)}</Text>
      </View>
      <Text style={[TYPE.caption, { color: theme.inkMuted, marginTop: 2 }]} numberOfLines={1}>
        {last ? shownText(last).replace(/\s+/g, ' ') : 'Empty chat'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },
  pageWide: { width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 28 },
  project: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 64, borderRadius: RADIUS.md, borderWidth: 1 },
  chatRow: { paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
});
