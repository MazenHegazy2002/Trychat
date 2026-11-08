import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../components/Text';
import {
  Banner,
  Card,
  Divider,
  Icon,
  ListRow,
  PillButton,
  SectionLabel,
  SegmentedControl,
  StatusBadge,
  TextAction,
  TextField,
} from '../components/ui';
import * as storage from '../lib/storage';
import { useStore } from '../lib/store';
import { FONT, RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../lib/theme';

const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SYNC_SERVER_URL ?? 'http://169.58.133.158:8787';

const MODES = [
  { value: 'signin', label: 'Sign in' },
  { value: 'signup', label: 'Create account' },
] as const;

function timeAgo(ts?: number) {
  if (!ts) return 'not yet';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 30) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** Phone gutters; on wide screens a centred column with 24px gutters. */
function usePageStyle(maxWidth: number) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE_BREAKPOINT;
  return {
    width: '100%' as const,
    maxWidth,
    alignSelf: 'center' as const,
    paddingHorizontal: wide ? 24 : 16,
    paddingTop: wide ? 32 : 8,
    paddingBottom: insets.bottom + 24,
  };
}

export default function AccountScreen() {
  const { account } = useStore();
  return account ? <SignedIn /> : <SignInForm />;
}

function SignedIn() {
  const theme = useTheme();
  const page = usePageStyle(SIZE.contentMax);
  const { account, signOut, syncNow, syncStatus, memories, conversations, skills } = useStore();
  if (!account) return null;
  const initial = (account.user.name || account.user.email)[0]?.toUpperCase();
  const syncing = syncStatus.state === 'syncing';
  const failed = syncStatus.state === 'error';

  const stats: [number, string][] = [
    [memories.length, 'Memories'],
    [conversations.length, 'Chats'],
    [skills.length, 'Skills'],
  ];

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={page}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Stack.Screen options={{ title: 'Account' }} />
      <View style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
          <Text style={[TYPE.title, { color: theme.accent }]}>{initial}</Text>
        </View>
        {!!account.user.name && (
          <Text style={[TYPE.title, { color: theme.ink, textAlign: 'center' }]} numberOfLines={1}>
            {account.user.name}
          </Text>
        )}
        <Text style={[TYPE.callout, { color: theme.inkMuted, textAlign: 'center' }]} numberOfLines={1}>
          {account.user.email}
        </Text>
      </View>

      <SectionLabel>Sync</SectionLabel>
      <Card>
        <View style={styles.syncHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '600' }]}>Synced to your account</Text>
            <Text style={[TYPE.caption, { color: failed ? theme.danger : theme.inkMuted, marginTop: 2 }]}>
              {syncing
                ? 'Syncing…'
                : failed
                  ? `Sync failed: ${syncStatus.error}`
                  : `Last synced ${timeAgo(account.lastSyncAt)}`}
            </Text>
          </View>
          <View>
            <StatusBadge tone={syncing ? 'running' : failed ? 'danger' : 'success'}>
              {syncing ? 'Syncing' : failed ? 'Failed' : 'Synced'}
            </StatusBadge>
          </View>
        </View>
        <View style={styles.stats}>
          {stats.map(([n, label]) => (
            <View key={label} style={[styles.stat, { backgroundColor: theme.fill }]}>
              <Text style={[TYPE.title, { color: theme.ink }]}>{n}</Text>
              <Text style={[TYPE.caption, { color: theme.inkMuted }]}>{label}</Text>
            </View>
          ))}
        </View>
        <Divider />
        <ListRow
          icon="refresh-cw"
          title="Sync now"
          onPress={syncing ? undefined : syncNow}
          right={syncing ? <ActivityIndicator color={theme.inkMuted} /> : undefined}
        />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <ListRow
          icon="users"
          title="Friends"
          subtitle="Share files with friends on this server"
          chevron
          onPress={() => router.push('/friends')}
        />
      </Card>

      <SectionLabel>Account server</SectionLabel>
      <Card style={styles.serverCard}>
        <Text style={[TYPE.code, { color: theme.ink }]}>{account.serverUrl}</Text>
        <Text style={[TYPE.caption, { color: theme.inkMuted }]}>
          Keys and tokens stay on each device. Sign in with this account on another phone to get your memory there.
        </Text>
      </Card>

      <PillButton
        title="Sign out"
        variant="danger"
        icon="log-out"
        style={{ marginTop: 24 }}
        onPress={() =>
          Alert.alert('Sign out?', 'Your data stays on this device and in your account.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: signOut },
          ])
        }
      />
    </KeyboardAwareScrollView>
  );
}

function SignInForm() {
  const theme = useTheme();
  const page = usePageStyle(480);
  const { signIn, memories, conversations, skills, projects, mcpServers, plugins } = useStore();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [editingServer, setEditingServer] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  /** Signing in to another account than this phone last used would add this phone's data to it: ask first. */
  const confirmMerge = async (): Promise<boolean> => {
    const target = email.trim().toLowerCase();
    const last = await storage.loadLastAccountEmail();
    const hasData = [memories, conversations, skills, projects, mcpServers, plugins].some((l) => l.length > 0);
    if (!last || !hasData || last.toLowerCase() === target) return true;
    return new Promise((resolve) =>
      Alert.alert(`Add this phone’s chats and memory to ${target}?`, `They were last synced with ${last}.`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Add them', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) }),
    );
  };

  const submit = async () => {
    if (!(await confirmMerge())) return;
    setWorking(true);
    setError('');
    try {
      await signIn(server.trim(), mode, { email: email.trim(), password, name: name.trim() || undefined });
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  const title = mode === 'signin' ? 'Sign in' : 'Create account';

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[page, { flexGrow: 1 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Stack.Screen options={{ title: '' }} />
      <Text style={[TYPE.title, { color: theme.ink }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[TYPE.body, { color: theme.inkMuted, marginTop: 6 }]}>Keep your memory and chats on every device.</Text>

      <SegmentedControl label="Account" options={MODES} value={mode} onChange={setMode} style={{ marginTop: 24 }} />

      <View style={styles.form}>
        {mode === 'signup' && <TextField label="Name" value={name} onChangeText={setName} placeholder="Your name" />}
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder={mode === 'signup' ? 'At least 8 characters' : 'Password'}
          secureTextEntry
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        />

        {editingServer ? (
          <TextField
            label="Account server"
            value={server}
            onChangeText={setServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            mono
          />
        ) : (
          <Card style={styles.serverRow}>
            <Icon name="server" size={16} />
            <Text style={[TYPE.caption, { color: theme.inkMuted }]}>Account server</Text>
            <Text style={{ color: theme.ink, fontFamily: FONT.mono, fontSize: 12, lineHeight: 16, flex: 1 }} numberOfLines={1}>
              {hostOf(server)}
            </Text>
            <TextAction title="Change" onPress={() => setEditingServer(true)} />
          </Card>
        )}

        {!!error && (
          <Banner tone="danger" title={mode === 'signin' ? 'Couldn’t sign in.' : 'Couldn’t create your account.'}>
            {error}
          </Banner>
        )}
      </View>

      <View style={{ flexGrow: 1, minHeight: 24 }} />
      <View style={{ gap: 8 }}>
        <PillButton title={title} size="lg" onPress={submit} loading={working} disabled={!email || !password} />
        <PillButton title="Continue without an account" variant="ghost" onPress={() => router.back()} />
        <Text style={[TYPE.caption, { color: theme.inkFaint, textAlign: 'center', marginTop: 4 }]}>
          Keys and tokens never leave this device.
        </Text>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  profile: { alignItems: 'center', gap: 4, paddingTop: 16 },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  syncHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 12, paddingTop: 12 },
  stats: { flexDirection: 'row', gap: 8, padding: 12 },
  stat: { flex: 1, borderRadius: RADIUS.sm, paddingVertical: 12, alignItems: 'center' },
  serverCard: { padding: 16, gap: 6 },
  form: { gap: 16, marginTop: 24 },
  serverRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 8, minHeight: 48 },
});
