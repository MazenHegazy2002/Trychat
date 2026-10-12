import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Divider, Icon, PillButton, SectionLabel } from '../components/ui';
import type { IconName } from '../components/ui';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';

const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SYNC_SERVER_URL ?? 'http://169.58.133.158:8787';

function timeAgo(ts?: number) {
  if (!ts) return 'not yet';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 30) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

export default function AccountScreen() {
  const { account } = useStore();
  return account ? <SignedIn /> : <SignInForm />;
}

function SignedIn() {
  const theme = useTheme();
  const { account, signOut, syncNow, syncStatus, memories, conversations, skills } = useStore();
  if (!account) return null;
  const initial = (account.user.name || account.user.email)[0]?.toUpperCase();

  const stats: [number, string][] = [
    [memories.length, 'Memories'],
    [conversations.length, 'Chats'],
    [skills.length, 'Skills'],
  ];

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: 'Account' }} />
      <View style={{ alignItems: 'center', marginBottom: 24 }}>
        <View style={[styles.avatar, { backgroundColor: theme.oat }]}>
          <Text style={{ color: theme.text, fontSize: 28, fontFamily: theme.serif }}>{initial}</Text>
        </View>
        <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 26, marginTop: 12 }}>{account.user.name}</Text>
        <Text style={{ color: theme.muted, fontSize: 15, marginTop: 2 }}>{account.user.email}</Text>
      </View>

      <Card style={{ padding: 16 }}>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>Synced to your account</Text>
        <View style={styles.stats}>
          {stats.map(([n, label]) => (
            <View key={label} style={[styles.stat, { backgroundColor: theme.surface2 }]}>
              <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 24 }}>{n}</Text>
              <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.syncRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Icon
              name={syncStatus.state === 'error' ? 'alert-circle' : 'check-circle'}
              size={16}
              color={syncStatus.state === 'error' ? theme.danger : theme.accent}
            />
            <Text style={{ color: syncStatus.state === 'error' ? theme.danger : theme.muted, fontSize: 13, flex: 1 }}>
              {syncStatus.state === 'syncing'
                ? 'Syncing…'
                : syncStatus.state === 'error'
                  ? `Sync failed: ${syncStatus.error}`
                  : `Last synced ${timeAgo(account.lastSyncAt)}`}
            </Text>
          </View>
          <PillButton title="Sync now" onPress={syncNow} loading={syncStatus.state === 'syncing'} style={{ minHeight: 40 }} />
        </View>
      </Card>

      <SectionLabel>Account server</SectionLabel>
      <Card style={{ padding: 16 }}>
        <Text style={{ color: theme.text, fontFamily: 'monospace', fontSize: 14 }}>{account.serverUrl}</Text>
        <Text style={{ color: theme.muted, fontSize: 13, marginTop: 6 }}>
          Keys and tokens stay on each device. Sign in with this account on another phone to get your memory there.
        </Text>
      </Card>

      <Pressable
        onPress={() =>
          Alert.alert('Sign out?', 'Your data stays on this device and in your account.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: signOut },
          ])
        }
        style={styles.signOut}
        accessibilityRole="button"
      >
        <Text style={{ color: theme.danger, fontWeight: '600', fontSize: 15 }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function SignInForm() {
  const theme = useTheme();
  const { signIn } = useStore();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [editingServer, setEditingServer] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }];
  const label = (t: string) => <Text style={[styles.label, { color: theme.muted }]}>{t}</Text>;

  const submit = async () => {
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

  const benefits: [IconName, string][] = [
    ['bookmark', 'Memory syncs across devices'],
    ['message-square', 'Chats on your phone and tablet'],
    ['layers', 'Skills and MCP servers go with you'],
  ];

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: '' }} />
      <View style={{ alignItems: 'center' }}>
        <View style={[styles.mark, { backgroundColor: theme.accent }]}>
          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '700' }}>T</Text>
        </View>
        <Text style={{ fontFamily: theme.serif, fontSize: 32, color: theme.text, marginTop: 16, textAlign: 'center' }}>
          Welcome to TryChat
        </Text>
        <Text style={{ color: theme.muted, fontSize: 15, marginTop: 6, textAlign: 'center' }}>
          Sign in and your memory follows you to every device.
        </Text>
      </View>

      <View style={[styles.segment, { backgroundColor: theme.surface2 }]}>
        {(['signin', 'signup'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[styles.segmentItem, mode === m && { backgroundColor: theme.surface }]}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
          >
            <Text style={{ color: mode === m ? theme.text : theme.muted, fontWeight: '600' }}>
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === 'signup' && (
        <>
          {label('Name')}
          <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={theme.faint} style={input} />
        </>
      )}
      {label('Email')}
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={theme.faint}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        style={input}
      />
      {label('Password')}
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder={mode === 'signup' ? 'At least 8 characters' : 'Password'}
        placeholderTextColor={theme.faint}
        secureTextEntry
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        style={input}
      />

      {editingServer ? (
        <>
          {label('Account server')}
          <TextInput
            value={server}
            onChangeText={setServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[input, { fontFamily: 'monospace', fontSize: 14 }]}
          />
        </>
      ) : (
        <View style={[styles.serverRow, { borderColor: theme.border }]}>
          <Icon name="server" size={16} />
          <Text style={{ color: theme.muted, fontSize: 13 }}>Account server</Text>
          <Text style={{ color: theme.text, fontFamily: 'monospace', fontSize: 13, flex: 1 }} numberOfLines={1}>
            {hostOf(server)}
          </Text>
          <Pressable onPress={() => setEditingServer(true)} hitSlop={12} accessibilityRole="button">
            <Text style={{ color: theme.primary, fontWeight: '600', fontSize: 13 }}>Change</Text>
          </Pressable>
        </View>
      )}

      {!!error && <Text style={{ color: theme.danger, marginTop: 12 }}>{error}</Text>}

      <PillButton
        title={mode === 'signin' ? 'Sign in' : 'Create account'}
        onPress={submit}
        loading={working}
        disabled={!email || !password}
        style={{ marginTop: 20, minHeight: 52 }}
      />
      <View style={styles.orRow}>
        <View style={[styles.orLine, { backgroundColor: theme.border }]} />
        <Text style={{ color: theme.faint, fontSize: 12 }}>or</Text>
        <View style={[styles.orLine, { backgroundColor: theme.border }]} />
      </View>
      <PillButton title="Continue without an account" variant="secondary" onPress={() => router.back()} />

      <Card style={{ marginTop: 24 }}>
        {benefits.map(([icon, text], i) => (
          <View key={text}>
            {i > 0 && <Divider />}
            <View style={styles.benefit}>
              <Icon name={icon} size={18} color={theme.text} />
              <Text style={{ color: theme.text, fontSize: 13 }}>{text}</Text>
            </View>
          </View>
        ))}
      </Card>
      <Text style={{ color: theme.faint, fontSize: 12, textAlign: 'center', marginTop: 16 }}>
        Keys and tokens never leave this device.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 48 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 14 },
  stat: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  signOut: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  segment: { flexDirection: 'row', borderRadius: 999, padding: 4, marginTop: 24 },
  segmentItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  label: { fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 48 },
  serverRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 48 },
});
