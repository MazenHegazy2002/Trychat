import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listFriends, shareFile } from '../lib/social';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { Attachment, Friend } from '../lib/types';
import { Icon, PillButton } from './ui';

/** Bottom sheet to send files to one or more friends. */
export function ShareToFriendSheet({ visible, files, onClose }: { visible: boolean; files: Attachment[]; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Mounted only while open, so every opening starts fresh. */}
      {visible && <SheetBody files={files} onClose={onClose} />}
    </Modal>
  );
}

function SheetBody({ files, onClose }: { files: Attachment[]; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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

  let content;
  if (!account) {
    content = (
      <View style={styles.empty}>
        <Text style={{ color: theme.muted, fontSize: 14, textAlign: 'center' }}>Sign in to your account to send files to friends.</Text>
        <PillButton title="Sign in" onPress={() => go('/account')} style={{ marginTop: 14 }} />
      </View>
    );
  } else if (loadError) {
    content = <Text style={{ color: theme.danger, padding: 20 }}>{loadError}</Text>;
  } else if (!friends) {
    content = <ActivityIndicator color={theme.primary} style={{ padding: 24 }} />;
  } else if (!friends.length) {
    content = (
      <View style={styles.empty}>
        <Text style={{ color: theme.muted, fontSize: 14, textAlign: 'center' }}>No friends yet. Add someone by their account email first.</Text>
        <PillButton title="Add friends" icon="user-plus" onPress={() => go('/friends')} style={{ marginTop: 14 }} />
      </View>
    );
  } else {
    content = (
      <>
        <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
          {friends.map((f) => {
            const on = selected.has(f.id);
            return (
              <Pressable
                key={f.id}
                onPress={() => toggle(f.id)}
                disabled={sending}
                style={[styles.row, on && { backgroundColor: theme.surface2 }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <View style={[styles.avatar, { backgroundColor: theme.oat }]}>
                  <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 15 }}>{(f.name || f.email)[0]?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 15 }} numberOfLines={1}>
                    {f.name || f.email}
                  </Text>
                  <Text style={{ color: theme.faint, fontSize: 12 }} numberOfLines={1}>
                    {f.email}
                  </Text>
                </View>
                <View style={[styles.check, { borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accent : 'transparent' }]}>
                  {on && <Icon name="check" size={14} color="#FFFFFF" />}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note (optional)"
          placeholderTextColor={theme.faint}
          maxLength={500}
          editable={!sending}
          style={[styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
        />
        {files.map((f) => {
          const err = errors[f.id];
          const p = progress[f.id];
          const state = done.includes(f.id) ? 'Sent' : err ? '' : sending && p !== undefined ? `${Math.round(p * 100)}%` : '';
          return (
            <View key={f.id} style={styles.fileRow}>
              <Icon name={done.includes(f.id) ? 'check-circle' : err ? 'alert-circle' : 'file'} size={16} color={err ? theme.danger : done.includes(f.id) ? theme.accent : theme.muted} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 13 }} numberOfLines={1}>
                  {f.name}
                </Text>
                {!!err && <Text style={{ color: theme.danger, fontSize: 12 }}>{err}</Text>}
                {sending && p !== undefined && !done.includes(f.id) && (
                  <View style={[styles.bar, { backgroundColor: theme.surface2 }]}>
                    <View style={{ width: `${Math.round(p * 100)}%`, height: '100%', backgroundColor: theme.accent }} />
                  </View>
                )}
              </View>
              <Text style={{ color: theme.faint, fontSize: 12 }}>{state}</Text>
            </View>
          );
        })}
        <PillButton
          title={allDone ? 'Sent' : Object.keys(errors).length ? 'Try again' : names.length ? `Send to ${names.length === 1 ? names[0] : `${names.length} friends`}` : 'Choose friends'}
          icon={allDone ? 'check' : 'send'}
          onPress={allDone ? onClose : send}
          loading={sending}
          disabled={!selected.size}
          style={{ marginHorizontal: 20, marginTop: 12 }}
        />
      </>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Pressable style={styles.scrim} onPress={sending ? undefined : onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: theme.bg, paddingBottom: insets.bottom + 12 }]}>
        <View style={[styles.grabber, { backgroundColor: theme.oat }]} />
        <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 22, paddingHorizontal: 20 }}>Send to friends</Text>
        <Text style={{ color: theme.muted, fontSize: 13, paddingHorizontal: 20, marginTop: 2, marginBottom: 8 }} numberOfLines={1}>
          {files.length === 1 ? files[0].name : `${files.length} files`}
        </Text>
        {content}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(20,20,19,0.4)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, maxHeight: '85%' },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
  empty: { padding: 20, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, marginHorizontal: 8, paddingHorizontal: 12, borderRadius: 12 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, minHeight: 44, marginHorizontal: 20, marginTop: 10 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginTop: 10 },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
});
