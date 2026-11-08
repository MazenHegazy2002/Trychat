import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { TextPrompt } from '../../components/TextPrompt';
import { FileTile, fileTypeLabel } from '../../components/FileCards';
import { Card, Divider, EmptyState, IconButton, IconTile, PillButton, TextAction } from '../../components/ui';
import { deleteAttachmentFiles, formatSize, pickFiles } from '../../lib/attachments';
import { useStore } from '../../lib/store';
import { RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../../lib/theme';
import type { Attachment, ChatMessage, Conversation } from '../../lib/types';
import { Text } from '../../components/Text';

const shownText = (m: ChatMessage) => m.displayText ?? m.content;

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
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;
  const { projects, conversations, saveProject, deleteProject, createConversation } = useStore();
  const project = projects.find((p) => p.id === id);
  const [editing, setEditing] = useState<Field | null>(null);
  const [adding, setAdding] = useState(false);

  if (!project) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <EmptyState icon="folder" title="Project not found">
          This project no longer exists.
        </EmptyState>
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

  const page = [styles.page, wide && styles.pageWide];
  return (
    <KeyboardAwareScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={page} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => <IconButton name="trash-2" label="Delete project" onPress={confirmDelete} />,
        }}
      />

      <IconTile name="folder" size={48} />
      <Pressable onPress={() => setEditing('name')} accessibilityRole="button" accessibilityHint="Rename project" style={{ marginTop: 14 }}>
        <Text style={[TYPE.title, { color: theme.ink }]}>{project.name}</Text>
      </Pressable>
      <Pressable onPress={() => setEditing('description')} accessibilityRole="button" accessibilityHint="Edit description" style={{ marginTop: 4 }}>
        <Text style={[TYPE.callout, { color: project.description ? theme.inkMuted : theme.inkFaint }]}>{project.description || 'Add a description'}</Text>
      </Pressable>

      <PillButton title="New chat in this project" icon="plus" onPress={newChat} style={{ marginTop: 20 }} />

      <SectionHead label={`Chats${chats.length ? ` · ${chats.length}` : ''}`} />
      <Card>
        {chats.length ? (
          chats.map((c, i) => (
            <View key={c.id}>
              {i > 0 && <Divider inset={16} />}
              <ChatRow chat={c} />
            </View>
          ))
        ) : (
          <Text style={[TYPE.callout, { color: theme.inkMuted, padding: 16 }]}>
            No chats yet. Start one above, or long-press a chat in your list to move it here.
          </Text>
        )}
      </Card>

      <SectionHead label="Instructions" action={project.instructions ? 'Edit' : 'Add'} onAction={() => setEditing('instructions')} />
      <Pressable
        onPress={() => setEditing('instructions')}
        accessibilityRole="button"
        accessibilityHint="Edit instructions"
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.instructions,
          { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
        ]}
      >
        <Text style={[TYPE.callout, { color: project.instructions ? theme.ink : theme.inkFaint }]} numberOfLines={6}>
          {project.instructions || 'Tell TryChat how to behave in every chat in this project.'}
        </Text>
      </Pressable>

      <SectionHead label={`Files${project.files.length ? ` · ${project.files.length}` : ''}`} />
      <View style={{ gap: 8 }}>
        {project.files.map((f) => (
          <ProjectFile key={f.id} file={f} onRemove={() => removeFile(f.id)} />
        ))}
      </View>
      <PillButton title="Add files" icon="paperclip" variant="secondary" onPress={addFiles} loading={adding} style={{ marginTop: project.files.length ? 12 : 0 }} />
      <Text style={[TYPE.caption, { color: theme.inkFaint, marginTop: 8, marginHorizontal: 4 }]}>Every chat in this project can read these.</Text>

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

/** Capitals section label with an optional text action on the right. */
function SectionHead({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHead}>
      <Text style={[TYPE.overline, { color: theme.inkFaint, flex: 1 }]} accessibilityRole="header">
        {label}
      </Text>
      {!!action && !!onAction && <TextAction title={action} onPress={onAction} />}
    </View>
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

/** A reference file as a FileCard-style tile, with a remove button. */
function ProjectFile({ file: f, onRemove }: { file: Attachment; onRemove: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.file, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <FileTile file={f} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '500' }]} numberOfLines={1}>
          {f.name}
        </Text>
        <Text style={[TYPE.codeLabel, { color: theme.inkFaint, marginTop: 2 }]} numberOfLines={1}>
          {fileTypeLabel(f)} · {formatSize(f.size)}
          {f.text === undefined ? ' · not readable as text' : ''}
        </Text>
      </View>
      <IconButton name="x" label={`Remove ${f.name}`} onPress={onRemove} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },
  pageWide: { width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 28 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', minHeight: 44, marginTop: 12, marginBottom: 0, marginHorizontal: 4 },
  chatRow: { paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  instructions: { borderWidth: 1, borderRadius: RADIUS.md, padding: 16 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 12, paddingRight: 4, paddingVertical: 8, minHeight: 60, borderRadius: RADIUS.md, borderWidth: 1 },
});
