import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Text } from '../../components/Text';
import { Banner, Card, Chip, ClaySwitch, Divider, EmptyState, Icon, IconTile, PillButton, SectionLabel, StatusBadge, TextField } from '../../components/ui';
import { missingConfig, substituteConfig, pluginOrigin } from '../../lib/plugins';
import { useStore } from '../../lib/store';
import { FONT, RADIUS, SIZE, SPACE, TYPE, WIDE_BREAKPOINT, useTheme } from '../../lib/theme';
import type { Plugin, PluginConfigField } from '../../lib/types';

type Draft = Record<string, string | boolean>;
type PressState = { pressed: boolean; hovered?: boolean };

/** The content column: 16px gutters on phones; on wide screens 24px gutters, at most 760 wide and centred. */
function useColumn(): ViewStyle {
  const { width } = useWindowDimensions();
  const gutter = width >= WIDE_BREAKPOINT ? SPACE[6] : SPACE[4];
  return { width: '100%', maxWidth: SIZE.contentMax + gutter * 2, alignSelf: 'center', paddingHorizontal: gutter };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A link the phone can open for what the user typed: a full URL, github.com/…, or owner/repo. */
function sourceUrl(source: string): string {
  if (/^https?:\/\//i.test(source)) return source;
  if (/^(www\.)?github\.com\//i.test(source)) return `https://${source}`;
  return `https://github.com/${source}`;
}

/** Host of a URL without credentials, e.g. "mcp.example.com". */
function hostOf(url: string): string {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]+)/i);
  return m ? m[1] : url;
}

/** The value a settings field shows: saved value, else its default. Numbers are edited as text. */
function fieldValue(plugin: Plugin, f: PluginConfigField): string | boolean {
  const v = f.sensitive ? plugin.secrets?.[f.key] : plugin.config[f.key] ?? f.default;
  if (f.type === 'boolean') return v === true || v === 'true';
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? v.join(',') : String(v);
}

const savedDraft = (plugin: Plugin): Draft => Object.fromEntries(plugin.userConfig.map((f) => [f.key, fieldValue(plugin, f)]));

/** Switches and choices save as soon as they change, like the Enabled switch; typed values wait for Save. */
const savesInstantly = (f: PluginConfigField) => f.type === 'boolean' || (!!f.options?.length && !f.sensitive);

/** `plugin` with `values` saved into its settings. A value that didn't change keeps following its default. */
function withValues(plugin: Plugin, values: Draft): Plugin {
  const saved = savedDraft(plugin);
  const config = { ...plugin.config };
  const secrets = { ...(plugin.secrets ?? {}) };
  for (const f of plugin.userConfig) {
    if (!(f.key in values) || values[f.key] === saved[f.key]) continue;
    const v = values[f.key];
    if (f.type === 'boolean' && !f.sensitive) {
      config[f.key] = v === true;
      continue;
    }
    const s = String(v ?? '').trim();
    if (f.sensitive) {
      if (s) secrets[f.key] = s;
      else delete secrets[f.key];
    } else if (f.type === 'number') {
      if (s) config[f.key] = Number(s);
      else delete config[f.key]; // back to the default
    } else {
      config[f.key] = s;
    }
  }
  return { ...plugin, config, secrets };
}

function fieldError(f: PluginConfigField, value: string | boolean): string | undefined {
  if (f.type !== 'number' || typeof value !== 'string' || !value.trim()) return undefined;
  const n = Number(value.trim());
  if (!Number.isFinite(n)) return 'Enter a number';
  if (f.min !== undefined && n < f.min) return `Must be at least ${f.min}`;
  if (f.max !== undefined && n > f.max) return `Must be at most ${f.max}`;
  return undefined;
}

function rangeHint(f: PluginConfigField): string | undefined {
  if (f.min !== undefined && f.max !== undefined) return `Between ${f.min} and ${f.max}`;
  if (f.min !== undefined) return `At least ${f.min}`;
  if (f.max !== undefined) return `At most ${f.max}`;
  return undefined;
}

export default function PluginScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { plugins } = useStore();
  const key = String(id ?? '');
  const plugin = plugins.find((p) => p.id === key) ?? plugins.find((p) => p.id === safeDecode(key));

  if (!plugin) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="layers" title="This plugin isn’t installed anymore">
          You can add it again from the Store.
        </EmptyState>
      </View>
    );
  }
  // Keyed so the settings draft starts fresh for each plugin.
  return <PluginDetail key={plugin.id} plugin={plugin} />;
}

function PluginDetail({ plugin }: { plugin: Plugin }) {
  const theme = useTheme();
  const navigation = useNavigation();
  const { updatePlugin, uninstallPlugin, pluginServers, mcpTools, mcpErrors } = useStore();
  /** Typed values not saved yet. Switches and choices aren't drafted: they show and save the plugin's values. */
  const [draft, setDraft] = useState<Draft>(() => savedDraft(plugin));
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [justSaved, setJustSaved] = useState(false);
  const uninstalling = useRef(false);

  const name = plugin.displayName ?? plugin.name;
  const missing = missingConfig(plugin);
  const saved = savedDraft(plugin);
  const typed = plugin.userConfig.filter((f) => !savesInstantly(f));
  const valueOf = (f: PluginConfigField) => (savesInstantly(f) ? saved[f.key] : draft[f.key]);
  const dirty = typed.some((f) => draft[f.key] !== saved[f.key]);
  const errors = Object.fromEntries(
    plugin.userConfig.map((f) => [f.key, fieldError(f, valueOf(f))] as const).filter(([, e]) => !!e),
  ) as Record<string, string>;
  const hasErrors = Object.keys(errors).length > 0;
  const column = useColumn();

  const setField = (f: PluginConfigField, value: string | boolean) => {
    if (savesInstantly(f)) {
      updatePlugin(withValues(plugin, { [f.key]: value }));
      return;
    }
    setDraft((d) => ({ ...d, [f.key]: value }));
    setJustSaved(false);
  };

  const save = () => {
    if (!dirty || hasErrors) return;
    const next = withValues(plugin, Object.fromEntries(typed.map((f) => [f.key, draft[f.key]])));
    updatePlugin(next);
    // Show the values as saved (trimmed, numbers normalised, cleared numbers back to their default).
    setDraft(savedDraft(next));
    setJustSaved(true);
  };

  // Leaving with typed values not saved (Back, swipe, Android back): ask instead of silently dropping them.
  usePreventRemove(dirty, ({ data }) => {
    if (uninstalling.current) return navigation.dispatch(data.action);
    const leave = () => navigation.dispatch(data.action);
    Alert.alert('Save your changes?', `Some settings for ${name} aren’t saved yet.`, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: leave },
      ...(hasErrors
        ? []
        : [
            {
              text: 'Save',
              onPress: () => {
                save();
                leave();
              },
            },
          ]),
    ]);
  });

  const confirmUninstall = () =>
    Alert.alert(`Uninstall ${name}?`, 'Its skills, commands, agents and MCP servers are removed from TryChat, along with its settings.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Uninstall',
        style: 'destructive',
        onPress: () => {
          uninstalling.current = true; // its unsaved settings go with it: no "save your changes?" on the way out
          uninstallPlugin(plugin.id);
          router.back();
        },
      },
    ]);

  const open = (url: string) => Linking.openURL(url).catch(() => Alert.alert('Couldn’t open link', url));

  const renderField = (f: PluginConfigField) => {
    const value = valueOf(f);
    const title = f.title || f.key;
    const label = (
      <View style={styles.fieldLabel}>
        <Text style={[TYPE.callout, styles.medium, { color: theme.ink }]}>{title}</Text>
        {f.required && <StatusBadge tone="neutral">Required</StatusBadge>}
        {f.sensitive && <Icon name="lock" size={14} color={theme.inkFaint} />}
      </View>
    );
    const description = !!f.description && (
      <Text style={[TYPE.caption, styles.gap2, { color: theme.inkMuted }]}>{f.description}</Text>
    );

    if (f.type === 'boolean') {
      return (
        <View style={[styles.fieldRow, styles.switchField]}>
          <View style={styles.flex1}>
            {label}
            {description}
          </View>
          <ClaySwitch value={value === true} onValueChange={(v) => setField(f, v)} label={title} />
        </View>
      );
    }

    const text = typeof value === 'string' ? value : '';
    if (f.options?.length && !f.sensitive) {
      const picked = f.multiple ? text.split(',').map((s) => s.trim()).filter(Boolean) : [text];
      return (
        <View style={styles.fieldRow}>
          {label}
          {description}
          <View style={styles.options}>
            {f.options.map((opt) => {
              const on = picked.includes(opt);
              const choose = () => {
                if (f.multiple) {
                  const next = on ? picked.filter((p) => p !== opt) : [...picked, opt];
                  setField(f, next.join(','));
                } else {
                  setField(f, on && !f.required ? '' : opt);
                }
              };
              return (
                <Pressable
                  key={opt}
                  onPress={choose}
                  hitSlop={4}
                  accessibilityRole={f.multiple ? 'checkbox' : 'radio'}
                  accessibilityState={{ checked: on }}
                  style={({ pressed, hovered }: PressState) => [
                    styles.option,
                    on
                      ? { backgroundColor: theme.accentSoft, borderColor: theme.accent }
                      : { backgroundColor: pressed || hovered ? theme.fill : 'transparent', borderColor: theme.borderStrong },
                  ]}
                >
                  {on && <Icon name="check" size={16} color={theme.accent} />}
                  <Text style={[TYPE.subhead, { color: theme.ink }, on && styles.semibold]}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>
          {errors[f.key] ? (
            <Text style={[TYPE.caption, styles.fieldNote, { color: theme.danger }]}>{errors[f.key]}</Text>
          ) : (
            f.type === 'number' &&
            !!rangeHint(f) && <Text style={[TYPE.caption, styles.fieldNote, { color: theme.inkFaint }]}>{rangeHint(f)}</Text>
          )}
        </View>
      );
    }

    const shown = !!revealed[f.key];
    return (
      <View style={styles.fieldRow}>
        {label}
        {description}
        <TextField
          value={text}
          onChangeText={(v) => setField(f, v)}
          placeholder={
            f.type === 'number'
              ? rangeHint(f) ?? 'Number'
              : f.type === 'directory'
                ? 'Folder path'
                : f.type === 'file'
                  ? 'File path'
                  : f.multiple
                    ? 'Separate values with commas'
                    : f.sensitive && f.default !== undefined
                      ? `Default: ${f.default}`
                      : ''
          }
          keyboardType={f.type === 'number' ? 'numeric' : 'default'}
          secureTextEntry={!!f.sensitive && !shown}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={title}
          mono={f.type === 'directory' || f.type === 'file'}
          error={errors[f.key]}
          hint={f.type === 'number' ? rangeHint(f) : undefined}
          style={styles.control}
          right={
            f.sensitive ? (
              <Pressable
                onPress={() => setRevealed((r) => ({ ...r, [f.key]: !shown }))}
                hitSlop={4}
                style={styles.reveal}
                accessibilityRole="button"
                accessibilityLabel={shown ? `Hide ${title}` : `Show ${title}`}
              >
                <Text style={[TYPE.subhead, { color: theme.accent }]}>{shown ? 'Hide' : 'Show'}</Text>
              </Pressable>
            ) : undefined
          }
        />
      </View>
    );
  };

  const hasSensitive = plugin.userConfig.some((f) => f.sensitive);

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[column, styles.page]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Stack.Screen options={{ title: '' }} />

      <View style={styles.head}>
        <IconTile name="layers" size={56} />
        <View style={styles.headText}>
          <Text style={[TYPE.title, { color: theme.ink }]} accessibilityRole="header">
            {name}
          </Text>
          {!!plugin.author && <Text style={[TYPE.caption, { color: theme.inkMuted }]}>By {plugin.author}</Text>}
        </View>
      </View>
      {(!!plugin.version || !!plugin.marketplace) && (
        <View style={styles.metaRow}>
          {!!plugin.version && <Chip>v{plugin.version}</Chip>}
          {!!plugin.marketplace && <Text style={[TYPE.caption, { color: theme.inkMuted }]}>From {pluginOrigin(plugin)}</Text>}
        </View>
      )}
      {!!plugin.description && <Text style={[TYPE.callout, styles.descr, { color: theme.ink }]}>{plugin.description}</Text>}
      <View style={styles.links}>
        <Pressable
          onPress={() => open(sourceUrl(plugin.source))}
          style={styles.linkRow}
          accessibilityRole="link"
          accessibilityLabel={`Open source: ${plugin.source}`}
        >
          <Icon name="github" size={16} color={theme.accent} />
          <Text style={[TYPE.code, styles.flex1, { color: theme.accent }]} numberOfLines={1}>
            {plugin.source.replace(/^https?:\/\//, '')}
          </Text>
        </Pressable>
        {!!plugin.homepage && (
          <Pressable onPress={() => open(plugin.homepage!)} style={styles.linkRow} accessibilityRole="link" accessibilityLabel="Open website">
            <Icon name="external-link" size={16} color={theme.accent} />
            <Text style={[TYPE.subhead, styles.flex1, { color: theme.accent }]} numberOfLines={1}>
              Website
            </Text>
          </Pressable>
        )}
      </View>

      <Card style={styles.block}>
        <View style={styles.switchRow}>
          <View style={styles.flex1}>
            <Text style={[TYPE.callout, styles.medium, { color: theme.ink }]}>Enabled</Text>
            <Text style={[TYPE.caption, { color: theme.inkMuted }]}>
              {plugin.enabled ? 'Available in your chats.' : 'Off — nothing from this plugin is used.'}
            </Text>
          </View>
          <ClaySwitch value={plugin.enabled} onValueChange={(enabled) => updatePlugin({ ...plugin, enabled })} label={`Use ${name}`} />
        </View>
      </Card>

      {missing.length > 0 && (
        <Banner tone="warning" title="Needs setup" style={styles.blockSm}>
          Add {missing.join(', ')} under Settings below so this plugin works.
        </Banner>
      )}

      {plugin.userConfig.length > 0 && (
        <>
          <SectionLabel>Settings</SectionLabel>
          <Card>
            {plugin.userConfig.map((f, i) => (
              <View key={f.key}>
                {i > 0 && <Divider />}
                {renderField(f)}
              </View>
            ))}
          </Card>
          {hasSensitive && (
            <View style={[styles.noteRow, styles.blockXs]}>
              <Icon name="lock" size={14} color={theme.inkFaint} />
              <Text style={[TYPE.caption, styles.flex1, { color: theme.inkFaint }]}>Sensitive values stay on this device.</Text>
            </View>
          )}
          {typed.length > 0 && (
            <View style={styles.saveRow}>
              <PillButton title="Save settings" onPress={save} disabled={!dirty || hasErrors} />
              {justSaved && !dirty && (
                <View style={styles.noteRow}>
                  <Icon name="check" size={16} color={theme.success} />
                  <Text style={[TYPE.caption, { color: theme.success }]}>Saved</Text>
                </View>
              )}
            </View>
          )}
          {typed.length > 0 && typed.length < plugin.userConfig.length && (
            <Text style={[TYPE.caption, styles.blockXs, { color: theme.inkFaint }]}>Switches and choices are saved as soon as you change them.</Text>
          )}
        </>
      )}

      {plugin.skills.length > 0 && (
        <ContentSection title="Skills" note="TryChat loads these when a task matches.">
          {plugin.skills.map((s, i) => (
            <View key={s.name}>
              {i > 0 && <Divider />}
              <View style={styles.itemRow}>
                <Text style={[TYPE.callout, styles.medium, { color: theme.ink }]}>{s.name}</Text>
                {!!s.description && (
                  <Text style={[TYPE.caption, styles.gap2, { color: theme.inkMuted }]} numberOfLines={3}>
                    {substituteConfig(s.description, plugin)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </ContentSection>
      )}

      {plugin.commands.length > 0 && (
        <ContentSection title="Commands" note="Type / in a chat to use these.">
          {plugin.commands.map((c, i) => (
            <View key={c.name}>
              {i > 0 && <Divider />}
              <View style={styles.itemRow}>
                <Text style={styles.command}>
                  <Text style={[styles.medium, { color: theme.ink }]}>/{c.name}</Text>
                  {!!c.argumentHint && <Text style={{ color: theme.inkFaint }}> {c.argumentHint}</Text>}
                </Text>
                {!!c.description && (
                  <Text style={[TYPE.caption, styles.gap2, { color: theme.inkMuted }]} numberOfLines={3}>
                    {substituteConfig(c.description, plugin)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </ContentSection>
      )}

      {plugin.agents.length > 0 && (
        <ContentSection title="Agents" note="TryChat can delegate tasks to these.">
          {plugin.agents.map((a, i) => (
            <View key={a.name}>
              {i > 0 && <Divider />}
              <View style={styles.itemRow}>
                <View style={styles.titleRow}>
                  <Text style={[TYPE.callout, styles.medium, { color: theme.ink }]}>{a.name}</Text>
                  {!!a.model && <Chip>{a.model}</Chip>}
                </View>
                {!!a.description && (
                  <Text style={[TYPE.caption, styles.gap2, { color: theme.inkMuted }]} numberOfLines={3}>
                    {substituteConfig(a.description, plugin)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </ContentSection>
      )}

      {plugin.mcpServers.length > 0 && (
        <ContentSection title="MCP servers" note="TryChat asks before each call to these tools.">
          {plugin.mcpServers.map((m, i) => {
            const live = pluginServers.find((s) => s.pluginId === plugin.id && s.id.endsWith(`:mcp:${m.name}`));
            const tools = live ? mcpTools[live.id] : undefined;
            const error = live ? mcpErrors[live.id] : undefined;
            return (
              <View key={m.name}>
                {i > 0 && <Divider />}
                <View style={styles.itemRow}>
                  <View style={[styles.titleRow, styles.noWrap]}>
                    <Text style={[TYPE.callout, styles.medium, styles.shrink, { color: theme.ink }]} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Chip>{m.transport.toUpperCase()}</Chip>
                  </View>
                  <Text style={[styles.mono, styles.gap2, { color: theme.inkFaint }]} numberOfLines={1}>
                    {hostOf(substituteConfig(m.url, plugin))}
                  </Text>
                  {live && (
                    <View style={[styles.noteRow, styles.status]}>
                      {error ? (
                        <>
                          <Icon name="alert-circle" size={14} color={theme.danger} />
                          <Text style={[styles.small, styles.flex1, { color: theme.danger }]} numberOfLines={3}>
                            {error}
                          </Text>
                        </>
                      ) : tools ? (
                        <>
                          <Icon name="check-circle" size={14} color={theme.success} />
                          <Text style={[styles.small, { color: theme.inkMuted }]}>
                            {tools.length} tool{tools.length === 1 ? '' : 's'}
                          </Text>
                        </>
                      ) : (
                        <>
                          <ActivityIndicator size="small" color={theme.inkMuted} />
                          <Text style={[styles.small, { color: theme.inkMuted }]}>Connecting…</Text>
                        </>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </ContentSection>
      )}

      {plugin.unsupported.length > 0 && (
        <ContentSection title="Not available on mobile" note="These parts need a computer, so TryChat skips them.">
          {plugin.unsupported.map((u, i) => (
            <View key={u}>
              {i > 0 && <Divider />}
              <View style={[styles.itemRow, styles.unsupportedRow]}>
                <Icon name="slash" size={16} color={theme.inkFaint} />
                <Text style={[TYPE.subhead, styles.flex1, { color: theme.inkMuted }]}>{u}</Text>
              </View>
            </View>
          ))}
        </ContentSection>
      )}

      <PillButton
        title="Remove"
        variant="danger"
        icon="trash-2"
        onPress={confirmUninstall}
        accessibilityHint={`Uninstalls ${name} and removes its settings`}
        style={styles.remove}
      />
    </KeyboardAwareScrollView>
  );
}

function ContentSection({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <>
      <SectionLabel>{title}</SectionLabel>
      <Card>{children}</Card>
      <Text style={[TYPE.caption, styles.blockXs, { color: theme.inkFaint }]}>{note}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE[6] },
  flex1: { flex: 1 },
  shrink: { flexShrink: 1 },
  gap2: { marginTop: 2 },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  small: { fontSize: 12, lineHeight: 16 },
  mono: { fontFamily: FONT.mono, fontSize: 12, lineHeight: 16 },
  command: { fontFamily: FONT.mono, fontSize: 14, lineHeight: 20 },
  page: { paddingTop: SPACE[4], paddingBottom: SPACE[12] },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACE[4] },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE[2], marginTop: SPACE[3] },
  descr: { marginTop: SPACE[3] },
  links: { marginTop: SPACE[1] },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2], minHeight: SIZE.controlMd },
  block: { marginTop: SPACE[4] },
  blockSm: { marginTop: SPACE[3] },
  blockXs: { marginTop: SPACE[2] },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], paddingHorizontal: SPACE[4], minHeight: 64, paddingVertical: 10 },
  fieldRow: { paddingHorizontal: SPACE[4], paddingVertical: 14 },
  switchField: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3] },
  fieldLabel: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2], flexWrap: 'wrap' },
  fieldNote: { marginTop: 6 },
  control: { marginTop: 10 },
  reveal: { minHeight: SIZE.controlMd, paddingHorizontal: 10, justifyContent: 'center' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2], marginTop: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: SIZE.controlSm,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], marginTop: SPACE[3] },
  itemRow: { paddingHorizontal: SPACE[4], paddingVertical: SPACE[3], minHeight: 52, justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2], flexWrap: 'wrap' },
  noWrap: { flexWrap: 'nowrap' },
  unsupportedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { marginTop: 6 },
  remove: { marginTop: SPACE[8] },
});
