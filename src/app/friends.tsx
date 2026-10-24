import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { FileCards } from '../components/FileCards';
import { ShareToFriendSheet } from '../components/ShareToFriendSheet';
import { Card, Divider, Icon, IconTile, PillButton, ScreenIntro, SectionLabel, TextAction } from '../components/ui';
import type { IconName } from '../components/ui';
import { formatSize, pickFiles } from '../lib/attachments';
import {
  acceptFriend,
  declineFriend,
  deleteSharedFile,
  downloadShared,
  listFriends,
  listShared,
  localCopy,
  removeFriend,
  requestFriend,
  unshareFile,
} from '../lib/social';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { Account, Attachment, Friend, SharedFile } from '../lib/types';

function timeAgo(ts?: number) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const iconFor = (mime: string): IconName =>
  mime.startsWith('image/') ? 'image' : mime === 'application/pdf' || mime.startsWith('text/') ? 'file-text' : 'file';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function FriendsScreen() {
  const { account } = useStore();
  return account ? <SignedIn account={account} /> : <SignedOut />;
}

function SignedOut() {
  const theme = useTheme();
  return (
    <KeyboardAwareScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <ScreenIntro title="Friends">Send files to friends who have an account on your TryChat server.</ScreenIntro>
      <Card style={{ padding: 20, alignItems: 'center' }}>
        <IconTile name="users" size={44} />
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 12 }}>Sign in to add friends</Text>
        <Text style={{ color: theme.muted, fontSize: 13, textAlign: 'center', marginTop: 4 }}>
          Friends and shared files live in your account, so they follow you to every device.
        </Text>
        <PillButton title="Sign in" onPress={() => router.push('/account')} style={{ marginTop: 16, alignSelf: 'stretch' }} />
      </Card>
    </KeyboardAwareScrollView>
  );
}

function Avatar({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.avatar, { backgroundColor: theme.oat }]}>
      <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 16 }}>{label[0]?.toUpperCase()}</Text>
    </View>
  );
}

function SignedIn({ account }: { account: Account }) {
  const theme = useTheme();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [shared, setShared] = useState<{ received: SharedFile[]; sent: SharedFile[] }>({ received: [], sent: [] });
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [addInfo, setAddInfo] = useState('');
  const [tab, setTab] = useState<'received' | 'sent'>('received');
  const [downloads, setDownloads] = useState<Record<string, Attachment>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [toSend, setToSend] = useState<Attachment[]>([]);

  const load = useCallback(async () => {
    try {
      const [f, s] = await Promise.all([listFriends(account), listShared(account)]);
      setFriends(f);
      setShared(s);
      const local: Record<string, Attachment> = {};
      for (const file of s.received) {
        const copy = localCopy(file);
        if (copy) local[file.id] = copy;
      }
      setDownloads((d) => ({ ...local, ...d }));
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoaded(true);
    }
  }, [account]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  /** Runs a friends action that returns the new list. */
  const act = async (fn: () => Promise<Friend[]>) => {
    try {
      setFriends(await fn());
      setShared(await listShared(account));
    } catch (e) {
      Alert.alert('Something went wrong', errorText(e));
    }
  };

  const add = async () => {
    const value = email.trim();
    if (!value) return;
    setAdding(true);
    setAddInfo('');
    try {
      const list = await requestFriend(account, value);
      setFriends(list);
      const now = list.find((f) => f.email === value.toLowerCase());
      setAddInfo(
        now?.status === 'friends'
          ? `You and ${now.name || now.email} are now friends.`
          : `Request sent. If ${value} has an account on this server, they'll see it under Requests.`,
      );
      setEmail('');
    } catch (e) {
      setAddInfo(errorText(e));
    } finally {
      setAdding(false);
    }
  };

  const confirmRemove = (f: Friend) =>
    Alert.alert(`Remove ${f.name || f.email}?`, 'Files you shared with each other stop being shared.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => act(() => removeFriend(account, f.id)) },
    ]);

  const download = async (file: SharedFile) => {
    setProgress((p) => ({ ...p, [file.id]: 0 }));
    try {
      const a = await downloadShared(account, file, (x) => setProgress((p) => ({ ...p, [file.id]: x })));
      setDownloads((d) => ({ ...d, [file.id]: a }));
    } catch (e) {
      Alert.alert('Couldn’t download', errorText(e));
      load();
    } finally {
      setProgress(({ [file.id]: _done, ...rest }) => rest);
    }
  };

  const fileAction = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', errorText(e));
    }
    load();
  };

  const confirmDelete = (file: SharedFile) =>
    Alert.alert(`Delete “${file.name}”?`, 'It is removed from the server and friends can no longer download it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => fileAction(() => deleteSharedFile(account, file.id)) },
    ]);

  const sendFiles = async () => {
    try {
      const picked = await pickFiles();
      if (picked.length) setToSend(picked);
    } catch (e) {
      Alert.alert('Couldn’t add files', errorText(e));
    }
  };

  const accepted = friends.filter((f) => f.status === 'friends');
  const incoming = friends.filter((f) => f.status === 'incoming');
  const outgoing = friends.filter((f) => f.status === 'outgoing');
  const files = tab === 'received' ? shared.received : shared.sent;
  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }];

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.primary} colors={[theme.primary]} />}
      keyboardDismissMode="interactive"
    >
      <ScreenIntro title="Friends">Send files to friends who have an account on {account.serverUrl.replace(/^https?:\/\//, '')}.</ScreenIntro>
      {!!error && <Text style={{ color: theme.danger, marginBottom: 8 }}>{error}</Text>}

      {incoming.length > 0 && (
        <>
          <SectionLabel>Requests</SectionLabel>
          <Card>
            {incoming.map((f, i) => (
              <View key={f.id}>
                {i > 0 && <Divider />}
                <View style={styles.row}>
                  <Avatar label={f.name || f.email} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 15 }} numberOfLines={1}>
                      {f.name || f.email}
                    </Text>
                    <Text style={{ color: theme.faint, fontSize: 12 }} numberOfLines={1}>
                      {f.email} · {timeAgo(f.since)}
                    </Text>
                  </View>
                  <TextAction title="Decline" tone="ink" onPress={() => act(() => declineFriend(account, f.id))} />
                  <TextAction title="Accept" onPress={() => act(() => acceptFriend(account, f.id))} />
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionLabel>{`Friends${accepted.length ? ` · ${accepted.length}` : ''}`}</SectionLabel>
      <Card>
        {accepted.map((f, i) => (
          <View key={f.id}>
            {i > 0 && <Divider />}
            <View style={styles.row}>
              <Avatar label={f.name || f.email} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15 }} numberOfLines={1}>
                  {f.name || f.email}
                </Text>
                <Text style={{ color: theme.faint, fontSize: 12 }} numberOfLines={1}>
                  {f.email}
                </Text>
              </View>
              <Pressable onPress={() => confirmRemove(f)} style={styles.iconBtn} accessibilityLabel={`Remove ${f.name || f.email}`}>
                <Icon name="user-x" size={18} />
              </Pressable>
            </View>
          </View>
        ))}
        {outgoing.map((f, i) => (
          <View key={f.id}>
            {(i > 0 || accepted.length > 0) && <Divider />}
            <View style={styles.row}>
              <Avatar label={f.email} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15 }} numberOfLines={1}>
                  {f.email}
                </Text>
                <Text style={{ color: theme.faint, fontSize: 12 }}>Request sent {timeAgo(f.since)}</Text>
              </View>
              <TextAction title="Cancel" tone="ink" onPress={() => act(() => declineFriend(account, f.id))} />
            </View>
          </View>
        ))}
        {loaded && !accepted.length && !outgoing.length && (
          <Text style={{ color: theme.muted, fontSize: 13, padding: 16 }}>No friends yet. Add someone by the email they signed up with.</Text>
        )}
        <Divider />
        <View style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="friend@example.com"
              placeholderTextColor={theme.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onSubmitEditing={add}
              style={[input, { flex: 1 }]}
              accessibilityLabel="Friend's email"
            />
            <PillButton title="Add" icon="user-plus" onPress={add} loading={adding} disabled={!email.trim()} style={{ minHeight: 44 }} />
          </View>
          {!!addInfo && <Text style={{ color: theme.muted, fontSize: 12 }}>{addInfo}</Text>}
        </View>
      </Card>

      <View style={[styles.segment, { backgroundColor: theme.surface2 }]}>
        {(
          [
            ['received', `Shared with me · ${shared.received.length}`],
            ['sent', `Shared by me · ${shared.sent.length}`],
          ] as const
        ).map(([key, title]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={[styles.segmentItem, tab === key && { backgroundColor: theme.surface }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
          >
            <Text style={{ color: tab === key ? theme.text : theme.muted, fontWeight: '600', fontSize: 13 }}>{title}</Text>
          </Pressable>
        ))}
      </View>

      {accepted.length > 0 && (
        <PillButton title="Send a file" icon="send" variant="secondary" onPress={sendFiles} style={{ marginBottom: 12 }} />
      )}

      {loaded && !files.length && (
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          {tab === 'received' ? 'Nothing yet. Files friends send you show up here.' : 'You haven’t shared anything yet.'}
        </Text>
      )}

      {files.map((file) => {
        const local = downloads[file.id];
        const p = progress[file.id];
        return (
          <Card key={file.id} style={{ padding: 14, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconTile name={iconFor(file.mimeType)} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
                  {file.name}
                </Text>
                <Text style={{ color: theme.faint, fontSize: 12 }} numberOfLines={1}>
                  {tab === 'received' ? `From ${file.owner.name || file.owner.email} · ` : ''}
                  {formatSize(file.size)} · {timeAgo(file.sharedAt ?? file.createdAt)}
                </Text>
              </View>
            </View>
            {!!file.note && <Text style={{ color: theme.text, fontSize: 14, marginTop: 8 }}>“{file.note}”</Text>}

            {tab === 'received' ? (
              <>
                {local && (
                  <View style={{ marginTop: 10 }}>
                    <FileCards files={[local]} />
                  </View>
                )}
                <View style={styles.actions}>
                  {!local &&
                    (p !== undefined ? (
                      <Text style={{ color: theme.muted, fontSize: 13 }}>Downloading… {Math.round(p * 100)}%</Text>
                    ) : (
                      <TextAction title="Download" onPress={() => download(file)} />
                    ))}
                  <TextAction title="Remove" tone="ink" onPress={() => fileAction(() => unshareFile(account, file.id))} />
                </View>
              </>
            ) : (
              <>
                <View style={styles.chips}>
                  {(file.recipients ?? []).map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() =>
                        Alert.alert(`Stop sharing with ${r.name || r.email}?`, file.recipients?.length === 1 ? 'Nobody else has it, so it is deleted from the server.' : undefined, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Stop sharing', style: 'destructive', onPress: () => fileAction(() => unshareFile(account, file.id, [r.id])) },
                        ])
                      }
                      style={[styles.chip, { backgroundColor: theme.surface2 }]}
                      accessibilityLabel={`Stop sharing with ${r.name || r.email}`}
                    >
                      <Text style={{ color: theme.text, fontSize: 12 }}>{r.name || r.email}</Text>
                      <Icon name="x" size={12} />
                    </Pressable>
                  ))}
                </View>
                <View style={styles.actions}>
                  <TextAction title="Delete" tone="danger" onPress={() => confirmDelete(file)} />
                </View>
              </>
            )}
          </Card>
        );
      })}

      <ShareToFriendSheet
        visible={toSend.length > 0}
        files={toSend}
        onClose={() => {
          setToSend([]);
          load();
        }}
      />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 60 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, minHeight: 44 },
  segment: { flexDirection: 'row', borderRadius: 999, padding: 4, marginTop: 24, marginBottom: 12 },
  segmentItem: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
});
