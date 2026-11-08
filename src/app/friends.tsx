import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { FileCards } from '../components/FileCards';
import { ShareToFriendSheet } from '../components/ShareToFriendSheet';
import { Banner, Card, Divider, EmptyState, Icon, IconButton, IconTile, PillButton, ScreenIntro, SectionLabel, SegmentedControl, TextAction, TextField } from '../components/ui';
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
import { RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, useTheme } from '../lib/theme';
import type { Account, Attachment, Friend, SharedFile } from '../lib/types';
import { Text } from '../components/Text';

function timeAgo(ts?: number) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const iconFor = (mime: string): IconName =>
  mime.startsWith('image/')
    ? 'image'
    : mime === 'text/html'
      ? 'globe'
      : /spreadsheet|ms-excel|text\/csv/.test(mime)
        ? 'grid'
        : /presentation|powerpoint/.test(mime)
          ? 'monitor'
          : mime === 'application/pdf' || mime.startsWith('text/') || /wordprocessing|msword/.test(mime)
            ? 'file-text'
            : 'file';

/** Phones: 16px gutter. From 900px: a centred 760px column. */
function usePage() {
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;
  return [styles.page, wide && styles.pageWide];
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function FriendsScreen() {
  const { account } = useStore();
  return account ? <SignedIn account={account} /> : <SignedOut />;
}

function SignedOut() {
  const theme = useTheme();
  const page = usePage();
  return (
    <KeyboardAwareScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={page} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <ScreenIntro title="Friends">Send files to friends who have an account on your TryChat server.</ScreenIntro>
      <Card>
        <EmptyState icon="users" title="Sign in to add friends" action={<PillButton title="Sign in" onPress={() => router.push('/account')} />}>
          Friends and shared files live in your account, so they follow you to every device.
        </EmptyState>
      </Card>
    </KeyboardAwareScrollView>
  );
}

/** A circle on `fill` with the person's initial. */
function Avatar({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.avatar, { backgroundColor: theme.fill }]}>
      <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>{label[0]?.toUpperCase()}</Text>
    </View>
  );
}

/** A person in a list: avatar, name, a detail line and trailing actions. */
function PersonRow({ label, title, detail, children }: { label: string; title: string; detail: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Avatar label={label} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[TYPE.callout, { color: theme.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[TYPE.caption, { color: theme.inkMuted }]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {children}
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
  const page = usePage();

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={page}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.inkMuted} colors={[theme.inkMuted]} progressBackgroundColor={theme.surfaceRaised} />
      }
      keyboardDismissMode="interactive"
    >
      <ScreenIntro title="Friends">Send files to friends who have an account on {account.serverUrl.replace(/^https?:\/\//, '')}.</ScreenIntro>
      {!!error && (
        <Banner tone="danger" title="Couldn’t load your friends" style={{ borderWidth: 1, borderColor: theme.danger }}>
          {error} Pull down to try again.
        </Banner>
      )}

      {incoming.length > 0 && (
        <>
          <SectionLabel>Requests</SectionLabel>
          <Card>
            {incoming.map((f, i) => (
              <View key={f.id}>
                {i > 0 && <Divider inset={64} />}
                <PersonRow label={f.name || f.email} title={f.name || f.email} detail={`${f.email} · ${timeAgo(f.since)}`}>
                  <TextAction title="Decline" tone="ink" onPress={() => act(() => declineFriend(account, f.id))} />
                  <TextAction title="Accept" onPress={() => act(() => acceptFriend(account, f.id))} />
                </PersonRow>
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionLabel>{`Friends${accepted.length ? ` · ${accepted.length}` : ''}`}</SectionLabel>
      <Card>
        {accepted.map((f, i) => (
          <View key={f.id}>
            {i > 0 && <Divider inset={64} />}
            <PersonRow label={f.name || f.email} title={f.name || f.email} detail={f.email}>
              <IconButton name="user-x" label={`Remove ${f.name || f.email}`} onPress={() => confirmRemove(f)} />
            </PersonRow>
          </View>
        ))}
        {outgoing.map((f, i) => (
          <View key={f.id}>
            {(i > 0 || accepted.length > 0) && <Divider inset={64} />}
            <PersonRow label={f.email} title={f.email} detail={`Request sent ${timeAgo(f.since)}`}>
              <TextAction title="Cancel" tone="ink" onPress={() => act(() => declineFriend(account, f.id))} />
            </PersonRow>
          </View>
        ))}
        {loaded && !accepted.length && !outgoing.length && (
          <Text style={[TYPE.callout, { color: theme.inkMuted, padding: 16 }]}>No friends yet. Add someone by the email they signed up with.</Text>
        )}
        <Divider />
        <View style={{ padding: 16, gap: 8 }}>
          <Text style={{ color: theme.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: '500' }}>Add a friend</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextField
              value={email}
              onChangeText={setEmail}
              placeholder="friend@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onSubmitEditing={add}
              style={{ flex: 1 }}
              accessibilityLabel="Friend's email"
            />
            <PillButton title="Add" icon="user-plus" onPress={add} loading={adding} disabled={!email.trim()} style={{ minHeight: 48 }} />
          </View>
          {!!addInfo && <Text style={[TYPE.caption, { color: theme.inkMuted }]}>{addInfo}</Text>}
        </View>
      </Card>

      <SectionLabel>Shared files</SectionLabel>
      <SegmentedControl
        label="Shared files"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'received', label: `Shared with me · ${shared.received.length}` },
          { value: 'sent', label: `Shared by me · ${shared.sent.length}` },
        ]}
        style={{ marginBottom: 12 }}
      />

      {accepted.length > 0 && <PillButton title="Send a file" icon="send" variant="secondary" onPress={sendFiles} style={{ marginBottom: 12 }} />}

      {loaded && !files.length && (
        <EmptyState icon={tab === 'received' ? 'inbox' : 'send'} title={tab === 'received' ? 'Nothing yet' : 'You haven’t shared anything yet'} style={{ paddingVertical: 24 }}>
          {tab === 'received' ? 'Files friends send you show up here.' : undefined}
        </EmptyState>
      )}

      <View style={{ gap: 8 }}>
        {files.map((file) => {
          const local = downloads[file.id];
          const p = progress[file.id];
          return (
            <View key={file.id} style={[styles.file, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconTile name={iconFor(file.mimeType)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '500' }]} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <Text style={[TYPE.codeLabel, { color: theme.inkFaint, marginTop: 2 }]} numberOfLines={1}>
                    {tab === 'received' ? `From ${file.owner.name || file.owner.email} · ` : ''}
                    {formatSize(file.size)} · {timeAgo(file.sharedAt ?? file.createdAt)}
                  </Text>
                </View>
              </View>
              {!!file.note && (
                <View style={[styles.note, { backgroundColor: theme.fill }]}>
                  <Text style={[TYPE.callout, { color: theme.ink }]}>“{file.note}”</Text>
                </View>
              )}

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
                        <Text style={[TYPE.caption, { color: theme.inkMuted }]}>Downloading… {Math.round(p * 100)}%</Text>
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
                        hitSlop={{ top: 6, bottom: 6 }}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.chip,
                          { backgroundColor: theme.fill, borderColor: pressed || hovered ? theme.borderStrong : theme.fill },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Stop sharing with ${r.name || r.email}`}
                      >
                        <Text style={[TYPE.caption, { color: theme.ink }]}>{r.name || r.email}</Text>
                        <Icon name="x" size={14} />
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.actions}>
                    <TextAction title="Delete" tone="danger" onPress={() => confirmDelete(file)} />
                  </View>
                </>
              )}
            </View>
          );
        })}
      </View>

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
  page: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },
  pageWide: { width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 8, paddingVertical: 8, minHeight: 60 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  file: { borderWidth: 1, borderRadius: RADIUS.md, padding: 12 },
  note: { marginTop: 10, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 20, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: 12 },
});
