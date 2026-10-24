import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Icon, PillButton, ScreenIntro, SectionLabel } from '../../components/ui';
import { listUserRepos, normalizeRepo, repoInfo } from '../../lib/github';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { laptopConnected } from '../../lib/tools';
import { describeWorkspace } from '../../lib/workspace/backends';
import { branchHead, listBranches } from '../../lib/workspace/core';
import { addWorkspace, removeWorkspace, useWorkspaces } from '../../lib/workspace/store';

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
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Workspaces' }} />
      <ScreenIntro title="Workspaces">Open a repo or folder, edit files, and let the assistant work in it.</ScreenIntro>

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
            style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Icon name={w.kind === 'github' ? 'github' : w.kind === 'laptop' ? 'monitor' : 'smartphone'} size={18} color={theme.text} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{w.name}</Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>
                {describeWorkspace(w)}
                {n ? ` · ${n} staged` : ''}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} />
          </Pressable>
        );
      })}
      {!workspaces.length && <Text style={{ color: theme.muted, marginBottom: 12 }}>No workspaces yet.</Text>}

      <SectionLabel>Open a workspace</SectionLabel>
      <Card>
        <Text style={{ color: theme.text, fontWeight: '600', marginBottom: 6 }}>GitHub repository</Text>
        {!picking ? (
          <PillButton title="Choose repository" icon="github" variant="secondary" onPress={() => setPicking(true)} />
        ) : !repo || !branches.length ? (
          <>
            <TextInput
              value={repo}
              onChangeText={setRepo}
              placeholder="owner/name or filter"
              placeholderTextColor={theme.faint}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => chooseRepo(repo)}
              style={[styles.input, { backgroundColor: theme.surface2, color: theme.text }]}
            />
            {busy && <ActivityIndicator style={{ marginVertical: 8 }} />}
            {repos
              .filter((r) => !q || r.toLowerCase().includes(q))
              .slice(0, 30)
              .map((r) => (
                <Pressable key={r} onPress={() => chooseRepo(r)} style={styles.pick}>
                  <Text style={{ color: theme.text }}>{r}</Text>
                  {settings.repos.includes(r) && <Text style={{ color: theme.faint, fontSize: 12 }}>pinned</Text>}
                </Pressable>
              ))}
          </>
        ) : (
          <>
            <Text style={{ color: theme.muted, marginBottom: 6 }}>{repo} · branch</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {branches.map((b) => (
                <Pressable
                  key={b}
                  onPress={() => setBranch(b)}
                  style={[styles.chip, { backgroundColor: b === branch ? theme.text : theme.surface2 }]}
                >
                  <Text style={{ color: b === branch ? theme.bg : theme.text, fontSize: 13 }}>{b}</Text>
                </Pressable>
              ))}
            </View>
            <PillButton title={`Open ${branch}`} loading={busy} onPress={openGithub} />
            <Pressable onPress={() => setBranches([])} style={{ padding: 8, alignItems: 'center' }}>
              <Text style={{ color: theme.primary }}>Another repository</Text>
            </Pressable>
          </>
        )}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={{ color: theme.text, fontWeight: '600', marginBottom: 6 }}>Laptop folder</Text>
        {laptopConnected(settings) ? (
          <>
            <TextInput
              value={laptopRoot}
              onChangeText={setLaptopRoot}
              placeholder="Subfolder of the bridge root (optional)"
              placeholderTextColor={theme.faint}
              autoCapitalize="none"
              style={[styles.input, { backgroundColor: theme.surface2, color: theme.text }]}
            />
            <PillButton title="Open laptop folder" icon="monitor" variant="secondary" onPress={() => openLocal('laptop')} />
          </>
        ) : (
          <Text style={{ color: theme.muted }}>Connect the laptop bridge in Connections first.</Text>
        )}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={{ color: theme.text, fontWeight: '600', marginBottom: 6 }}>Phone folder</Text>
        {settings.phoneFolder ? (
          <PillButton title={`Open “${settings.phoneFolder.name}”`} icon="smartphone" variant="secondary" onPress={() => openLocal('phone')} />
        ) : (
          <Text style={{ color: theme.muted }}>Share a phone folder in Connections first.</Text>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 8 },
  pick: { paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between' },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
});
