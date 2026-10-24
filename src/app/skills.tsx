import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, ClaySwitch, Divider, Icon, IconTile, PillButton, ScreenIntro, SectionLabel } from '../components/ui';
import { uid } from '../lib/id';
import { findSkills, importSkill, skillSuggestions, STARTER_SKILLS } from '../lib/skills';
import type { SkillCandidate } from '../lib/skills';
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
  /** Skill/plugin repos linked from a README-only repo, offered when it has no skills. */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  /** Skills found in a repo, waiting for the user to choose which to import. */
  const [found, setFound] = useState<SkillCandidate[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }];
  const starters = STARTER_SKILLS.filter((s) => !skills.some((k) => k.name === s.name));

  const doImport = async () => {
    setImporting(true);
    setImportError('');
    setSuggestions([]);
    try {
      const candidates = await findSkills(importUrl, settings.githubToken);
      if (candidates.length === 1) {
        const skill = await importSkill(candidates[0], importUrl, settings.githubToken);
        saveSkill(skill);
        setImportUrl('');
        setEditing(skill);
      } else {
        // Real SKILL.md files are pre-selected; other Markdown files are offered unticked.
        setChosen(new Set(candidates.filter((c) => c.isSkillFile).map((c) => c.path)));
        setFound(candidates);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      setSuggestions(skillSuggestions(e));
    } finally {
      setImporting(false);
    }
  };

  const importChosen = async () => {
    if (!found) return;
    const picked = found.filter((c) => chosen.has(c.path));
    setImporting(true);
    const failed: string[] = [];
    for (const c of picked) {
      try {
        saveSkill(await importSkill(c, importUrl, settings.githubToken));
      } catch {
        failed.push(c.name);
      }
    }
    setImporting(false);
    setFound(null);
    setImportUrl('');
    if (failed.length) Alert.alert('Some skills didn’t import', failed.join(', '));
  };

  const toggle = (path: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

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
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
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
            placeholder="github.com/owner/repo (any skills repo)"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[input, { flex: 1 }]}
          />
          <PillButton title="Import" onPress={doImport} loading={importing} disabled={!importUrl.trim()} />
        </View>
        {!!importError && <Text style={{ color: theme.danger, marginTop: 8 }}>{importError}</Text>}
        {suggestions.length > 0 && (
          <Card style={{ marginTop: 8 }}>
            {suggestions.map((url, i) => (
              <View key={url}>
                {i > 0 && <Divider />}
                <Pressable
                  onPress={() => {
                    setImportUrl(url);
                    setImportError('');
                    setSuggestions([]);
                  }}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${url}`}
                >
                  <Text style={{ flex: 1, color: theme.primary, fontSize: 14 }} numberOfLines={1}>
                    {url.replace(/^https:\/\/github\.com\//, '')}
                  </Text>
                </Pressable>
              </View>
            ))}
          </Card>
        )}

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

      <Modal statusBarTranslucent navigationBarTranslucent visible={!!found} animationType="slide" onRequestClose={() => setFound(null)}>
        {found && (
          <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 12 }}>
            <View style={[styles.modalHeader, { paddingHorizontal: 20 }]}>
              <Pressable onPress={() => setFound(null)} hitSlop={10} style={styles.headerBtn}>
                <Text style={{ color: theme.muted, fontSize: 16 }}>Cancel</Text>
              </Pressable>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '600' }}>Choose skills</Text>
              <Pressable
                onPress={() => setChosen(chosen.size === found.length ? new Set() : new Set(found.map((c) => c.path)))}
                hitSlop={10}
                style={styles.headerBtn}
              >
                <Text style={{ color: theme.primary, fontSize: 15, fontWeight: '600' }}>
                  {chosen.size === found.length ? 'None' : 'All'}
                </Text>
              </Pressable>
            </View>
            <Text style={{ color: theme.muted, fontSize: 13, paddingHorizontal: 20, marginTop: 4, marginBottom: 8 }}>
              {found.some((c) => c.isSkillFile)
                ? `Found ${found.length} skills in this repo.`
                : `No SKILL.md files here — pick the Markdown files you want to use as skills.`}
            </Text>
            <FlatList keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
              data={found}
              keyExtractor={(c) => c.path}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
              renderItem={({ item }) => {
                const on = chosen.has(item.path);
                return (
                  <Pressable
                    onPress={() => toggle(item.path)}
                    style={[styles.pickRow, on && { backgroundColor: theme.surface2 }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <View style={[styles.check, { borderColor: on ? theme.accent : theme.oat, backgroundColor: on ? theme.accent : 'transparent' }]}>
                      {on && <Icon name="check" size={14} color="#FFFFFF" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={{ color: theme.faint, fontSize: 12, fontFamily: 'monospace' }} numberOfLines={1}>
                        {item.path}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />
            <View style={{ padding: 16, paddingBottom: insets.bottom + 16 }}>
              {importing ? (
                <ActivityIndicator color={theme.primary} style={{ minHeight: 48 }} />
              ) : (
                <PillButton
                  title={chosen.size ? `Import ${chosen.size} skill${chosen.size === 1 ? '' : 's'}` : 'Choose at least one'}
                  disabled={!chosen.size}
                  onPress={importChosen}
                />
              )}
            </View>
          </View>
        )}
      </Modal>

      <Modal statusBarTranslucent navigationBarTranslucent visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing && (
          <KeyboardAwareScrollView
            style={{ backgroundColor: theme.bg }}
            contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
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
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12, borderRadius: 12 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 48 },
});
