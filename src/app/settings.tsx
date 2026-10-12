import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { ModelPicker } from '../components/ModelPicker';
import { listModels } from '../lib/api';
import { DEFAULT_SETTINGS } from '../lib/storage';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { Settings } from '../lib/types';

export default function SettingsScreen() {
  const theme = useTheme();
  const { settings, updateSettings, clearConversations } = useStore();
  const [draft, setDraft] = useState<Settings>(settings);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    updateSettings({ [key]: value });
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const models = await listModels(draft);
      setTestResult({ ok: true, text: `Connected — ${models.length} model(s) available.` });
      if (!draft.model && models.length) set('model', models[0]);
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const label = (text: string) => <Text style={[styles.label, { color: theme.muted }]}>{text}</Text>;
  const inputStyle = [styles.input, { backgroundColor: theme.surface, color: theme.text }];

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={[styles.section, { color: theme.text }]}>Server</Text>
      {label('Base URL')}
      <TextInput
        value={draft.baseUrl}
        onChangeText={(v) => set('baseUrl', v.trim())}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://host:port/v1"
        placeholderTextColor={theme.muted}
        style={inputStyle}
      />
      {label('API key (stored securely on this device)')}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TextInput
          value={draft.apiKey}
          onChangeText={(v) => set('apiKey', v.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!showKey}
          placeholder="sk-…"
          placeholderTextColor={theme.muted}
          style={[inputStyle, { flex: 1 }]}
        />
        <Pressable onPress={() => setShowKey((s) => !s)} hitSlop={8}>
          <Text style={{ color: theme.primary, fontWeight: '600' }}>{showKey ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
      <Pressable onPress={test} style={[styles.button, { backgroundColor: theme.primary }]} disabled={testing}>
        {testing ? (
          <ActivityIndicator color={theme.onPrimary} />
        ) : (
          <Text style={{ color: theme.onPrimary, fontWeight: '700' }}>Test connection</Text>
        )}
      </Pressable>
      {testResult && (
        <Text style={{ color: testResult.ok ? theme.text : theme.danger, marginTop: 8 }}>{testResult.text}</Text>
      )}

      <Text style={[styles.section, { color: theme.text }]}>Model</Text>
      {label('Default model for new chats')}
      <Pressable onPress={() => setPickerOpen(true)} style={[inputStyle, { justifyContent: 'center' }]}>
        <Text style={{ color: draft.model ? theme.text : theme.muted, fontSize: 15 }}>
          {draft.model || 'Tap to choose a model'}
        </Text>
      </Pressable>
      {label(`Temperature: ${draft.temperature.toFixed(1)}`)}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {[0, 0.3, 0.7, 1, 1.3].map((t) => (
          <Pressable
            key={t}
            onPress={() => set('temperature', t)}
            style={[
              styles.chip,
              { borderColor: theme.border, backgroundColor: draft.temperature === t ? theme.primary : 'transparent' },
            ]}
          >
            <Text style={{ color: draft.temperature === t ? theme.onPrimary : theme.text }}>{t}</Text>
          </Pressable>
        ))}
      </View>
      {label(`Messages of history sent per request: ${draft.contextMessages}`)}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {[10, 20, 40, 80, 200].map((n) => (
          <Pressable
            key={n}
            onPress={() => set('contextMessages', n)}
            style={[
              styles.chip,
              { borderColor: theme.border, backgroundColor: draft.contextMessages === n ? theme.primary : 'transparent' },
            ]}
          >
            <Text style={{ color: draft.contextMessages === n ? theme.onPrimary : theme.text }}>{n}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.section, { color: theme.text }]}>Behavior</Text>
      {label('System prompt')}
      <TextInput
        value={draft.systemPrompt}
        onChangeText={(v) => set('systemPrompt', v)}
        multiline
        style={[inputStyle, { minHeight: 100, textAlignVertical: 'top' }]}
      />
      <Pressable onPress={() => set('systemPrompt', DEFAULT_SETTINGS.systemPrompt)}>
        <Text style={{ color: theme.primary, marginTop: 6 }}>Reset system prompt</Text>
      </Pressable>

      {(
        [
          ['builderMode', 'Builder mode', 'Ask the model for complete, runnable apps you can preview in-app'],
          ['memoryEnabled', 'Long-term memory', 'The model remembers facts about you across chats'],
          ['stream', 'Stream responses', 'Show text as it is generated (turn off if your server does not support it)'],
        ] as const
      ).map(([key, title, desc]) => (
        <View key={key} style={[styles.switchRow, { borderBottomColor: theme.border }]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: theme.text, fontSize: 16 }}>{title}</Text>
            <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>{desc}</Text>
          </View>
          <Switch value={draft[key]} onValueChange={(v) => set(key, v)} />
        </View>
      ))}

      <Text style={[styles.section, { color: theme.text }]}>Data</Text>
      <Pressable
        onPress={() =>
          Alert.alert('Delete all chats?', 'This cannot be undone. Memories are kept.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: clearConversations },
          ])
        }
      >
        <Text style={{ color: theme.danger, fontSize: 16 }}>Delete all chats</Text>
      </Pressable>

      <ModelPicker
        visible={pickerOpen}
        selected={draft.model}
        onSelect={(m) => set('model', m)}
        onClose={() => setPickerOpen(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 20, fontWeight: '700', marginTop: 24, marginBottom: 4 },
  label: { fontSize: 13, marginTop: 14, marginBottom: 6 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, minHeight: 44 },
  button: { marginTop: 14, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
});
