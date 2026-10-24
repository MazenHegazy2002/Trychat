import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Icon, PillButton, SectionLabel } from '../../components/ui';
import { formatSize, pickFiles } from '../../lib/attachments';
import { uid } from '../../lib/id';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import type { Attachment } from '../../lib/types';

export default function NewProjectScreen() {
  const theme = useTheme();
  /** Set when opened from "Move to project → New project": that chat goes into the new project. */
  const { moveChat } = useLocalSearchParams<{ moveChat?: string }>();
  const { saveProject, moveConversation } = useStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [adding, setAdding] = useState(false);

  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }];
  const canCreate = !!name.trim();

  const create = () => {
    if (!canCreate) return;
    const now = Date.now();
    const id = uid();
    saveProject({ id, name: name.trim(), description: description.trim(), instructions: instructions.trim(), files, createdAt: now, updatedAt: now });
    if (moveChat) moveConversation(moveChat, id);
    router.replace(`/projects/${id}`);
  };

  const addFiles = async () => {
    setAdding(true);
    try {
      const picked = await pickFiles();
      setFiles((f) => [...f, ...picked]);
    } catch (e) {
      Alert.alert('Couldn’t add files', e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <KeyboardAwareScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Stack.Screen
        options={{
          title: 'New project',
          headerRight: () => (
            <Pressable onPress={create} disabled={!canCreate} style={styles.headerBtn} accessibilityRole="button">
              <Text style={{ color: canCreate ? theme.primary : theme.faint, fontWeight: '600', fontSize: 16 }}>Create</Text>
            </Pressable>
          ),
        }}
      />

      <Text style={[styles.label, { color: theme.muted }]}>Name</Text>
      <TextInput value={name} onChangeText={setName} placeholder="e.g. Spanish" placeholderTextColor={theme.faint} style={input} autoFocus />

      <Text style={[styles.label, { color: theme.muted }]}>What is it for?</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="e.g. Practice and grammar notes"
        placeholderTextColor={theme.faint}
        style={input}
      />

      <Text style={[styles.label, { color: theme.muted }]}>Instructions</Text>
      <TextInput
        value={instructions}
        onChangeText={setInstructions}
        placeholder="e.g. Reply in simple Spanish first, then English. Correct my mistakes gently."
        placeholderTextColor={theme.faint}
        multiline
        style={[input, { minHeight: 140, textAlignVertical: 'top' }]}
      />
      <Text style={{ color: theme.muted, fontSize: 12, marginTop: 6 }}>Applied to every chat in this project.</Text>

      <SectionLabel>Files</SectionLabel>
      {files.map((f) => (
        <View key={f.id} style={[styles.fileRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Icon name={f.text !== undefined ? 'file-text' : 'file'} size={16} color={theme.text} />
          <Text style={{ color: theme.text, flex: 1 }} numberOfLines={1}>
            {f.name}
          </Text>
          <Text style={{ color: theme.faint, fontSize: 12 }}>{formatSize(f.size)}</Text>
          <Pressable onPress={() => setFiles((list) => list.filter((x) => x.id !== f.id))} style={styles.headerBtn} accessibilityLabel={`Remove ${f.name}`}>
            <Icon name="x" size={16} />
          </Pressable>
        </View>
      ))}
      <Pressable onPress={addFiles} disabled={adding} style={[styles.drop, { borderColor: theme.oat }]} accessibilityRole="button">
        {adding ? <ActivityIndicator color={theme.muted} /> : <Icon name="paperclip" size={18} />}
        <Text style={{ color: theme.muted, fontSize: 14 }}>Add files — text, code, CSV, Markdown</Text>
      </Pressable>
      <Text style={{ color: theme.muted, fontSize: 12, marginTop: 6 }}>TryChat reads these in every chat here.</Text>

      <PillButton title="Create project" onPress={create} disabled={!canCreate} style={{ marginTop: 28 }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 48 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingLeft: 14, marginBottom: 8 },
  drop: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingHorizontal: 14, minHeight: 52 },
});
