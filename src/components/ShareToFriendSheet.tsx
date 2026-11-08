import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { listFriends, shareFile } from '../lib/social';
import { useStore } from '../lib/store';
import { RADIUS, TYPE, useTheme } from '../lib/theme';
import type { Attachment, Friend } from '../lib/types';
import { Sheet, SheetActions, useWideSheet } from './TextPrompt';
import { Banner, EmptyState, Icon, PillButton, TextField } from './ui';
import { Text } from './Text';

/** Bottom sheet to send files to one or more friends. */
export function ShareToFriendSheet({ visible, files, onClose }: { visible: boolean; files: Attachment[]; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {/* Mounted only while open, so every opening starts fresh. */}
      {visible && <SheetBody files={files} onClose={onClose} />}
    </Modal>
  );
}

function SheetBody({ files, onClose }: { files: Attachment[]; onClose: () => void }) {
  const theme = useTheme();
  const { account } = useStore();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    if (!account) return;
    listFriends(account)
      .then((list) => setFriends(list.filter((f) => f.status === 'friends')))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [account]);

  const go = (href: '/account' | '/friends') => {
    onClose();
    router.push(href);
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = async () => {
    if (!account || !selected.size) return;
    setSending(true);
    setErrors({});
    const failed: Record<string, string> = {};
    for (const f of files.filter((x) => !done.includes(x.id))) {
      try {
        await shareFile(account, f, [...selected], note.trim() || undefined, (p) => setProgress((cur) => ({ ...cur, [f.id]: p })));
        setDone((d) => [...d, f.id]);
      } catch (e) {
        failed[f.id] = e instanceof Error ? e.message : String(e);
      }
    }
    setErrors(failed);
    setSending(false);
    if (!Object.keys(failed).length) setTimeout(onClose, 900);
  };

  const allDone = files.length > 0 && files.every((f) => done.includes(f.id));
  const names = (friends ?? []).filter((f) => selected.has(f.id)).map((f) => f.name || f.email);

  const wide = useWideSheet();
  const size = wide ? 'md' : 'lg';
  const primaryTitle = allDone ? 'Sent' : Object.keys(errors).length ? 'Try again' : names.length ? `Send to ${names.length === 1 ? names[0] : `${names.length} friends`}` : 'Choose friends';

  let content;
  if (!account) {
    content = (
      <EmptyState icon="users" title="Sign in to send files" action={<PillButton title="Sign in" onPress={() => go('/account')} />} style={styles.empty}>
        Sign in to your account to send files to friends.
      </EmptyState>
    );
  } else if (loadError) {
    content = (
      <Banner tone="danger" title="Couldn’t load your friends" style={{ borderWidth: 1, borderColor: theme.danger }}>
        {loadError}
      </Banner>
    );
  } else if (!friends) {
    content = <ActivityIndicator color={theme.inkMuted} style={{ padding: 24 }} />;
  } else if (!friends.length) {
    content = (
      <EmptyState icon="user-plus" title="No friends yet" action={<PillButton title="Add friends" icon="user-plus" onPress={() => go('/friends')} />} style={styles.empty}>
        Add someone by their account email first.
      </EmptyState>
    );
  } else {
    content = (
      <>
        <ScrollView style={{ maxHeight: 260, flexGrow: 0 }} keyboardShouldPersistTaps="handled">
          {friends.map((f) => {
            const on = selected.has(f.id);
            return (
              <Pressable
                key={f.id}
                onPress={() => toggle(f.id)}
                disabled={sending}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.row,
                  { backgroundColor: on ? theme.accentSoft : pressed || hovered ? theme.fill : 'transparent' },
                ]}
                accessibilityRole="checkbox"
                accessibilityLabel={f.name || f.email}
                accessibilityState={{ checked: on, disabled: sending }}
              >
                <View style={[styles.avatar, { backgroundColor: theme.fill }]}>
                  <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>{(f.name || f.email)[0]?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[TYPE.callout, { color: theme.ink }, on && { fontWeight: '600' }]} numberOfLines={1}>
                    {f.name || f.email}
                  </Text>
                  <Text style={[TYPE.caption, { color: theme.inkMuted }]} numberOfLines={1}>
                    {f.email}
                  </Text>
                </View>
                <View style={[styles.check, { borderColor: on ? theme.accent : theme.borderStrong, backgroundColor: on ? theme.accent : 'transparent' }]}>
                  {on && <Icon name="check" size={14} color={theme.onAccent} />}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <TextField
          value={note}
          onChangeText={setNote}
          placeholder="Add a note (optional)"
          accessibilityLabel="Note"
          maxLength={500}
          editable={!sending}
          style={{ marginTop: 12 }}
        />
        {files.map((f) => {
          const err = errors[f.id];
          const p = progress[f.id];
          const sent = done.includes(f.id);
          const state = sent ? 'Sent' : err ? 'Failed' : sending && p !== undefined ? `${Math.round(p * 100)}%` : '';
          return (
            <View key={f.id} style={styles.fileRow}>
              <Icon name={sent ? 'check-circle' : err ? 'alert-circle' : 'file'} size={16} color={err ? theme.danger : sent ? theme.success : theme.inkMuted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[TYPE.caption, { color: theme.ink }]} numberOfLines={1}>
                  {f.name}
                </Text>
                {!!err && <Text style={[TYPE.caption, { color: theme.danger }]}>{err}</Text>}
                {sending && p !== undefined && !sent && (
                  <View style={[styles.bar, { backgroundColor: theme.fill }]}>
                    <View style={{ width: `${Math.round(p * 100)}%`, height: '100%', backgroundColor: theme.accent }} />
                  </View>
                )}
              </View>
              <Text style={[TYPE.codeLabel, { color: sent ? theme.success : err ? theme.danger : theme.inkFaint }]}>{state}</Text>
            </View>
          );
        })}
        <SheetActions>
          <PillButton title="Cancel" variant="secondary" size={size} onPress={onClose} disabled={sending} />
          <PillButton
            title={primaryTitle}
            icon={allDone ? 'check' : 'send'}
            size={size}
            onPress={allDone ? onClose : send}
            loading={sending}
            disabled={!selected.size}
            style={!wide && { flex: 1 }}
          />
        </SheetActions>
      </>
    );
  }

  return (
    <Sheet title="Send to friends" subtitle={files.length === 1 ? files[0].name : `${files.length} files`} onClose={sending ? undefined : onClose} keyboard>
      {content}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12, borderRadius: RADIUS.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, marginTop: 12 },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
});
