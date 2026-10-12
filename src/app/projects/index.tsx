import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Card, Divider, Icon, ScreenIntro, SectionLabel } from '../../components/ui';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';

export default function ProjectsScreen() {
  const theme = useTheme();
  const { projects, conversations } = useStore();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const shown = [...projects]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  const loose = [...conversations].filter((c) => !c.projectId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);

  return (
    <KeyboardAwareScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/projects/new')} style={styles.headerBtn} accessibilityLabel="New project">
              <Icon name="plus" size={22} color={theme.text} />
            </Pressable>
          ),
        }}
      />
      <ScreenIntro title="Your projects">Group chats, give them shared instructions and files.</ScreenIntro>

      <View style={[styles.search, { backgroundColor: theme.surface2 }]}>
        <Icon name="search" size={16} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search projects"
          placeholderTextColor={theme.faint}
          style={{ flex: 1, color: theme.text, fontSize: 15, paddingVertical: 10 }}
          accessibilityLabel="Search projects"
        />
      </View>

      <View style={styles.grid}>
        {shown.map((p, i) => {
          const chats = conversations.filter((c) => c.projectId === p.id).length;
          return (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/projects/${p.id}`)}
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              accessibilityRole="button"
            >
              <View style={[styles.tile, { backgroundColor: i === 0 ? theme.oat : theme.surface2 }]}>
                <Icon name="folder" size={16} color={i === 0 ? theme.primary : theme.text} />
              </View>
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500', marginTop: 10 }} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2, flex: 1 }} numberOfLines={2}>
                {p.description || 'No description'}
              </Text>
              <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>
                {chats} chat{chats === 1 ? '' : 's'} · {p.files.length} file{p.files.length === 1 ? '' : 's'}
              </Text>
            </Pressable>
          );
        })}
        {!q && (
          <Pressable
            onPress={() => router.push('/projects/new')}
            style={[styles.card, styles.newCard, { borderColor: theme.oat }]}
            accessibilityRole="button"
          >
            <Icon name="plus" size={22} color={theme.muted} />
            <Text style={{ color: theme.muted, fontSize: 14, fontWeight: '500', marginTop: 6 }}>New project</Text>
          </Pressable>
        )}
      </View>
      {q && !shown.length && <Text style={{ color: theme.muted, marginTop: 12 }}>No projects match “{query}”.</Text>}

      {loose.length > 0 && (
        <>
          <SectionLabel>Chats not in a project</SectionLabel>
          <Card>
            {loose.map((c, i) => (
              <View key={c.id}>
                {i > 0 && <Divider />}
                <Pressable onPress={() => router.push(`/chat/${c.id}`)} style={styles.chatRow} accessibilityRole="button">
                  <Text style={{ color: theme.text, fontSize: 15, flex: 1 }} numberOfLines={1}>
                    {c.title}
                  </Text>
                  <Icon name="chevron-right" size={16} />
                </Pressable>
              </View>
            ))}
          </Card>
          <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>Long-press a chat in your chat list to move it into a project.</Text>
        </>
      )}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: { width: '48.5%', minHeight: 140, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  newCard: { borderStyle: 'dashed', borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, minHeight: 52 },
});
