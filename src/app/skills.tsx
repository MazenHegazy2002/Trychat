import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, ClaySwitch, Divider, Icon, IconTile, PillButton, ScreenIntro, SectionLabel } from '../components/ui';
import { uid } from '../lib/id';
import { importSkillFromUrl, STARTER_SKILLS } from '../lib/skills';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { Skill } from '../lib/types';

const blankSkill = (): Skill => ({ id: uid(), name: '', description: '', instructions: '', enabled: true, updatedAt: Date.now() });

export default function SkillsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { skills, saveSkill, deleteSkill, settings } = useStore();
  const [editing, setEditing] = useState<Skill | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }];
  const starters = STARTER_SKILLS.filter((s) => !skills.some((k) => k.name === s.name));

  const doImport = async () => {
    setImporting(true);
    setImportError('');
    try {
      const skill = await importSkillFromUrl(importUrl, settings.githubToken);
      saveSkill(skill);
      setImportUrl('');
      setEditing(skill);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => setEditing(blankSkill())} hitSlop={10} accessibilityLabel="New skill" style={styles.headerBtn}>
              <Icon name="plus" size={22} color={theme.text} />
            </Pressable>
          ),
        }}
      />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <ScreenIntro title="Your skills">Playbooks TryChat loads when a task matches. They sync with your account.</ScreenIntro>

        {skills.length > 0 ? (
          <Card>
            {skills.map((skill, i) => (
              <View key={skill.id}>
                {i > 0 && <Divider />}
                <Pressable onPress={() => setEditing(skill)} style={styles.row} accessibilityRole="button">
                  <IconTile name="layers" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{skill.name}</Text>
                    <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                      {skill.source ? 'Imported from GitHub' : skill.description}
                    </Text>
                    {!!skill.source && (
                      <Text style={{ color: theme.faint, fontSize: 11, fontFamily: 'monospace', marginTop: 2 }} numberOfLines={1}>
                        {skill.source.replace(/^https?:\/\//, '')}
                      </Text>
                    )}
                  </View>
                  <ClaySwitch value={skill.enabled} onValueChange={(v) => saveSkill({ ...skill, enabled: v })} label={`Use ${skill.name}`} />
                </Pressable>
              </View>
            ))}
          </Card>
        ) : (
          <Card style={{ padding: 16 }}>
            <Text style={{ color: theme.muted }}>No skills yet. Add a starter below, import one, or tap + to write your own.</Text>
          </Card>
        )}

        <SectionLabel>Import from GitHub</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            value={importUrl}
            onChangeText={setImportUrl}
            placeholder="github.com/owner/repo/tree/main/skills/…"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[input, { flex: 1 }]}
          />
          <PillButton title="Import" onPress={doImport} loading={importing} disabled={!importUrl.trim()} />
        </View>
        {!!importError && <Text style={{ color: theme.danger, marginTop: 8 }}>{importError}</Text>}

        {starters.length > 0 && (
          <>
            <SectionLabel>Starter skills</SectionLabel>
            <Card>
              {starters.map((s, i) => (
                <View key={s.name}>
                  {i > 0 && <Divider />}
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{s.name}</Text>
                      <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>{s.description}</Text>
                    </View>
                    <Pressable
                      onPress={() => saveSkill({ ...s, id: uid(), updatedAt: Date.now() })}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${s.name}`}
                      style={styles.add}
                    >
                      <Text style={{ color: theme.primary, fontWeight: '600' }}>Add</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
          </>
        )}
      </KeyboardAwareScrollView>

      <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing && (
          <KeyboardAwareScrollView
            style={{ backgroundColor: theme.bg }}
            contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setEditing(null)} hitSlop={10} style={styles.headerBtn}>
                <Text style={{ color: theme.muted, fontSize: 16 }}>Cancel</Text>
              </Pressable>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '600' }}>
                {skills.some((k) => k.id === editing.id) ? 'Edit skill' : 'New skill'}
              </Text>
              <Pressable
                onPress={() => {
                  if (!editing.name.trim() || !editing.instructions.trim()) return;
                  saveSkill({ ...editing, name: editing.name.trim() });
                  setEditing(null);
                }}
                hitSlop={10}
                style={styles.headerBtn}
              >
                <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '700' }}>Save</Text>
              </Pressable>
            </View>
            <Text style={[styles.label, { color: theme.muted }]}>Name</Text>
            <TextInput value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} style={input} placeholder="e.g. Blog writer" placeholderTextColor={theme.faint} />
            <Text style={[styles.label, { color: theme.muted }]}>When to use it</Text>
            <TextInput
              value={editing.description}
              onChangeText={(description) => setEditing({ ...editing, description })}
              style={input}
              placeholder="One line the model reads to decide when to load it"
              placeholderTextColor={theme.faint}
            />
            <Text style={[styles.label, { color: theme.muted }]}>Instructions</Text>
            <TextInput
              value={editing.instructions}
              onChangeText={(instructions) => setEditing({ ...editing, instructions })}
              multiline
              style={[input, { minHeight: 260, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 13 }]}
              placeholder="Step-by-step instructions, examples, rules…"
              placeholderTextColor={theme.faint}
            />
            {skills.some((k) => k.id === editing.id) && (
              <Pressable
                onPress={() =>
                  Alert.alert('Delete skill?', editing.name, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => {
                        deleteSkill(editing.id);
                        setEditing(null);
                      },
                    },
                  ])
                }
                style={{ marginTop: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: theme.danger, fontWeight: '600' }}>Delete skill</Text>
              </Pressable>
            )}
          </KeyboardAwareScrollView>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64 },
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  add: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 48 },
});
