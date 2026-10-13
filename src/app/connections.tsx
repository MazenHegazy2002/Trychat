import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import { listUserRepos, normalizeRepo, repoInfo, type RepoInfo } from '../lib/github';
import { appPhoneFolder, checkPhoneFolder, phoneFolderSupported, pickPhoneFolder } from '../lib/phoneTools';
import { githubWhoAmI, laptopInfo, normalizeBridgeUrl } from '../lib/tools';
import type { Settings } from '../lib/types';

const BRIDGE_COMMAND = 'node bridge/trychat-bridge.mjs --root=~/Projects';

type Status = { state: 'idle' | 'testing' | 'ok' | 'error'; text?: string };

export default function ConnectionsScreen() {
  const theme = useTheme();
  const { settings, updateSettings } = useStore();
  const [draft, setDraft] = useState<Settings>(settings);
  const [github, setGithub] = useState<Status>({ state: 'idle' });
  const [laptop, setLaptop] = useState<Status>({ state: 'idle' });
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newRepo, setNewRepo] = useState('');

  const [repoError, setRepoError] = useState('');
  const [phone, setPhone] = useState<Status>({ state: 'idle' });
  const [browse, setBrowse] = useState<{ state: 'idle' | 'loading' | 'ok' | 'error'; repos: RepoInfo[]; next: boolean; page: number; error?: string }>({
    state: 'idle',
    repos: [],
    next: false,
    page: 0,
  });

  const addRepo = async () => {
    const repo = normalizeRepo(newRepo);
    if (!repo) {
      setRepoError('Use owner/name or a GitHub link.');
      return;
    }
    if (draft.repos.some((r) => r.toLowerCase() === repo.toLowerCase())) return setNewRepo('');
    setRepoError('');
    let name = repo;
    if (draft.githubToken) {
      try {
        name = (await repoInfo(draft, repo)).full_name;
      } catch (e) {
        const status = (e as { status?: number }).status;
        // Not found / no access: tell the user instead of pinning a repo the tools can't use. Offline: pin it anyway.
        if (status === 404 || status === 403 || status === 401) return setRepoError(e instanceof Error ? e.message : String(e));
      }
    }
    set('repos', [...draft.repos, name]);
    setNewRepo('');
  };

  const togglePin = (repo: string) =>
    set('repos', draft.repos.includes(repo) ? draft.repos.filter((r) => r !== repo) : [...draft.repos, repo]);

  const loadRepos = async (page: number) => {
    setBrowse((b) => ({ ...b, state: 'loading' }));
    try {
      const { repos, next } = await listUserRepos(draft, page);
      setBrowse((b) => ({ state: 'ok', repos: page === 1 ? repos : [...b.repos, ...repos], next, page }));
    } catch (e) {
      setBrowse((b) => ({ ...b, state: 'error', error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const folder = draft.phoneFolder;
  useEffect(() => {
    if (!folder) return setPhone({ state: 'idle' });
    const r = checkPhoneFolder(folder);
    setPhone(r.ok ? { state: 'ok', text: `${r.items} item${r.items === 1 ? '' : 's'} · TryChat can read it and, with your OK, change files in it` } : { state: 'error', text: r.error });
  }, [folder]);

  const choosePhoneFolder = async () => {
    try {
      const picked = await pickPhoneFolder();
      if (picked) set('phoneFolder', picked);
    } catch (e) {
      setPhone({ state: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    updateSettings({ [key]: value });
  };

  const testGithub = async () => {
    setGithub({ state: 'testing' });
    try {
      setGithub({ state: 'ok', text: `Signed in as ${await githubWhoAmI(draft)}` });
    } catch (e) {
      setGithub({ state: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const testLaptop = async () => {
    setLaptop({ state: 'testing' });
    try {
      const info = await laptopInfo(draft);
      setLaptop({ state: 'ok', text: `${info.hostname} · ${info.platform} · ${info.root}` });
    } catch (e) {
      setLaptop({ state: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text }];
  const label = (t: string) => <Text style={[styles.label, { color: theme.muted }]}>{t}</Text>;

  const statusLine = (s: Status) =>
    s.state === 'testing' ? (
      <ActivityIndicator style={{ marginTop: 10, alignSelf: 'flex-start' }} color={theme.primary} />
    ) : s.text ? (
      <Text style={{ color: s.state === 'ok' ? theme.text : theme.danger, marginTop: 10 }}>
        {s.state === 'ok' ? '✓ ' : ''}
        {s.text}
      </Text>
    ) : null;

  const actions = (onTest: () => void, onDisconnect: () => void, connected: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 14 }}>
      <Pressable onPress={onTest} disabled={!connected} style={[styles.button, { backgroundColor: connected ? theme.text : theme.border }]}>
        <Text style={{ color: theme.bg, fontWeight: '700' }}>Test</Text>
      </Pressable>
      {connected && (
        <Pressable onPress={onDisconnect} hitSlop={8}>
          <Text style={{ color: theme.danger, fontWeight: '600' }}>Disconnect</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <KeyboardAwareScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={{ color: theme.muted, fontSize: 15, lineHeight: 21 }}>
        TryChat can read and change code on GitHub and run tasks on your laptop. You approve commands and changes before
        they happen.
      </Text>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>GitHub</Text>
        {label('Personal access token')}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TextInput
            value={draft.githubToken}
            onChangeText={(v) => set('githubToken', v.trim())}
            secureTextEntry={!showToken}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="ghp_… or github_pat_…"
            placeholderTextColor={theme.muted}
            style={[input, { flex: 1, backgroundColor: theme.bg }]}
          />
          <Pressable onPress={() => setShowToken((v) => !v)} hitSlop={8}>
            <Text style={{ color: theme.primary, fontWeight: '600' }}>{showToken ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
        <Text style={[styles.help, { color: theme.muted }]}>
          Create one at github.com → Settings → Developer settings → Personal access tokens. Give it “Contents”, “Issues”
          and “Pull requests” read & write access to the repos you want. Stored in secure storage.
        </Text>
        {statusLine(github)}
        {actions(testGithub, () => {
          set('githubToken', '');
          setGithub({ state: 'idle' });
        }, !!draft.githubToken)}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>Repositories</Text>
        <Text style={[styles.help, { color: theme.muted }]}>
          The repos TryChat works in. It treats them as “my repo”, and with one pinned it’s used whenever you don’t name
          another. Give the token Contents, Issues and Pull requests access to them.
        </Text>
        {draft.repos.map((repo) => (
          <View key={repo} style={[styles.repoRow, { borderTopColor: theme.border }]}>
            <Text style={[styles.mono, { color: theme.text, flex: 1, fontSize: 14 }]}>{repo}</Text>
            <Pressable
              onPress={() => set('repos', draft.repos.filter((r) => r !== repo))}
              hitSlop={10}
              accessibilityLabel={`Remove ${repo}`}
            >
              <Text style={{ color: theme.danger, fontSize: 16 }}>✕</Text>
            </Pressable>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'center' }}>
          <TextInput
            value={newRepo}
            onChangeText={setNewRepo}
            onSubmitEditing={addRepo}
            placeholder="owner/repo or GitHub link"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[input, { flex: 1, backgroundColor: theme.bg }]}
          />
          <Pressable onPress={addRepo} hitSlop={8}>
            <Text style={{ color: theme.primary, fontWeight: '700' }}>Add</Text>
          </Pressable>
        </View>
        {!!repoError && <Text style={{ color: theme.danger, marginTop: 8, fontSize: 13 }}>{repoError}</Text>}
        {!!draft.githubToken && browse.state === 'idle' && (
          <Pressable onPress={() => loadRepos(1)} hitSlop={8} style={{ marginTop: 14 }}>
            <Text style={{ color: theme.primary, fontWeight: '600' }}>Choose from your GitHub repos</Text>
          </Pressable>
        )}
        {browse.repos.map((r) => {
          const pinned = draft.repos.includes(r.full_name);
          return (
            <Pressable
              key={r.full_name}
              onPress={() => togglePin(r.full_name)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: pinned }}
              style={[styles.repoRow, { borderTopColor: theme.border }]}
            >
              <Text style={{ width: 24, color: theme.primary, fontSize: 16 }}>{pinned ? '✓' : ''}</Text>
              <Text style={[styles.mono, { color: theme.text, flex: 1, fontSize: 13 }]} numberOfLines={1}>
                {r.full_name}
              </Text>
              {r.private && <Text style={{ color: theme.muted, fontSize: 12 }}>private</Text>}
            </Pressable>
          );
        })}
        {browse.state === 'loading' && <ActivityIndicator style={{ marginTop: 10, alignSelf: 'flex-start' }} color={theme.primary} />}
        {browse.state === 'error' && <Text style={{ color: theme.danger, marginTop: 10 }}>{browse.error}</Text>}
        {browse.state === 'ok' && browse.next && (
          <Pressable onPress={() => loadRepos(browse.page + 1)} hitSlop={8} style={{ marginTop: 12 }}>
            <Text style={{ color: theme.primary, fontWeight: '600' }}>Show more</Text>
          </Pressable>
        )}
      </View>

      {phoneFolderSupported() && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>Phone folder</Text>
          <Text style={[styles.help, { color: theme.muted }]}>
            Share one folder on this phone with TryChat. It can list, search and read files there, and write files when you
            allow it — nothing outside the folder.
            {Platform.OS === 'ios'
              ? ' On iPhone, a folder you pick stays shared until TryChat closes; the TryChat folder (Files → On My iPhone → TryChat) stays shared for good.'
              : ''}
          </Text>
          {folder && (
            <View style={[styles.repoRow, { borderTopColor: theme.border }]}>
              <Text style={{ color: theme.text, fontSize: 15, flex: 1 }} numberOfLines={1}>
                📁 {folder.name}
                {folder.source === 'app' ? ' (Files app)' : ''}
              </Text>
            </View>
          )}
          {statusLine(phone)}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 20, marginTop: 14 }}>
            <Pressable onPress={choosePhoneFolder} style={[styles.button, { backgroundColor: theme.text }]}>
              <Text style={{ color: theme.bg, fontWeight: '700' }}>{folder ? 'Change folder' : 'Choose folder'}</Text>
            </Pressable>
            {Platform.OS === 'ios' && folder?.source !== 'app' && (
              <Pressable onPress={() => set('phoneFolder', appPhoneFolder())} hitSlop={8}>
                <Text style={{ color: theme.primary, fontWeight: '600' }}>Use TryChat folder</Text>
              </Pressable>
            )}
            {folder && (
              <Pressable onPress={() => set('phoneFolder', null)} hitSlop={8}>
                <Text style={{ color: theme.danger, fontWeight: '600' }}>Disconnect</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>Laptop</Text>
        <Text style={[styles.help, { color: theme.muted, marginTop: 4 }]}>
          On your laptop, from this project’s folder, start the bridge (Node 18+). It prints the address and pairing code
          to enter here. Your phone and laptop must be on the same Wi-Fi.
        </Text>
        <Pressable
          onPress={async () => {
            await Clipboard.setStringAsync(BRIDGE_COMMAND);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          style={[styles.command, { backgroundColor: theme.codeBg }]}
        >
          <Text style={[styles.mono, { color: theme.codeText, flex: 1 }]}>{BRIDGE_COMMAND}</Text>
          <Text style={{ color: theme.codeText, fontSize: 12, fontWeight: '600' }}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
        {label('Bridge address')}
        <TextInput
          value={draft.bridgeUrl}
          onChangeText={(v) => set('bridgeUrl', v.trim())}
          onBlur={() => draft.bridgeUrl && set('bridgeUrl', normalizeBridgeUrl(draft.bridgeUrl))}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.24:8765"
          placeholderTextColor={theme.muted}
          style={[input, { backgroundColor: theme.bg }]}
        />
        {label('Pairing code')}
        <TextInput
          value={draft.bridgeToken}
          onChangeText={(v) => set('bridgeToken', v.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="XXXX-XXXX-XXXX"
          placeholderTextColor={theme.muted}
          style={[input, { backgroundColor: theme.bg }]}
        />
        {statusLine(laptop)}
        {actions(testLaptop, () => {
          set('bridgeUrl', '');
          set('bridgeToken', '');
          setLaptop({ state: 'idle' });
        }, !!draft.bridgeUrl && !!draft.bridgeToken)}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>Permissions</Text>
        {(
          [
            ['confirmCommands', 'Ask before running commands', 'Every command on your laptop needs your OK'],
            ['confirmWrites', 'Ask before writing files or committing', 'Review each file change, commit and new issue'],
            ['confirmReads', 'Ask before reading', 'Off: TryChat can list and read files on its own'],
          ] as const
        ).map(([key, title, desc]) => (
          <View key={key} style={[styles.switchRow, { borderTopColor: theme.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: theme.text, fontSize: 15 }}>{title}</Text>
              <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>{desc}</Text>
            </View>
            <Switch value={draft[key]} onValueChange={(v) => set(key, v)} />
          </View>
        ))}
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16, marginTop: 16 },
  title: { fontSize: 18, fontWeight: '600' },
  label: { fontSize: 13, marginTop: 14, marginBottom: 6 },
  help: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, minHeight: 44 },
  button: { minHeight: 44, paddingHorizontal: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  command: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, padding: 12, marginTop: 12 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  repoRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4 },
});
