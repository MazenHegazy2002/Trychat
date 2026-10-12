import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uid } from '../lib/id';
import { importSkillFromUrl, STARTER_SKILLS } from '../lib/skills';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { Skill } from '../lib/types';

export default function SkillsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { skills, saveSkill, deleteSkill, settings } = useStore();
  const [editing, setEditing] = useState<Skill | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text }];
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
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: theme.muted, lineHeight: 20 }}>
          Skills are instructions TryChat loads when a task matches — your own playbooks for building, reviewing,
          writing and more. They sync with your account.
        </Text>

        {skills.map((skill) => (
          <Pressable
            key={skill.id}
            onPress={() => setEditing(skill)}
            style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{skill.name}</Text>
              <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                {skill.description}
              </Text>
              {!!skill.source && (
                <Text style={{ color: theme.muted, fontSize: 11, marginTop: 4 }} numberOfLines={1}>
                  {skill.source}
                </Text>
              )}
            </View>
            <Switch value={skill.enabled} onValueChange={(v) => saveSkill({ ...skill, enabled: v })} />
          </Pressable>
        ))}

        <Text style={[styles.section, { color: theme.text }]}>Import from GitHub</Text>
        <Text style={{ color: theme.muted, fontSize: 13 }}>Link to a SKILL.md file, its folder, or a repo.</Text>
        <TextInput
          value={importUrl}
          onChangeText={setImportUrl}
          placeholder="https://github.com/owner/repo/tree/main/skills/my-skill"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[input, { marginTop: 8 }]}
        />
        {!!importError && <Text style={{ color: theme.danger, marginTop: 6 }}>{importError}</Text>}
        <Pressable
          onPress={doImport}
          disabled={!importUrl.trim() || importing}
          style={[styles.button, { backgroundColor: importUrl.trim() ? theme.text : theme.border }]}
        >
          {importing ? <ActivityIndicator color={theme.bg} /> : <Text style={{ color: theme.bg, fontWeight: '700' }}>Import</Text>}
        </Pressable>

        {starters.length > 0 && (
          <>
            <Text style={[styles.section, { color: theme.text }]}>Starter skills</Text>
            {starters.map((s) => (
              <Pressable
                key={s.name}
                onPress={() => saveSkill({ ...s, id: uid(), updatedAt: Date.now() })}
                style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>{s.name}</Text>
                  <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>{s.description}</Text>
                </View>
                <Text style={{ color: theme.primary, fontWeight: '700' }}>Add</Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      <Pressable
        onPress={() =>
          setEditing({ id: uid(), name: '', description: '', instructions: '', enabled: true, updatedAt: Date.now() })
        }
        style={[styles.fab, { backgroundColor: theme.text, bottom: insets.bottom + 20 }]}
      >
        <Text style={{ color: theme.bg, fontWeight: '700', fontSize: 16 }}>＋ New skill</Text>
      </Pressable>

      <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing && (
          <ScrollView
            style={{ backgroundColor: theme.bg }}
            contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Pressable onPress={() => setEditing(null)} hitSlop={10}>
                <Text style={{ color: theme.muted, fontSize: 16 }}>Cancel</Text>
              </Pressable>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '600' }}>Skill</Text>
              <Pressable
                onPress={() => {
                  if (!editing.name.trim() || !editing.instructions.trim()) return;
                  saveSkill({ ...editing, name: editing.name.trim() });
                  setEditing(null);
                }}
                hitSlop={10}
              >
                <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '700' }}>Save</Text>
              </Pressable>
            </View>
            <Text style={[styles.label, { color: theme.muted }]}>Name</Text>
            <TextInput value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} style={input} placeholder="e.g. Blog writer" placeholderTextColor={theme.muted} />
            <Text style={[styles.label, { color: theme.muted }]}>When to use it</Text>
            <TextInput
              value={editing.description}
              onChangeText={(description) => setEditing({ ...editing, description })}
              style={input}
              placeholder="One line the model reads to decide when to load it"
              placeholderTextColor={theme.muted}
            />
            <Text style={[styles.label, { color: theme.muted }]}>Instructions</Text>
            <TextInput
              value={editing.instructions}
              onChangeText={(instructions) => setEditing({ ...editing, instructions })}
              multiline
              style={[input, { minHeight: 260, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 13 }]}
              placeholder="Step-by-step instructions, examples, rules…"
              placeholderTextColor={theme.muted}
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
                style={{ marginTop: 24, alignItems: 'center' }}
              >
                <Text style={{ color: theme.danger, fontWeight: '600' }}>Delete skill</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  section: { fontSize: 18, fontWeight: '600', marginTop: 28, marginBottom: 4 },
  label: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, minHeight: 44 },
  button: { minHeight: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  fab: { position: 'absolute', right: 20, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 28, elevation: 4 },
});
