import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';

const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SYNC_SERVER_URL ?? 'http://169.58.133.158:8787';

function timeAgo(ts?: number) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(ts).toLocaleString();
}

export default function AccountScreen() {
  const theme = useTheme();
  const { account, signIn, signOut, syncNow, syncStatus, memories, conversations, skills } = useStore();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [server, setServer] = useState(account?.serverUrl ?? DEFAULT_SERVER);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text }];

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

  if (account) {
    return (
      <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
            <Text style={{ color: theme.onPrimary, fontSize: 20, fontWeight: '700' }}>
              {(account.user.name || account.user.email)[0]?.toUpperCase()}
            </Text>
          </View>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '600', marginTop: 10 }}>{account.user.name}</Text>
          <Text style={{ color: theme.muted, marginTop: 2 }}>{account.user.email}</Text>
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 8 }}>{account.serverUrl}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, alignItems: 'stretch' }]}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Synced to your account</Text>
          <Text style={{ color: theme.muted, marginTop: 6, lineHeight: 20 }}>
            {memories.length} memories · {conversations.length} chats · {skills.length} skills, plus your MCP servers
            and preferences. Sign in on any device to get them there too. API keys and tokens stay on each device.
          </Text>
          <Text style={{ color: syncStatus.state === 'error' ? theme.danger : theme.muted, marginTop: 10, fontSize: 13 }}>
            {syncStatus.state === 'syncing'
              ? 'Syncing…'
              : syncStatus.state === 'error'
                ? `Sync failed: ${syncStatus.error}`
                : `Last synced ${timeAgo(account.lastSyncAt)}`}
          </Text>
          <Pressable onPress={syncNow} style={[styles.button, { backgroundColor: theme.text, marginTop: 14 }]}>
            {syncStatus.state === 'syncing' ? (
              <ActivityIndicator color={theme.bg} />
            ) : (
              <Text style={{ color: theme.bg, fontWeight: '700' }}>Sync now</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          onPress={() =>
            Alert.alert('Sign out?', 'Your data stays on this device and in your account.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: signOut },
            ])
          }
          style={{ padding: 16, alignItems: 'center' }}
        >
          <Text style={{ color: theme.danger, fontWeight: '600' }}>Sign out</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: theme.text, fontSize: 24, fontWeight: '600' }}>
        {mode === 'signin' ? 'Sign in to TryChat' : 'Create your account'}
      </Text>
      <Text style={{ color: theme.muted, marginTop: 6, lineHeight: 20 }}>
        Your memory, chats and skills follow your account to every device you sign in on.
      </Text>

      <View style={[styles.segment, { backgroundColor: theme.surface }]}>
        {(['signin', 'signup'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[styles.segmentItem, mode === m && { backgroundColor: theme.bg }]}
            accessibilityState={{ selected: mode === m }}
          >
            <Text style={{ color: mode === m ? theme.text : theme.muted, fontWeight: '600' }}>
              {m === 'signin' ? 'Sign in' : 'Sign up'}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === 'signup' && (
        <>
          <Text style={[styles.label, { color: theme.muted }]}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={theme.muted} style={input} />
        </>
      )}
      <Text style={[styles.label, { color: theme.muted }]}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        style={input}
      />
      <Text style={[styles.label, { color: theme.muted }]}>Password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder={mode === 'signup' ? 'At least 8 characters' : 'Password'}
        placeholderTextColor={theme.muted}
        secureTextEntry
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        style={input}
      />
      <Text style={[styles.label, { color: theme.muted }]}>Account server</Text>
      <TextInput
        value={server}
        onChangeText={setServer}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={input}
      />
      <Text style={{ color: theme.muted, fontSize: 12, marginTop: 6 }}>
        Runs server/trychat-server.mjs from this project. Use https:// in production.
      </Text>

      {!!error && <Text style={{ color: theme.danger, marginTop: 12 }}>{error}</Text>}

      <Pressable
        onPress={submit}
        disabled={working || !email || !password}
        style={[styles.button, { backgroundColor: email && password ? theme.text : theme.border, marginTop: 20 }]}
      >
        {working ? (
          <ActivityIndicator color={theme.bg} />
        ) : (
          <Text style={{ color: theme.bg, fontWeight: '700' }}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 18, marginBottom: 16, alignItems: 'center' },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: 999, padding: 3, marginTop: 20 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999 },
  label: { fontSize: 13, marginTop: 14, marginBottom: 6 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, minHeight: 44 },
  button: { minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
