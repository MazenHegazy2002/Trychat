import { router, usePathname } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../lib/store';
import { RADIUS, SIZE, TYPE, useTheme } from '../lib/theme';
import type { Conversation } from '../lib/types';
import { useTasks } from '../lib/useTasks';
import { Text, TextInput } from './Text';
import { Icon, IconButton, Mark, RunningDot } from './ui';
import type { IconName } from './ui';

/**
 * The chat list as a sidebar beside the open chat, from 900px wide (iPad, Mac, Windows, web):
 * new chat and search, places (projects, workspaces, design, tasks, memory, files), projects as
 * folders, recent chats, and the account and settings at the bottom.
 */

function go(pathname: string, href: string) {
  if (pathname === href) return;
  // From the home panel open on top of it; elsewhere swap the screen so the stack doesn't pile up.
  if (pathname === '/') router.push(href as never);
  else router.replace(href as never);
}

function NavRow({
  icon,
  label,
  href,
  pathname,
  count,
  running,
}: {
  icon: IconName;
  label: string;
  href: string;
  pathname: string;
  count?: number;
  running?: number;
}) {
  const theme = useTheme();
  const selected = pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
  return (
    <Pressable
      onPress={() => go(pathname, href)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.navRow,
        { backgroundColor: selected ? theme.accentSoft : pressed || hovered ? theme.fill : 'transparent' },
      ]}
    >
      <Icon name={icon} size={16} color={selected ? theme.accent : theme.inkMuted} />
      <Text style={{ flex: 1, color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: selected ? '600' : '500' }} numberOfLines={1}>
        {label}
      </Text>
      {!!running && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <RunningDot size={6} />
          <Text style={{ color: theme.inkMuted, fontSize: 12 }}>{running}</Text>
        </View>
      )}
      {!running && !!count && <Text style={{ color: theme.inkFaint, fontSize: 12 }}>{count}</Text>}
    </Pressable>
  );
}

function ChatRow({ chat, pathname }: { chat: Conversation; pathname: string }) {
  const theme = useTheme();
  const { busy } = useStore();
  const href = `/chat/${chat.id}`;
  const selected = pathname === href;
  return (
    <Pressable
      onPress={() => go(pathname, href)}
      accessibilityRole="button"
      accessibilityLabel={chat.title}
      accessibilityState={{ selected }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.navRow,
        { backgroundColor: selected ? theme.accentSoft : pressed || hovered ? theme.fill : 'transparent' },
      ]}
    >
      <Text style={{ flex: 1, color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: selected ? '600' : '400' }} numberOfLines={1}>
        {chat.title || 'New chat'}
      </Text>
      {busy[chat.id] && <RunningDot size={6} />}
    </Pressable>
  );
}

export function Sidebar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { conversations, projects, memories, account, createConversation } = useStore();
  const running = useTasks().filter((t) => t.status === 'running').length;
  const [query, setQuery] = useState('');
  const search = useRef<ComponentRef<typeof TextInput>>(null);

  // Ctrl/⌘+K jumps to search on the web and desktop apps.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const chats = useMemo(
    () =>
      [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => (m.displayText ?? m.content).toLowerCase().includes(q))),
    [conversations, q],
  );
  const recentProjects = useMemo(() => [...projects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5), [projects]);

  const newChat = () => {
    const conv = createConversation();
    go(pathname, `/chat/${conv.id}`);
  };

  const header = (
    <View>
      {!q && (
        <View style={{ gap: 2, paddingTop: 12 }}>
          <NavRow icon="folder" label="Projects" href="/projects" pathname={pathname} count={projects.length} />
          <NavRow icon="code" label="Workspaces" href="/workspaces" pathname={pathname} />
          <NavRow icon="pen-tool" label="Design studio" href="/designs" pathname={pathname} />
          <NavRow icon="terminal" label="Tasks & terminal" href="/tasks" pathname={pathname} running={running} />
          <NavRow icon="book-open" label="Memory" href="/memory" pathname={pathname} count={memories.length} />
          <NavRow icon="file" label="Files" href="/files" pathname={pathname} />
        </View>
      )}
      {!q && recentProjects.length > 0 && (
        <>
          <Text style={[TYPE.overline, styles.overline, { color: theme.inkFaint }]} accessibilityRole="header" accessibilityLabel="Projects">
            Projects
          </Text>
          {recentProjects.map((p) => (
            <NavRow
              key={p.id}
              icon="folder"
              label={p.name}
              href={`/projects/${p.id}`}
              pathname={pathname}
              count={conversations.filter((c) => c.projectId === p.id).length || undefined}
            />
          ))}
        </>
      )}
      <Text style={[TYPE.overline, styles.overline, { color: theme.inkFaint }]} accessibilityRole="header" accessibilityLabel={q ? 'Results' : 'Recent'}>
        {q ? 'Results' : 'Recent'}
      </Text>
    </View>
  );

  return (
    <View
      style={[
        styles.sidebar,
        { backgroundColor: theme.surface, borderRightColor: theme.border, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12) },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingBottom: 12 }}>
        <Mark size={24} />
        <Text style={[TYPE.headline, { flex: 1, color: theme.ink }]}>TryChat</Text>
        <IconButton name="edit" label="New chat" onPress={newChat} color={theme.ink} size={18} style={{ width: 36, height: 36, borderRadius: RADIUS.sm }} />
      </View>

      <View style={[styles.search, { backgroundColor: theme.fill }]}>
        <Icon name="search" size={16} color={theme.inkFaint} />
        <TextInput
          ref={search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats"
          accessibilityLabel="Search chats"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.searchInput, { color: theme.ink }]}
        />
        {Platform.OS === 'web' && !query && <Text style={[TYPE.codeLabel, { color: theme.inkFaint }]} numberOfLines={1}>Ctrl+K</Text>}
      </View>

      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ChatRow chat={item} pathname={pathname} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={{ color: theme.inkMuted, fontSize: 13, paddingHorizontal: 10, paddingVertical: 6 }}>
            {q ? 'No matching chats.' : 'No chats yet.'}
          </Text>
        }
        contentContainerStyle={{ gap: 2, paddingBottom: 12 }}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
      />

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Pressable
          onPress={() => go(pathname, '/account')}
          accessibilityRole="button"
          accessibilityLabel={account ? account.user.name || account.user.email : 'Sign in'}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.account,
            { backgroundColor: pressed || hovered ? theme.fill : 'transparent' },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: account ? theme.accentSoft : theme.fill }]}>
            {account ? (
              <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '600' }}>
                {(account.user.name || account.user.email)[0]?.toUpperCase()}
              </Text>
            ) : (
              <Icon name="user" size={16} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: '500' }} numberOfLines={1}>
              {account ? account.user.name || account.user.email : 'Sign in'}
            </Text>
            <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 16 }} numberOfLines={1}>
              {account ? 'Memory and chats synced' : 'Sync memory and chats'}
            </Text>
          </View>
        </Pressable>
        <IconButton
          name="settings"
          label="Settings"
          onPress={() => go(pathname, '/settings')}
          active={pathname === '/settings'}
          size={18}
          style={{ width: 36, height: 36, borderRadius: RADIUS.sm }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: SIZE.sidebar, borderRightWidth: 1, paddingHorizontal: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, borderRadius: RADIUS.sm, paddingHorizontal: 12 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, paddingVertical: 8, outlineStyle: 'none' } as object,
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36, paddingHorizontal: 10, borderRadius: RADIUS.sm },
  overline: { paddingHorizontal: 10, paddingTop: 18, paddingBottom: 6 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 4, borderTopWidth: 1, paddingTop: 8 },
  account: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 6, borderRadius: RADIUS.sm },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
