import { Stack } from 'expo-router';
import { Fragment, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../components/Text';
import {
  Banner,
  Card,
  ClaySwitch,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  IconTile,
  ListRow,
  PillButton,
  ScreenIntro,
  SectionLabel,
  TextField,
} from '../components/ui';
import type { IconName } from '../components/ui';
import { uid } from '../lib/id';
import { findSkills, importSkill, skillSuggestions, STARTER_SKILLS } from '../lib/skills';
import type { SkillCandidate } from '../lib/skills';
import { useStore } from '../lib/store';
import { FONT, RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../lib/theme';
import type { Skill } from '../lib/types';

const blankSkill = (): Skill => ({ id: uid(), name: '', description: '', instructions: '', enabled: true, updatedAt: Date.now() });

export default function SkillsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const gutter = wide ? 24 : 16;
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

  const column = { width: '100%' as const, maxWidth: SIZE.contentMax, alignSelf: 'center' as const };
  const existing = !!editing && skills.some((k) => k.id === editing.id);
  const canSave = !!editing && !!editing.name.trim() && !!editing.instructions.trim();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => <IconButton name="plus" label="New skill" onPress={() => setEditing(blankSkill())} />,
        }}
      />
      <KeyboardAwareScrollView
        contentContainerStyle={[column, { paddingHorizontal: gutter, paddingTop: wide ? 24 : 16, paddingBottom: 48 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <ScreenIntro title="Your skills">Playbooks TryChat loads when a task matches. They sync with your account.</ScreenIntro>

        {skills.length > 0 ? (
          <Card>
            {skills.map((skill, i) => (
              <Fragment key={skill.id}>
                {i > 0 && <Divider inset={68} />}
                <View style={styles.rowOuter}>
                  <Pressable
                    onPress={() => setEditing(skill)}
                    accessibilityRole="button"
                    accessibilityLabel={skill.name}
                    accessibilityHint="Edit this skill"
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.rowMain,
                      { backgroundColor: pressed || hovered ? theme.fill : 'transparent' },
                    ]}
                  >
                    <IconTile name="zap" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '600' }]} numberOfLines={1}>
                        {skill.name}
                      </Text>
                      <Text style={[TYPE.caption, { color: theme.inkMuted }]} numberOfLines={2}>
                        {skill.source ? 'Imported from GitHub' : skill.description}
                      </Text>
                      {!!skill.source && (
                        <Text style={[styles.monoSmall, { color: theme.inkFaint }]} numberOfLines={1}>
                          {skill.source.replace(/^https?:\/\//, '')}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                  <ClaySwitch value={skill.enabled} onValueChange={(v) => saveSkill({ ...skill, enabled: v })} label={`Use ${skill.name}`} />
                </View>
              </Fragment>
            ))}
          </Card>
        ) : (
          <EmptyState icon="zap" title="No skills yet" style={{ paddingVertical: 24 }}>
            Add a starter below, import one, or tap + to write your own.
          </EmptyState>
        )}

        <SectionLabel>Import from GitHub</SectionLabel>
        <View style={{ gap: 12 }}>
          <TextField
            value={importUrl}
            onChangeText={setImportUrl}
            placeholder="github.com/owner/repo (any skills repo)"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Skills repository on GitHub"
            mono
          />
          <PillButton
            title="Import"
            variant="secondary"
            icon="download"
            onPress={doImport}
            loading={importing}
            disabled={!importUrl.trim()}
            style={{ alignSelf: 'flex-start' }}
          />
          {!!importError && <Banner tone="danger">{importError}</Banner>}
          {suggestions.length > 0 && (
            <Card>
              {suggestions.map((url, i) => (
                <Fragment key={url}>
                  {i > 0 && <Divider inset={44} />}
                  <ListRow
                    icon="github"
                    title={url.replace(/^https:\/\/github\.com\//, '')}
                    titleStyle={{ color: theme.accent, fontFamily: FONT.mono, fontSize: 14 }}
                    accessibilityLabel={`Use ${url}`}
                    onPress={() => {
                      setImportUrl(url);
                      setImportError('');
                      setSuggestions([]);
                    }}
                  />
                </Fragment>
              ))}
            </Card>
          )}
        </View>

        {starters.length > 0 && (
          <>
            <SectionLabel>Starter skills</SectionLabel>
            <Card>
              {starters.map((s, i) => (
                <Fragment key={s.name}>
                  {i > 0 && <Divider inset={68} />}
                  <View style={[styles.rowOuter, { paddingLeft: 16 }]}>
                    <IconTile name="zap" />
                    <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
                      <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '600' }]}>{s.name}</Text>
                      <Text style={[TYPE.caption, { color: theme.inkMuted }]}>{s.description}</Text>
                    </View>
                    <RowAction
                      title="Add"
                      icon="plus"
                      label={`Add ${s.name}`}
                      onPress={() => saveSkill({ ...s, id: uid(), updatedAt: Date.now() })}
                    />
                  </View>
                </Fragment>
              ))}
            </Card>
          </>
        )}
      </KeyboardAwareScrollView>

      <Modal statusBarTranslucent navigationBarTranslucent visible={!!found} animationType="slide" onRequestClose={() => setFound(null)}>
        {found && (
          <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 8 }}>
            <View style={[column, { flex: 1 }]}>
              <View style={[styles.modalHeader, { paddingHorizontal: gutter - 8 }]}>
                <HeaderAction title="Cancel" onPress={() => setFound(null)} />
                <Text style={[TYPE.headline, { color: theme.ink }]} accessibilityRole="header">
                  Choose skills
                </Text>
                <HeaderAction
                  title={chosen.size === found.length ? 'None' : 'All'}
                  tone="accent"
                  onPress={() => setChosen(chosen.size === found.length ? new Set() : new Set(found.map((c) => c.path)))}
                />
              </View>
              <Text style={[TYPE.caption, { color: theme.inkMuted, paddingHorizontal: gutter, marginTop: 4, marginBottom: 8 }]}>
                {found.some((c) => c.isSkillFile)
                  ? `Found ${found.length} skills in this repo.`
                  : `No SKILL.md files here — pick the Markdown files you want to use as skills.`}
              </Text>
              <FlatList
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                data={found}
                keyExtractor={(c) => c.path}
                contentContainerStyle={{ paddingHorizontal: gutter - 8, paddingBottom: 16 }}
                renderItem={({ item }) => {
                  const on = chosen.has(item.path);
                  return (
                    <Pressable
                      onPress={() => toggle(item.path)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={item.name}
                      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.pickRow,
                        { backgroundColor: pressed || hovered ? theme.fill : 'transparent' },
                      ]}
                    >
                      <View
                        style={[
                          styles.check,
                          { borderColor: on ? theme.accent : theme.borderStrong, backgroundColor: on ? theme.accent : 'transparent' },
                        ]}
                      >
                        {on && <Icon name="check" size={14} color={theme.onAccent} />}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[TYPE.callout, { color: theme.ink, fontWeight: on ? '600' : '500' }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={[styles.monoSmall, { color: theme.inkFaint }]} numberOfLines={1}>
                          {item.path}
                        </Text>
                      </View>
                    </Pressable>
                  );
                }}
              />
              <View style={{ paddingHorizontal: gutter, paddingTop: 12, paddingBottom: insets.bottom + 16 }}>
                <PillButton
                  size="lg"
                  title={chosen.size ? `Import ${chosen.size} skill${chosen.size === 1 ? '' : 's'}` : 'Choose at least one'}
                  disabled={!chosen.size}
                  loading={importing}
                  onPress={importChosen}
                />
              </View>
            </View>
          </View>
        )}
      </Modal>

      <Modal statusBarTranslucent navigationBarTranslucent visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing && (
          <KeyboardAwareScrollView
            style={{ backgroundColor: theme.bg }}
            contentContainerStyle={[column, { paddingHorizontal: gutter, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 48 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={[styles.modalHeader, { marginHorizontal: -8 }]}>
              <HeaderAction title="Cancel" onPress={() => setEditing(null)} />
              <Text style={[TYPE.headline, { color: theme.ink }]} accessibilityRole="header">
                {existing ? 'Edit skill' : 'New skill'}
              </Text>
              <HeaderAction
                title="Save"
                tone="accent"
                disabled={!canSave}
                onPress={() => {
                  if (!editing.name.trim() || !editing.instructions.trim()) return;
                  saveSkill({ ...editing, name: editing.name.trim() });
                  setEditing(null);
                }}
              />
            </View>
            <View style={{ gap: 16, marginTop: 16 }}>
              <TextField
                label="Name"
                value={editing.name}
                onChangeText={(name) => setEditing({ ...editing, name })}
                placeholder="e.g. Blog writer"
              />
              <TextField
                label="When to use it"
                value={editing.description}
                onChangeText={(description) => setEditing({ ...editing, description })}
                placeholder="One line the model reads to decide when to load it"
              />
              <TextField
                label="Instructions"
                value={editing.instructions}
                onChangeText={(instructions) => setEditing({ ...editing, instructions })}
                multiline
                mono
                inputStyle={{ minHeight: 260, fontSize: 13 }}
                placeholder="Step-by-step instructions, examples, rules…"
              />
            </View>
            {existing && (
              <PillButton
                title="Delete skill"
                variant="danger"
                icon="trash-2"
                style={{ marginTop: 24 }}
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
              />
            )}
          </KeyboardAwareScrollView>
        )}
      </Modal>
    </View>
  );
}

/** Text action in a modal header: Cancel (muted), All / Save (accent). Faint when it can't act yet. */
function HeaderAction({
  title,
  onPress,
  tone = 'muted',
  disabled,
}: {
  title: string;
  onPress: () => void;
  tone?: 'muted' | 'accent';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const color = disabled ? theme.inkFaint : tone === 'accent' ? theme.accent : theme.inkMuted;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.headerBtn,
        { backgroundColor: pressed || hovered ? theme.fill : 'transparent' },
      ]}
    >
      <Text style={{ color, fontSize: 16, lineHeight: 22, fontWeight: tone === 'accent' ? '600' : '400' }}>{title}</Text>
    </Pressable>
  );
}

/** Light accent action inside a row, with its own accessibility label. */
function RowAction({ title, icon, label, onPress }: { title: string; icon?: IconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.rowAction,
        { backgroundColor: pressed || hovered ? theme.fill : 'transparent' },
      ]}
    >
      {icon && <Icon name={icon} size={16} color={theme.accent} />}
      <Text style={[TYPE.subhead, { color: theme.accent }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rowOuter: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 12, minHeight: 64 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 4, paddingVertical: 12, minHeight: 64 },
  monoSmall: { fontFamily: FONT.mono, fontSize: 12, lineHeight: 16, marginTop: 2 },
  headerBtn: { minWidth: 44, minHeight: 44, paddingHorizontal: 8, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  rowAction: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: RADIUS.pill },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 8, borderRadius: RADIUS.sm },
  check: { width: 22, height: 22, borderRadius: RADIUS.xs, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
