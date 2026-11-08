import Constants from 'expo-constants';
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { ModelPicker } from '../components/ModelPicker';
import { Text } from '../components/Text';
import {
  Banner,
  Card,
  ClaySwitch,
  Divider,
  Icon,
  ListRow,
  PillButton,
  SectionLabel,
  SegmentedControl,
  TextAction,
  TextField,
} from '../components/ui';
import type { IconName } from '../components/ui';
import { listModels } from '../lib/api';
import { setBackgroundEnabled, subscribeBackgroundEnabled } from '../lib/background';
import { DEFAULT_SETTINGS } from '../lib/storage';
import { useStore } from '../lib/store';
import { githubConnected, laptopConnected } from '../lib/tools';
import { FONT, RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, setAppearance, useAppearance, useTheme } from '../lib/theme';
import type { Settings } from '../lib/types';

const FEATURES = [
  ['builderMode', 'Builder mode', 'Ask the model for complete, runnable apps you can preview in-app'],
  ['memoryEnabled', 'Long-term memory', 'The model remembers facts about you across chats'],
  ['subAgents', 'Sub-agents', 'Let TryChat send helper agents to work on parts of a task in parallel'],
  ['codeExecution', 'Run code', 'Let TryChat run JavaScript and Python on your phone to calculate and test'],
  ['webAccess', 'Web access', 'Let TryChat search the web and read pages and APIs'],
  ['stream', 'Stream responses', 'Show text as it is generated (turn off if your server does not support it)'],
] as const;

const APPEARANCE = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
] as const;

const TEMPERATURES = [0, 0.3, 0.7, 1, 1.3].map((t) => ({ value: String(t), label: String(t) }));
const HISTORY = [10, 20, 40, 80, 200].map((n) => ({ value: String(n), label: String(n) }));

interface NavRow {
  href: Href;
  icon: IconName;
  title: string;
  subtitle: string;
  hint?: string;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const appearance = useAppearance();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const { settings, updateSettings, clearConversations, account, skills, mcpServers, mcpTools, plugins } = useStore();
  const [draft, setDraft] = useState<Settings>(settings);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [background, setBackground] = useState(true);
  useEffect(() => subscribeBackgroundEnabled(setBackground), []);

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
      setTestResult({ ok: true, text: `${models.length} model${models.length === 1 ? '' : 's'} found.` });
      if (!draft.model && models.length) set('model', models[0]);
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const gh = githubConnected(settings);
  const lap = laptopConnected(settings);
  const toolCount = Object.values(mcpTools).flat().length;

  const connectionRows: NavRow[] = [
    {
      href: '/connections',
      icon: 'github',
      title: 'GitHub & laptop',
      subtitle: `GitHub: ${gh ? 'connected' : 'not connected'} · Laptop: ${lap ? 'connected' : 'not connected'}`,
      hint: `GitHub ${gh ? 'connected' : 'not connected'}, laptop ${lap ? 'connected' : 'not connected'}`,
    },
    { href: '/skills', icon: 'zap', title: 'Skills', subtitle: `${skills.filter((k) => k.enabled).length} enabled` },
    {
      href: '/mcp',
      icon: 'server',
      title: 'MCP servers',
      subtitle: mcpServers.length
        ? `${mcpServers.length} server${mcpServers.length === 1 ? '' : 's'} · ${toolCount} tools`
        : 'Add tools from MCP servers',
    },
    { href: '/store', icon: 'package', title: 'Store', subtitle: 'Browse plugins, skills and MCP servers' },
    {
      href: '/plugins',
      icon: 'layers',
      title: 'Plugins',
      subtitle: plugins.length
        ? `${plugins.length} installed · ${plugins.filter((p) => p.enabled).length} enabled`
        : 'Add skills, commands, agents and tools in one install',
    },
  ];

  const workRows: NavRow[] = [
    { href: '/workspaces', icon: 'code', title: 'Workspaces', subtitle: 'Edit GitHub repos and folders; let the assistant work in them' },
    { href: '/designs', icon: 'pen-tool', title: 'Design', subtitle: 'Design app screens and pages on a canvas with Claude' },
    { href: '/tasks', icon: 'terminal', title: 'Tasks & terminal', subtitle: 'Running and recent replies, tools and laptop commands' },
    { href: '/files', icon: 'file', title: 'Files', subtitle: 'Everything sent, received and shared in chats' },
    { href: '/friends', icon: 'users', title: 'Friends', subtitle: 'Share files with friends who have an account' },
  ];

  const group = (rows: NavRow[]) => (
    <Card>
      {rows.map((r, i) => (
        <Fragment key={r.title}>
          {i > 0 && <Divider inset={44} />}
          <ListRow
            icon={r.icon}
            title={r.title}
            subtitle={r.subtitle}
            chevron
            onPress={() => router.push(r.href)}
            accessibilityHint={r.hint}
          />
        </Fragment>
      ))}
    </Card>
  );

  const accountTitle = account ? account.user.name || account.user.email : 'Sign in or create an account';
  const accountSub = account ? `${account.user.email} · memory synced` : 'Keep your memory and chats on every device';
  const version = Constants.expoConfig?.version;

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[styles.page, { paddingHorizontal: wide ? 24 : 16, paddingTop: wide ? 24 : 16 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Account first: tests tap the top of the screen to open it. */}
      <Pressable
        onPress={() => router.push('/account')}
        accessibilityRole="button"
        accessibilityLabel={accountTitle}
        accessibilityHint={accountSub}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.accountCard,
          { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={[styles.avatar, { backgroundColor: account ? theme.accentSoft : theme.fill }]}>
          {account ? (
            <Text style={[TYPE.headline, { color: theme.accent }]}>{accountTitle[0]?.toUpperCase()}</Text>
          ) : (
            <Icon name="user" size={20} color={theme.inkMuted} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '500' }]} numberOfLines={1}>
            {accountTitle}
          </Text>
          <Text style={[TYPE.caption, { color: theme.inkMuted }]} numberOfLines={1}>
            {accountSub}
          </Text>
        </View>
        <Icon name="chevron-right" size={16} color={theme.inkFaint} />
      </Pressable>

      <SectionLabel>Connections</SectionLabel>
      {group(connectionRows)}

      <SectionLabel>Your work</SectionLabel>
      {group(workRows)}

      <SectionLabel>Server</SectionLabel>
      <View style={styles.stack}>
        <TextField
          label="Base URL"
          value={draft.baseUrl}
          onChangeText={(v) => set('baseUrl', v.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://host:port/v1"
          mono
        />
        <TextField
          label="API key"
          hint="Stored securely on this device."
          value={draft.apiKey}
          onChangeText={(v) => set('apiKey', v.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!showKey}
          placeholder="sk-…"
          mono
          right={
            <FieldAction
              title={showKey ? 'Hide' : 'Show'}
              label={showKey ? 'Hide API key' : 'Show API key'}
              onPress={() => setShowKey((s) => !s)}
            />
          }
        />
        <PillButton title="Test connection" variant="secondary" onPress={test} loading={testing} />
        {testResult && (
          <Banner tone={testResult.ok ? 'success' : 'danger'} title={testResult.ok ? 'Connected.' : 'Couldn’t connect.'}>
            {testResult.text}
          </Banner>
        )}
      </View>

      <SectionLabel>Model</SectionLabel>
      <View style={styles.stack}>
        <View style={styles.field}>
          <FieldLabel>Default model for new chats</FieldLabel>
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Default model for new chats, ${draft.model || 'not chosen'}`}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.select,
              { backgroundColor: theme.fill, borderColor: pressed || hovered ? theme.ink : theme.borderStrong },
            ]}
          >
            <Text
              style={[
                draft.model ? { fontFamily: FONT.mono, fontSize: 14, lineHeight: 20 } : TYPE.callout,
                { color: draft.model ? theme.ink : theme.inkFaint, flex: 1 },
              ]}
              numberOfLines={1}
            >
              {draft.model || 'Tap to choose a model'}
            </Text>
            <Icon name="chevron-down" size={16} />
          </Pressable>
        </View>
        <TextField
          label="Voice transcription model"
          value={draft.transcriptionModel}
          onChangeText={(v) => set('transcriptionModel', v.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="whisper-1"
          mono
          accessibilityLabel="Voice transcription model"
        />
        <View style={styles.field}>
          <FieldLabel>Temperature: {draft.temperature.toFixed(1)}</FieldLabel>
          <SegmentedControl
            label="Temperature"
            options={TEMPERATURES}
            value={String(draft.temperature)}
            onChange={(v) => set('temperature', Number(v))}
          />
        </View>
        <View style={styles.field}>
          <FieldLabel>Messages of history sent per request: {draft.contextMessages}</FieldLabel>
          <SegmentedControl
            label="Messages of history sent per request"
            options={HISTORY}
            value={String(draft.contextMessages)}
            onChange={(v) => set('contextMessages', Number(v))}
          />
        </View>
      </View>

      <SectionLabel>Appearance</SectionLabel>
      <SegmentedControl label="Theme" options={APPEARANCE} value={appearance} onChange={setAppearance} />

      <SectionLabel>Features</SectionLabel>
      <Card>
        {FEATURES.map(([key, title, desc], i) => (
          <Fragment key={key}>
            {i > 0 && <Divider inset={12} />}
            <SwitchRow title={title} subtitle={desc} value={draft[key]} onValueChange={(v) => set(key, v)} />
          </Fragment>
        ))}
        {Platform.OS !== 'web' && (
          <>
            <Divider inset={12} />
            <SwitchRow
              title="Keep working in the background"
              subtitle="Finish replies and tools after you leave the app, and notify you when done (this device only)"
              value={background}
              onValueChange={setBackgroundEnabled}
            />
          </>
        )}
      </Card>

      <SectionLabel>System prompt</SectionLabel>
      <TextField
        value={draft.systemPrompt}
        onChangeText={(v) => set('systemPrompt', v)}
        multiline
        accessibilityLabel="System prompt"
      />
      <View style={{ alignSelf: 'flex-start' }}>
        <TextAction title="Reset system prompt" onPress={() => set('systemPrompt', DEFAULT_SETTINGS.systemPrompt)} />
      </View>

      <SectionLabel>Data</SectionLabel>
      <Card>
        <ListRow
          icon="trash-2"
          title="Delete all chats"
          danger
          onPress={() =>
            Alert.alert('Delete all chats?', 'This cannot be undone. Memories are kept.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: clearConversations },
            ])
          }
        />
      </Card>

      {!!version && <Text style={[TYPE.caption, styles.version, { color: theme.inkFaint }]}>TryChat {version}</Text>}

      <ModelPicker
        visible={pickerOpen}
        selected={draft.model}
        onSelect={(m) => set('model', m)}
        onClose={() => setPickerOpen(false)}
      />
    </KeyboardAwareScrollView>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ color: theme.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: '500' }}>{children}</Text>;
}

/** Show / Hide text button at the end of a secret field. */
function FieldAction({ title, label, onPress }: { title: string; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.fieldAction,
        { backgroundColor: pressed || hovered ? theme.surfaceRaised : 'transparent' },
      ]}
    >
      <Text style={[TYPE.subhead, { color: theme.accent }]}>{title}</Text>
    </Pressable>
  );
}

/** A setting that takes effect at once: title, one sentence, and a switch. */
function SwitchRow({
  title,
  subtitle,
  value,
  onValueChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[TYPE.callout, { color: theme.ink }]}>{title}</Text>
        {!!subtitle && <Text style={[TYPE.caption, { color: theme.inkMuted, marginTop: 2 }]}>{subtitle}</Text>}
      </View>
      <ClaySwitch value={value} onValueChange={onValueChange} label={title} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 48, width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center' },
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: RADIUS.md, borderWidth: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stack: { gap: 16 },
  field: { gap: 6 },
  select: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderRadius: RADIUS.sm, borderWidth: 1, paddingLeft: 14, paddingRight: 12 },
  fieldAction: { minHeight: 40, paddingHorizontal: 12, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 12, paddingVertical: 10 },
  version: { textAlign: 'center', marginTop: 20 },
});
