import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { TextPrompt } from '../../components/TextPrompt';
import { Card, Divider, Icon, PillButton, SectionLabel } from '../../components/ui';
import { deleteAttachmentFiles, formatSize, pickFiles } from '../../lib/attachments';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';

type Field = 'name' | 'description' | 'instructions';

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { projects, conversations, saveProject, deleteProject, createConversation } = useStore();
  const project = projects.find((p) => p.id === id);
  const [editing, setEditing] = useState<Field | null>(null);
  const [adding, setAdding] = useState(false);

  if (!project) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.muted }}>This project no longer exists.</Text>
      </View>
    );
  }

  const chats = conversations.filter((c) => c.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt);

  const newChat = () => {
    const conv = createConversation(project.id);
    router.push(`/chat/${conv.id}`);
  };

  const addFiles = async () => {
    setAdding(true);
    try {
      const files = await pickFiles();
      if (!files.length) return;
      const unreadable = files.filter((f) => f.kind === 'image' || f.text === undefined);
      saveProject({ ...project, files: [...project.files, ...files] });
      if (unreadable.length) {
        Alert.alert(
          'Some files can’t be read',
          `${unreadable.map((f) => f.name).join(', ')} ${unreadable.length === 1 ? 'was' : 'were'} added, but only text files (txt, md, csv, json, code…) are shared with the model.`,
        );
      }
    } catch (e) {
      Alert.alert('Couldn’t add files', e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const removeFile = (fileId: string) => {
    deleteAttachmentFiles(project.files.filter((f) => f.id === fileId));
    saveProject({ ...project, files: project.files.filter((f) => f.id !== fileId) });
  };

  const confirmDelete = () =>
    Alert.alert(
      `Delete “${project.name}”?`,
      'Its instructions and files are removed. Its chats are kept and moved out of the project.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete project',
          style: 'destructive',
          onPress: () => {
            deleteProject(project.id);
            router.back();
          },
        },
      ],
    );

  const prompts: Record<Field, { title: string; placeholder: string; multiline?: boolean }> = {
    name: { title: 'Project name', placeholder: 'e.g. Side projects' },
    description: { title: 'What is it for?', placeholder: 'One line about this project' },
    instructions: { title: 'Instructions', placeholder: 'How TryChat should work in this project…', multiline: true },
  };

  return (
    <KeyboardAwareScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable onPress={confirmDelete} style={styles.headerBtn} accessibilityLabel="Delete project">
              <Icon name="trash-2" size={20} color={theme.muted} />
            </Pressable>
          ),
        }}
      />

      <View style={[styles.tile, { backgroundColor: theme.oat }]}>
        <Icon name="folder" size={20} color={theme.primary} />
      </View>
      <Pressable onPress={() => setEditing('name')} accessibilityRole="button" accessibilityHint="Rename project">
        <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 28, marginTop: 12 }}>{project.name}</Text>
      </Pressable>
      <Pressable onPress={() => setEditing('description')} accessibilityRole="button" accessibilityHint="Edit description">
        <Text style={{ color: project.description ? theme.muted : theme.faint, fontSize: 14, marginTop: 4 }}>
          {project.description || 'Add a description'}
        </Text>
      </Pressable>

      <PillButton title="New chat in this project" icon="plus" onPress={newChat} style={{ marginTop: 18 }} />

      <Card style={{ padding: 16, marginTop: 20 }}>
        <View style={styles.cardHead}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>Instructions</Text>
          <Pressable onPress={() => setEditing('instructions')} hitSlop={10} style={styles.link}>
            <Text style={{ color: theme.primary, fontWeight: '600' }}>{project.instructions ? 'Edit' : 'Add'}</Text>
          </Pressable>
        </View>
        <Text style={{ color: project.instructions ? theme.text : theme.faint, fontSize: 14, lineHeight: 20 }} numberOfLines={4}>
          {project.instructions || 'Tell TryChat how to behave in every chat in this project.'}
        </Text>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <View style={[styles.cardHead, { paddingHorizontal: 16, paddingTop: 14 }]}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>Files · {project.files.length}</Text>
          {adding ? (
            <ActivityIndicator color={theme.primary} style={styles.link} />
          ) : (
            <Pressable onPress={addFiles} hitSlop={10} style={styles.link}>
              <Text style={{ color: theme.primary, fontWeight: '600' }}>Add</Text>
            </Pressable>
          )}
        </View>
        {project.files.map((f, i) => (
          <View key={f.id}>
            {i > 0 && <Divider />}
            <View style={styles.fileRow}>
              <View style={[styles.smallTile, { backgroundColor: theme.surface2 }]}>
                <Icon name={f.text !== undefined ? 'file-text' : 'file'} size={15} color={theme.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 14 }} numberOfLines={1}>
                  {f.name}
                </Text>
                <Text style={{ color: theme.faint, fontSize: 12 }}>
                  {formatSize(f.size)}
                  {f.text === undefined ? ' · not readable as text' : ''}
                </Text>
              </View>
              <Pressable onPress={() => removeFile(f.id)} style={styles.headerBtn} accessibilityLabel={`Remove ${f.name}`}>
                <Icon name="x" size={16} />
              </Pressable>
            </View>
          </View>
        ))}
        <Text style={{ color: theme.muted, fontSize: 12, paddingHorizontal: 16, paddingBottom: 14, paddingTop: project.files.length ? 4 : 0 }}>
          Every chat in this project can read these.
        </Text>
      </Card>

      <SectionLabel>Chats</SectionLabel>
      {chats.length ? (
        <Card>
          {chats.map((c, i) => (
            <View key={c.id}>
              {i > 0 && <Divider />}
              <Pressable onPress={() => router.push(`/chat/${c.id}`)} style={styles.chatRow} accessibilityRole="button">
                <Text style={{ color: theme.text, fontSize: 15, flex: 1 }} numberOfLines={1}>
                  {c.title}
                </Text>
                <Text style={{ color: theme.faint, fontSize: 12 }}>{timeAgo(c.updatedAt)}</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : (
        <Text style={{ color: theme.muted }}>No chats yet. Start one above, or long-press a chat in your list to move it here.</Text>
      )}

      <TextPrompt
        visible={!!editing}
        title={editing ? prompts[editing].title : ''}
        placeholder={editing ? prompts[editing].placeholder : ''}
        multiline={editing ? prompts[editing].multiline : false}
        initialValue={editing ? project[editing] : ''}
        onSubmit={(v) => editing && saveProject({ ...project, [editing]: v })}
        onClose={() => setEditing(null)}
      />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  smallTile: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  link: { minHeight: 36, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 4, minHeight: 56 },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, minHeight: 52 },
});
