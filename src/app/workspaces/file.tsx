import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { CodeView, codeFont } from '../../components/CodeView';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import { titleOf, wsRead, wsWrite } from '../../lib/workspace/backends';
import { useWorkspace } from '../../lib/workspace/store';

export default function WorkspaceFileScreen() {
  const theme = useTheme();
  const { id, path } = useLocalSearchParams<{ id: string; path: string }>();
  const ws = useWorkspace(id);
  const { settings } = useStore();
  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ws) return;
    wsRead(settings, ws, path)
      .then((t) => {
        setText(t);
        setDraft(t);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, path]);

  if (!ws) return null;
  const dirty = editing && draft !== text;

  const save = () => {
    const go = async () => {
      setSaving(true);
      try {
        await wsWrite(settings, ws, path, draft);
        setText(draft);
        setEditing(false);
      } catch (e) {
        Alert.alert('Couldn’t save', e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    };
    if (ws.kind === 'github') go();
    else Alert.alert(`Save ${titleOf(path)}?`, `This overwrites the file in the ${ws.kind} folder.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: go }]);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          title: titleOf(path),
          headerRight: () =>
            text === null ? null : (
              <View style={{ flexDirection: 'row', gap: 18 }}>
                {editing && (
                  <Pressable onPress={() => (setDraft(text), setEditing(false))} hitSlop={8}>
                    <Text style={{ color: theme.muted, fontSize: 15 }}>Cancel</Text>
                  </Pressable>
                )}
                <Pressable onPress={editing ? save : () => setEditing(true)} disabled={saving || (editing && !dirty)} hitSlop={8}>
                  <Text style={{ color: editing && !dirty ? theme.faint : theme.primary, fontSize: 15, fontWeight: '600' }}>
                    {saving ? 'Saving…' : editing ? (ws.kind === 'github' ? 'Stage' : 'Save') : 'Edit'}
                  </Text>
                </Pressable>
              </View>
            ),
        }}
      />
      <Text style={{ color: theme.faint, fontSize: 12, paddingHorizontal: 12, paddingVertical: 6 }} numberOfLines={1}>
        {path}
        {ws.changes[path] ? ' · staged' : ''}
      </Text>
      {error ? (
        <Text style={{ color: theme.danger, padding: 16 }}>{error}</Text>
      ) : text === null ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : editing ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical="top"
          style={{ flex: 1, backgroundColor: '#1F1E1D', color: '#E8E6DC', fontFamily: codeFont, fontSize: 13, lineHeight: 19, padding: 12 }}
        />
      ) : (
        <CodeView text={text} path={path} />
      )}
    </KeyboardAvoidingView>
  );
}
