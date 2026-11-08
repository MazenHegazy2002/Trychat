import * as Clipboard from 'expo-clipboard';
import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Text } from '../components/Text';
import {
  Banner,
  Card,
  Chip,
  ClaySwitch,
  Divider,
  Icon,
  IconButton,
  IconTile,
  PillButton,
  SectionLabel,
  StatusBadge,
  TextAction,
  TextField,
} from '../components/ui';
import type { IconName } from '../components/ui';
import { useStore } from '../lib/store';
import { FONT, RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../lib/theme';
import { listUserRepos, normalizeRepo, repoInfo, type RepoInfo } from '../lib/github';
import { appPhoneFolder, checkPhoneFolder, phoneFolderSupported, pickPhoneFolder } from '../lib/phoneTools';
import { githubWhoAmI, laptopInfo, normalizeBridgeUrl } from '../lib/tools';
import type { Settings } from '../lib/types';

const BRIDGE_COMMAND = 'node bridge/trychat-bridge.mjs --root=~/Projects';

const PERMISSIONS = [
  ['confirmCommands', 'Ask before running commands', 'Every command on your laptop needs your OK'],
  ['confirmWrites', 'Ask before writing files or committing', 'Review each file change, commit and new issue'],
  ['confirmReads', 'Ask before reading', 'Off: TryChat can list and read files on its own'],
] as const;

type Status = { state: 'idle' | 'testing' | 'ok' | 'error'; text?: string };

export default function ConnectionsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
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

  const githubOn = !!draft.githubToken;
  const laptopOn = !!draft.bridgeUrl && !!draft.bridgeToken;

  const badge = (on: boolean, failed = false) => (
    <StatusBadge tone={failed ? 'danger' : on ? 'success' : 'neutral'}>
      {failed ? 'Failed' : on ? 'Connected' : 'Not connected'}
    </StatusBadge>
  );

  const header = (icon: IconName, title: string, right?: ReactNode) => (
    <View style={styles.cardHead}>
      <IconTile name={icon} size={36} />
      <Text style={[TYPE.headline, { color: theme.ink, flex: 1 }]} accessibilityRole="header">
        {title}
      </Text>
      {right}
    </View>
  );

  const statusLine = (s: Status) =>
    s.state === 'testing' ? (
      <View style={styles.testing}>
        <ActivityIndicator color={theme.inkMuted} />
        <Text style={[TYPE.caption, { color: theme.inkMuted }]}>Testing…</Text>
      </View>
    ) : s.text ? (
      <Banner tone={s.state === 'ok' ? 'success' : 'danger'}>{s.text}</Banner>
    ) : null;

  const actions = (onTest: () => void, onDisconnect: () => void, connected: boolean) => (
    <View style={styles.actions}>
      <PillButton title="Test" variant="secondary" icon="activity" onPress={onTest} disabled={!connected} />
      {connected && <PillButton title="Disconnect" variant="danger" onPress={onDisconnect} />}
    </View>
  );

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[styles.page, { paddingHorizontal: wide ? 24 : 16, paddingTop: wide ? 24 : 16 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Text style={[TYPE.callout, { color: theme.inkMuted }]}>
        TryChat can read and change code on GitHub and run tasks on your laptop. You approve commands and changes before
        they happen.
      </Text>

      <Card style={styles.card}>
        {header('github', 'GitHub', badge(githubOn, github.state === 'error'))}
        <TextField
          label="Personal access token"
          hint="Create one at github.com → Settings → Developer settings → Personal access tokens. Give it “Contents”, “Issues” and “Pull requests” read & write access to the repos you want. Stored in secure storage."
          value={draft.githubToken}
          onChangeText={(v) => set('githubToken', v.trim())}
          secureTextEntry={!showToken}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="ghp_… or github_pat_…"
          mono
          right={
            <FieldAction
              title={showToken ? 'Hide' : 'Show'}
              label={showToken ? 'Hide token' : 'Show token'}
              onPress={() => setShowToken((v) => !v)}
            />
          }
        />
        {statusLine(github)}
        {actions(testGithub, () => {
          set('githubToken', '');
          setGithub({ state: 'idle' });
        }, githubOn)}
      </Card>

      <Card style={styles.card}>
        {header('git-branch', 'Repositories')}
        <Text style={[TYPE.caption, { color: theme.inkMuted }]}>
          The repos TryChat works in. It treats them as “my repo”, and with one pinned it’s used whenever you don’t name
          another. Give the token Contents, Issues and Pull requests access to them.
        </Text>
        {draft.repos.length > 0 && (
          <View>
            {draft.repos.map((repo) => (
              <Fragment key={repo}>
                <Divider />
                <View style={styles.repoRow}>
                  <Text style={[styles.mono, { color: theme.ink, flex: 1 }]} numberOfLines={1}>
                    {repo}
                  </Text>
                  <IconButton
                    name="x"
                    label={`Remove ${repo}`}
                    onPress={() => set('repos', draft.repos.filter((r) => r !== repo))}
                  />
                </View>
              </Fragment>
            ))}
          </View>
        )}
        <TextField
          value={newRepo}
          onChangeText={(v) => {
            setNewRepo(v);
            if (repoError) setRepoError('');
          }}
          onSubmitEditing={addRepo}
          placeholder="owner/repo or GitHub link"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Repository to add"
          error={repoError || undefined}
          mono
          right={<FieldAction title="Add" label="Add repository" onPress={addRepo} />}
        />
        {!!draft.githubToken && browse.state === 'idle' && (
          <View style={{ alignSelf: 'flex-start' }}>
            <TextAction title="Choose from your GitHub repos" onPress={() => loadRepos(1)} />
          </View>
        )}
        {browse.repos.length > 0 && (
          <View>
            {browse.repos.map((r) => {
              const pinned = draft.repos.includes(r.full_name);
              return (
                <Pressable
                  key={r.full_name}
                  onPress={() => togglePin(r.full_name)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: pinned }}
                  accessibilityLabel={r.full_name}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.pickRow,
                    { backgroundColor: pressed || hovered ? theme.fill : 'transparent' },
                  ]}
                >
                  <View
                    style={[
                      styles.check,
                      { borderColor: pinned ? theme.accent : theme.borderStrong, backgroundColor: pinned ? theme.accent : 'transparent' },
                    ]}
                  >
                    {pinned && <Icon name="check" size={14} color={theme.onAccent} />}
                  </View>
                  <Text style={[styles.mono, { color: theme.ink, flex: 1, fontSize: 13 }]} numberOfLines={1}>
                    {r.full_name}
                  </Text>
                  {r.private && <Chip>private</Chip>}
                </Pressable>
              );
            })}
          </View>
        )}
        {browse.state === 'loading' && <ActivityIndicator style={{ alignSelf: 'flex-start' }} color={theme.inkMuted} />}
        {browse.state === 'error' && <Banner tone="danger">{browse.error}</Banner>}
        {browse.state === 'ok' && browse.next && (
          <View style={{ alignSelf: 'flex-start' }}>
            <TextAction title="Show more" onPress={() => loadRepos(browse.page + 1)} />
          </View>
        )}
      </Card>

      {phoneFolderSupported() && (
        <Card style={styles.card}>
          {header('smartphone', 'Phone folder', badge(!!folder, !!folder && phone.state === 'error'))}
          <Text style={[TYPE.caption, { color: theme.inkMuted }]}>
            Share one folder on this phone with TryChat. It can list, search and read files there, and write files when you
            allow it — nothing outside the folder.
            {Platform.OS === 'ios'
              ? ' On iPhone, a folder you pick stays shared until TryChat closes; the TryChat folder (Files → On My iPhone → TryChat) stays shared for good.'
              : ''}
          </Text>
          {folder && (
            <View style={[styles.folderRow, { backgroundColor: theme.fill }]}>
              <Icon name="folder" size={16} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[TYPE.callout, { color: theme.ink }]} numberOfLines={1}>
                  {folder.name}
                  {folder.source === 'app' ? ' (Files app)' : ''}
                </Text>
                {phone.state === 'ok' && !!phone.text && (
                  <Text style={[TYPE.caption, { color: theme.inkMuted }]}>{phone.text}</Text>
                )}
              </View>
            </View>
          )}
          {phone.state === 'error' && !!phone.text && <Banner tone="danger">{phone.text}</Banner>}
          <View style={styles.actions}>
            <PillButton
              title={folder ? 'Change folder' : 'Choose folder'}
              variant="secondary"
              icon="folder"
              onPress={choosePhoneFolder}
            />
            {Platform.OS === 'ios' && folder?.source !== 'app' && (
              <TextAction title="Use TryChat folder" onPress={() => set('phoneFolder', appPhoneFolder())} />
            )}
            {folder && <PillButton title="Disconnect" variant="danger" onPress={() => set('phoneFolder', null)} />}
          </View>
        </Card>
      )}

      <Card style={styles.card}>
        {header('monitor', 'Laptop', badge(laptopOn, laptop.state === 'error'))}
        <Text style={[TYPE.caption, { color: theme.inkMuted }]}>
          On your laptop, from this project’s folder, start the bridge (Node 18+). It prints the address and pairing code
          to enter here. Your phone and laptop must be on the same Wi-Fi.
        </Text>
        <Pressable
          onPress={async () => {
            await Clipboard.setStringAsync(BRIDGE_COMMAND);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Copied' : 'Copy the bridge command'}
          style={[styles.command, { backgroundColor: theme.codeBg }]}
        >
          <Text style={[TYPE.code, { color: theme.codeInk, flex: 1 }]}>{BRIDGE_COMMAND}</Text>
          <View style={styles.copy}>
            <Icon name={copied ? 'check' : 'copy'} size={14} color={theme.codeInk} />
            <Text style={[TYPE.codeLabel, { color: theme.codeInk }]}>{copied ? 'Copied' : 'Copy'}</Text>
          </View>
        </Pressable>
        <TextField
          label="Bridge address"
          value={draft.bridgeUrl}
          onChangeText={(v) => set('bridgeUrl', v.trim())}
          onBlur={() => draft.bridgeUrl && set('bridgeUrl', normalizeBridgeUrl(draft.bridgeUrl))}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.24:8765"
          mono
        />
        <TextField
          label="Pairing code"
          value={draft.bridgeToken}
          onChangeText={(v) => set('bridgeToken', v.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="XXXX-XXXX-XXXX"
          mono
        />
        {statusLine(laptop)}
        {actions(testLaptop, () => {
          set('bridgeUrl', '');
          set('bridgeToken', '');
          setLaptop({ state: 'idle' });
        }, laptopOn)}
      </Card>

      <SectionLabel>Permissions</SectionLabel>
      <Card>
        {PERMISSIONS.map(([key, title, desc], i) => (
          <Fragment key={key}>
            {i > 0 && <Divider inset={16} />}
            <View style={styles.switchRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[TYPE.callout, { color: theme.ink }]}>{title}</Text>
                <Text style={[TYPE.caption, { color: theme.inkMuted, marginTop: 2 }]}>{desc}</Text>
              </View>
              <ClaySwitch value={draft[key]} onValueChange={(v) => set(key, v)} label={title} />
            </View>
          </Fragment>
        ))}
      </Card>
    </KeyboardAwareScrollView>
  );
}

/** Text button at the end of a field (Show / Hide, Add). */
function FieldAction({ title, label, onPress }: { title: string; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.fieldAction,
        { backgroundColor: pressed || hovered ? theme.surfaceRaised : 'transparent' },
      ]}
    >
      <Text style={[TYPE.subhead, { color: theme.accent }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 48, width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center' },
  card: { padding: 16, gap: 12, marginTop: 16 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  testing: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  mono: { fontFamily: FONT.mono, fontSize: 14, lineHeight: 20 },
  repoRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 8, marginRight: -8 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: RADIUS.sm },
  check: { width: 22, height: 22, borderRadius: RADIUS.xs, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  folderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: RADIUS.sm },
  command: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.sm, padding: 12, minHeight: 44 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fieldAction: { minHeight: 40, paddingHorizontal: 12, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, paddingVertical: 10 },
});
