import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { FileTile, fileTypeLabel } from '../../components/FileCards';
import { IconButton, PillButton, SectionLabel, TextField } from '../../components/ui';
import { formatSize, pickFiles } from '../../lib/attachments';
import { uid } from '../../lib/id';
import { useStore } from '../../lib/store';
import { RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../../lib/theme';
import type { Attachment } from '../../lib/types';
import { Text } from '../../components/Text';

export default function NewProjectScreen() {
  const theme = useTheme();
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;
  /** Set when opened from "Move to project → New project": that chat goes into the new project. */
  const { moveChat } = useLocalSearchParams<{ moveChat?: string }>();
  const { saveProject, moveConversation } = useStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [adding, setAdding] = useState(false);

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
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[styles.page, wide && styles.pageWide]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Stack.Screen
        options={{
          title: 'New project',
          headerRight: () => (
            <Pressable
              onPress={create}
              disabled={!canCreate}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.headerBtn, (pressed || hovered) && canCreate && { backgroundColor: theme.fill }]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canCreate }}
            >
              <Text style={[TYPE.callout, { color: canCreate ? theme.ink : theme.inkFaint, fontWeight: '600' }]}>Create</Text>
            </Pressable>
          ),
        }}
      />

      <View style={{ gap: 20 }}>
        {/* The label stays plain text: tapping it dismisses the keyboard. */}
        <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Spanish" accessibilityLabel="Project name" autoFocus />
        <TextField label="What is it for?" value={description} onChangeText={setDescription} placeholder="e.g. Practice and grammar notes" />
        <TextField
          label="Instructions"
          value={instructions}
          onChangeText={setInstructions}
          placeholder="e.g. Reply in simple Spanish first, then English. Correct my mistakes gently."
          multiline
          hint="Applied to every chat in this project."
          inputStyle={{ minHeight: 140 }}
        />
      </View>

      <SectionLabel>Files</SectionLabel>
      <View style={{ gap: 8 }}>
        {files.map((f) => (
          <View key={f.id} style={[styles.file, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <FileTile file={f} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '500' }]} numberOfLines={1}>
                {f.name}
              </Text>
              <Text style={[TYPE.codeLabel, { color: theme.inkFaint, marginTop: 2 }]} numberOfLines={1}>
                {fileTypeLabel(f)} · {formatSize(f.size)}
              </Text>
            </View>
            <IconButton name="x" label={`Remove ${f.name}`} onPress={() => setFiles((list) => list.filter((x) => x.id !== f.id))} />
          </View>
        ))}
      </View>
      <PillButton title="Add files" icon="paperclip" variant="secondary" onPress={addFiles} loading={adding} style={{ marginTop: files.length ? 12 : 0 }} />
      <Text style={[TYPE.caption, { color: theme.inkFaint, marginTop: 8, marginHorizontal: 4 }]}>
        Text, code, CSV and Markdown. TryChat reads these in every chat here.
      </Text>

      <PillButton title="Create project" size="lg" onPress={create} disabled={!canCreate} style={{ marginTop: 32 }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
  pageWide: { width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 28 },
  headerBtn: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 12, paddingRight: 4, paddingVertical: 8, minHeight: 60, borderRadius: RADIUS.md, borderWidth: 1 },
});
