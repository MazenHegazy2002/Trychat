import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { CodeView } from '../../components/CodeView';
import { KeyboardPadded } from '../../components/KeyboardPadded';
import { Banner, IconButton, StatusBadge } from '../../components/ui';
import { useStore } from '../../lib/store';
import { FONT, TYPE, useTheme } from '../../lib/theme';
import { titleOf, wsRead, wsWrite } from '../../lib/workspace/backends';
import { useWorkspace } from '../../lib/workspace/store';
import { Text, TextInput } from '../../components/Text';

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

  const saveLabel = ws.kind === 'github' ? 'Stage' : 'Save';
  return (
    <KeyboardPadded style={{ backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          title: titleOf(path),
          headerRight: () =>
            text === null ? null : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {editing && <IconButton name="x" label="Cancel" onPress={() => (setDraft(text), setEditing(false))} />}
                {saving ? (
                  <View style={{ width: 44, alignItems: 'center' }} accessibilityLabel="Saving…">
                    <ActivityIndicator color={theme.inkMuted} />
                  </View>
                ) : editing ? (
                  <IconButton name="check" label={saveLabel} onPress={save} disabled={!dirty} color={dirty ? theme.accent : undefined} />
                ) : (
                  <IconButton name="edit-2" label="Edit" onPress={() => setEditing(true)} />
                )}
              </View>
            ),
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
        <Text style={{ flex: 1, color: theme.inkFaint, fontFamily: FONT.mono, fontSize: 12, lineHeight: 16 }} numberOfLines={1} ellipsizeMode="head">
          {path}
        </Text>
        {!!ws.changes[path] && <StatusBadge tone="warning">Staged</StatusBadge>}
      </View>
      {error ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Banner tone="danger" title="Couldn’t open this file">
            {error}
          </Banner>
        </View>
      ) : text === null ? (
        <ActivityIndicator color={theme.inkMuted} style={{ marginTop: 32 }} />
      ) : editing ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical="top"
          accessibilityLabel={`Edit ${titleOf(path)}`}
          style={[TYPE.code, { flex: 1, backgroundColor: theme.codeBg, color: theme.codeInk, paddingHorizontal: 16, paddingVertical: 12 }]}
        />
      ) : (
        <View style={{ flex: 1, backgroundColor: theme.codeBg }}>
          <CodeView text={text} path={path} />
        </View>
      )}
    </KeyboardPadded>
  );
}
