import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
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

  const addRepo = () => {
    const repo = newRepo
      .trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/+$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || draft.repos.includes(repo)) return;
    set('repos', [...draft.repos, repo]);
    setNewRepo('');
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
          Create one at github.com → Settings → Developer settings → Personal access tokens. Give it “Contents” and
          “Issues” read & write access to the repos you want. Stored in secure storage.
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
          Pin the repos you work in most. TryChat treats them as “my repo” and goes there first.
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
      </View>

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
