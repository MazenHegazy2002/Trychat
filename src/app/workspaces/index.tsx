import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Card, Divider, EmptyState, Icon, ListRow, PillButton, ScreenIntro, SearchField, SectionLabel, StatusBadge, TextAction, TextField } from '../../components/ui';
import type { IconName } from '../../components/ui';
import { listUserRepos, normalizeRepo, repoInfo } from '../../lib/github';
import { useStore } from '../../lib/store';
import { FONT, RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../../lib/theme';
import { laptopConnected } from '../../lib/tools';
import { branchHead, listBranches } from '../../lib/workspace/core';
import type { Workspace } from '../../lib/workspace/core';
import { addWorkspace, removeWorkspace, useWorkspaces } from '../../lib/workspace/store';
import { Text } from '../../components/Text';

/** The icon for each kind of workspace. */
function workspaceIcon(w: Workspace): IconName {
  if (w.kind === 'github') return 'github';
  if (w.kind === 'phone') return 'smartphone';
  if (w.kind === 'laptop') return 'folder';
  return 'hard-drive'; // a folder on this computer
}

/** One line of Geist Mono detail: repo · branch, or where the folder is. */
function workspaceMeta(w: Workspace): string {
  if (w.kind === 'github') return `${w.repo ?? w.name} · ${w.branch ?? ''}`;
  if (w.kind === 'laptop') return `laptop · ${w.root || 'bridge root'}`;
  if (w.kind === 'phone') return 'phone · shared folder';
  return w.root ?? 'this computer';
}

/** One way to open a workspace: an icon, a title, and its controls or a line saying what it needs. */
function AddOption({ icon, title, detail, children }: { icon: IconName; title: string; detail?: string; children?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[styles.tile, { backgroundColor: theme.fill }]}>
          <Icon name={icon} size={16} color={theme.ink} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '500' }]}>{title}</Text>
          {!!detail && <Text style={[TYPE.caption, { color: theme.inkMuted }]}>{detail}</Text>}
        </View>
      </View>
      {children}
    </View>
  );
}

export default function WorkspacesScreen() {
  const theme = useTheme();
  const { settings } = useStore();
  const workspaces = useWorkspaces();
  const [picking, setPicking] = useState(false);
  const [repos, setRepos] = useState<string[]>(settings.repos);
  const [repo, setRepo] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [laptopRoot, setLaptopRoot] = useState('');

  useEffect(() => {
    if (!picking || !settings.githubToken) return;
    listUserRepos(settings)
      .then(({ repos: r }) => setRepos((prev) => [...new Set([...prev, ...r.map((x) => x.full_name)])]))
      .catch(() => undefined);
  }, [picking, settings]);

  const chooseRepo = async (input: string) => {
    const name = normalizeRepo(input);
    if (!name) return Alert.alert('Not a repository', 'Use owner/name or a GitHub link.');
    setRepo(name);
    setBusy(true);
    try {
      const [info, list] = await Promise.all([repoInfo(settings, name), listBranches(settings, name)]);
      setBranches(list);
      setBranch(info.default_branch);
    } catch (e) {
      Alert.alert('Couldn’t open the repository', e instanceof Error ? e.message : String(e));
      setRepo('');
    } finally {
      setBusy(false);
    }
  };

  const openGithub = async () => {
    setBusy(true);
    try {
      const sha = await branchHead(settings, repo, branch);
      const ws = addWorkspace({ name: repo.split('/')[1], kind: 'github', repo, branch, baseSha: sha });
      setPicking(false);
      setRepo('');
      router.push(`/workspaces/${ws.id}`);
    } catch (e) {
      Alert.alert('Couldn’t open the branch', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openLocal = (kind: 'laptop' | 'phone') => {
    const root = laptopRoot.trim().replace(/^\/+|\/+$/g, '');
    const ws = addWorkspace(
      kind === 'laptop'
        ? { name: root ? root.split('/').pop()! : 'Laptop', kind, root }
        : { name: settings.phoneFolder?.name ?? 'Phone', kind },
    );
    router.push(`/workspaces/${ws.id}`);
  };

  const q = repo.toLowerCase();
  const { width } = useWindowDimensions();
  const gutter = width >= WIDE_BREAKPOINT ? 24 : 16;
  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 12, paddingBottom: 48, maxWidth: SIZE.contentMax + gutter * 2, width: '100%', alignSelf: 'center' }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Workspaces' }} />
      <ScreenIntro title="Workspaces">Open a repo or folder, edit files, and let the assistant work in it.</ScreenIntro>

      {workspaces.length ? (
        <View style={{ gap: 8 }}>
          {workspaces.map((w) => {
            const n = Object.keys(w.changes).length;
            return (
              <Pressable
                key={w.id}
                onPress={() => router.push(`/workspaces/${w.id}`)}
                onLongPress={() =>
                  Alert.alert(`Remove “${w.name}”?`, n ? `${n} staged change(s) will be lost.` : 'Files are not touched.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => removeWorkspace(w.id) },
                  ])
                }
                accessibilityRole="button"
                accessibilityLabel={w.name}
                accessibilityHint="Opens the workspace. Long-press to remove it."
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.card,
                  { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Icon name={workspaceIcon(w)} size={20} />
                  <Text style={[TYPE.headline, { color: theme.ink, flex: 1 }]} numberOfLines={1}>
                    {w.name}
                  </Text>
                  {w.kind === 'github' &&
                    (n ? <StatusBadge tone="warning">{`${n} change${n === 1 ? '' : 's'}`}</StatusBadge> : <StatusBadge tone="success">Up to date</StatusBadge>)}
                </View>
                <Text style={{ color: theme.inkMuted, fontFamily: FONT.mono, fontSize: 12, lineHeight: 16 }} numberOfLines={1} ellipsizeMode="middle">
                  {workspaceMeta(w)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <EmptyState icon="folder" title="No workspaces yet" style={{ paddingVertical: 24 }}>
          Open a GitHub repository or a folder below, then ask the assistant to work in it.
        </EmptyState>
      )}

      <SectionLabel>Open a workspace</SectionLabel>
      <Card>
        {/* desktop-folder-slot */}
        <AddOption icon="github" title="GitHub repository" detail={!picking ? 'Pick a repository and a branch.' : undefined}>
          {!picking ? (
            <PillButton title="Choose repository" icon="github" variant="secondary" onPress={() => setPicking(true)} />
          ) : !repo || !branches.length ? (
            <View style={{ gap: 4 }}>
              <SearchField
                value={repo}
                onChangeText={setRepo}
                placeholder="owner/name or filter"
                returnKeyType="go"
                onSubmitEditing={() => chooseRepo(repo)}
              />
              {busy && <ActivityIndicator color={theme.inkMuted} style={{ marginVertical: 8 }} />}
              {repos
                .filter((r) => !q || r.toLowerCase().includes(q))
                .slice(0, 30)
                .map((r) => (
                  <ListRow
                    key={r}
                    title={r}
                    value={settings.repos.includes(r) ? 'pinned' : undefined}
                    onPress={() => chooseRepo(r)}
                    titleStyle={{ fontFamily: FONT.mono, fontSize: 14 }}
                    style={{ borderRadius: RADIUS.sm, paddingHorizontal: 8 }}
                  />
                ))}
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.inkMuted, fontFamily: FONT.mono, fontSize: 13 }}>{repo} · branch</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {branches.map((b) => {
                  const on = b === branch;
                  return (
                    <Pressable
                      key={b}
                      onPress={() => setBranch(b)}
                      accessibilityRole="radio"
                      accessibilityLabel={b}
                      accessibilityState={{ checked: on, selected: on }}
                      hitSlop={4}
                      style={[styles.chip, { backgroundColor: on ? theme.accentSoft : theme.fill }]}
                    >
                      <Text style={{ color: on ? theme.accent : theme.ink, fontFamily: on ? FONT.monoSemibold : FONT.mono, fontSize: 13 }}>{b}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <PillButton title={`Open ${branch}`} loading={busy} onPress={openGithub} />
              <View style={{ alignItems: 'center' }}>
                <TextAction title="Another repository" onPress={() => setBranches([])} />
              </View>
            </View>
          )}
        </AddOption>
        <Divider inset={16} />
        <AddOption
          icon="folder"
          title="Laptop folder"
          detail={laptopConnected(settings) ? undefined : 'Connect the laptop bridge in Connections first.'}
        >
          {laptopConnected(settings) && (
            <>
              <TextField
                value={laptopRoot}
                onChangeText={setLaptopRoot}
                placeholder="Subfolder of the bridge root (optional)"
                accessibilityLabel="Laptop subfolder"
                autoCapitalize="none"
                mono
              />
              <PillButton title="Open laptop folder" icon="folder" variant="secondary" onPress={() => openLocal('laptop')} />
            </>
          )}
        </AddOption>
        <Divider inset={16} />
        <AddOption icon="smartphone" title="Phone folder" detail={settings.phoneFolder ? undefined : 'Share a phone folder in Connections first.'}>
          {settings.phoneFolder && (
            <PillButton title={`Open “${settings.phoneFolder.name}”`} icon="smartphone" variant="secondary" onPress={() => openLocal('phone')} />
          )}
        </AddOption>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: RADIUS.md, borderWidth: 1 },
  tile: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: RADIUS.pill },
});
