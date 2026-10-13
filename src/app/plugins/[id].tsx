import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Card, Chip, ClaySwitch, Divider, Icon, IconTile, PillButton, SectionLabel } from '../../components/ui';
import { missingConfig, substituteConfig } from '../../lib/plugins';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import type { Plugin, PluginConfigField } from '../../lib/types';

type Draft = Record<string, string | boolean>;

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
        <Text style={{ color: theme.muted }}>This plugin isn’t installed anymore.</Text>
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
  const input = [styles.input, { backgroundColor: theme.bg, color: theme.text, borderColor: theme.border }];

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
    const label = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{f.title || f.key}</Text>
        {f.required && <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '600' }}>Required</Text>}
        {f.sensitive && <Icon name="lock" size={13} color={theme.faint} />}
      </View>
    );
    const description = !!f.description && (
      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{f.description}</Text>
    );

    if (f.type === 'boolean') {
      return (
        <View style={[styles.fieldRow, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <View style={{ flex: 1 }}>
            {label}
            {description}
          </View>
          <ClaySwitch value={value === true} onValueChange={(v) => setField(f, v)} label={f.title || f.key} />
        </View>
      );
    }

    const text = typeof value === 'string' ? value : '';
    let control: ReactNode;
    if (f.options?.length && !f.sensitive) {
      const picked = f.multiple ? text.split(',').map((s) => s.trim()).filter(Boolean) : [text];
      control = (
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
                hitSlop={6}
                accessibilityRole={f.multiple ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: on }}
                style={[
                  styles.option,
                  on ? { backgroundColor: theme.text, borderColor: theme.text } : { backgroundColor: theme.surface2, borderColor: theme.border },
                ]}
              >
                {on && <Icon name="check" size={14} color={theme.bg} />}
                <Text style={{ color: on ? theme.bg : theme.text, fontSize: 14 }}>{opt}</Text>
              </Pressable>
            );
          })}
        </View>
      );
    } else {
      const shown = !!revealed[f.key];
      control = (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <TextInput
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
            placeholderTextColor={theme.faint}
            keyboardType={f.type === 'number' ? 'numeric' : 'default'}
            secureTextEntry={!!f.sensitive && !shown}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={f.title || f.key}
            style={[input, { flex: 1 }, (f.type === 'directory' || f.type === 'file') && { fontFamily: 'monospace', fontSize: 14 }]}
          />
          {f.sensitive && (
            <Pressable
              onPress={() => setRevealed((r) => ({ ...r, [f.key]: !shown }))}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel={shown ? `Hide ${f.title || f.key}` : `Show ${f.title || f.key}`}
            >
              <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
            </Pressable>
          )}
        </View>
      );
    }

    return (
      <View style={styles.fieldRow}>
        {label}
        {description}
        {control}
        {errors[f.key] ? (
          <Text style={{ color: theme.danger, fontSize: 12, marginTop: 6 }}>{errors[f.key]}</Text>
        ) : (
          f.type === 'number' &&
          !!rangeHint(f) && <Text style={{ color: theme.faint, fontSize: 12, marginTop: 6 }}>{rangeHint(f)}</Text>
        )}
      </View>
    );
  };

  const hasSensitive = plugin.userConfig.some((f) => f.sensitive);

  return (
    <KeyboardAwareScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable onPress={confirmUninstall} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Uninstall plugin">
              <Icon name="trash-2" size={20} color={theme.muted} />
            </Pressable>
          ),
        }}
      />

      <IconTile name="package" size={48} />
      <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 28, lineHeight: 34, marginTop: 12 }}>{name}</Text>
      {(!!plugin.version || !!plugin.marketplace) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
          {!!plugin.version && <Chip>v{plugin.version}</Chip>}
          {!!plugin.marketplace && (
            <Text style={{ color: theme.muted, fontSize: 13 }}>From the {plugin.marketplace} marketplace</Text>
          )}
        </View>
      )}
      {!!plugin.description && (
        <Text style={{ color: theme.text, fontSize: 15, lineHeight: 22, marginTop: 12 }}>{plugin.description}</Text>
      )}
      {!!plugin.author && <Text style={{ color: theme.muted, fontSize: 13, marginTop: 8 }}>By {plugin.author}</Text>}
      <Pressable
        onPress={() => open(sourceUrl(plugin.source))}
        style={styles.linkRow}
        accessibilityRole="link"
        accessibilityLabel={`Open source: ${plugin.source}`}
      >
        <Icon name="github" size={15} color={theme.primary} />
        <Text style={{ color: theme.primary, fontSize: 13, fontFamily: 'monospace', flex: 1 }} numberOfLines={1}>
          {plugin.source.replace(/^https?:\/\//, '')}
        </Text>
      </Pressable>
      {!!plugin.homepage && (
        <Pressable onPress={() => open(plugin.homepage!)} style={styles.linkRow} accessibilityRole="link" accessibilityLabel="Open website">
          <Icon name="external-link" size={15} color={theme.primary} />
          <Text style={{ color: theme.primary, fontSize: 13, flex: 1 }} numberOfLines={1}>
            Website
          </Text>
        </Pressable>
      )}

      <Card style={{ marginTop: 16 }}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>Enabled</Text>
            <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
              {plugin.enabled ? 'Available in your chats.' : 'Off — nothing from this plugin is used.'}
            </Text>
          </View>
          <ClaySwitch value={plugin.enabled} onValueChange={(enabled) => updatePlugin({ ...plugin, enabled })} label={`Use ${name}`} />
        </View>
      </Card>

      {missing.length > 0 && (
        <Card style={{ marginTop: 12, padding: 14, backgroundColor: theme.surface2 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="alert-triangle" size={18} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>Needs setup</Text>
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 2 }}>
                Add {missing.join(', ')} under Settings below so this plugin works.
              </Text>
            </View>
          </View>
        </Card>
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
            <View style={[styles.noteRow, { marginTop: 8 }]}>
              <Icon name="lock" size={13} color={theme.faint} />
              <Text style={{ color: theme.faint, fontSize: 12, flex: 1 }}>Sensitive values stay on this device.</Text>
            </View>
          )}
          {typed.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <PillButton title="Save settings" onPress={save} disabled={!dirty || hasErrors} />
              {justSaved && !dirty && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="check" size={15} color={theme.accent} />
                  <Text style={{ color: theme.muted, fontSize: 13 }}>Saved</Text>
                </View>
              )}
            </View>
          )}
          {typed.length > 0 && typed.length < plugin.userConfig.length && (
            <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>Switches and choices are saved as soon as you change them.</Text>
          )}
        </>
      )}

      {plugin.skills.length > 0 && (
        <ContentSection title="Skills" note="TryChat loads these when a task matches.">
          {plugin.skills.map((s, i) => (
            <View key={s.name}>
              {i > 0 && <Divider />}
              <View style={styles.itemRow}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{s.name}</Text>
                {!!s.description && (
                  <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 2 }} numberOfLines={3}>
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
                <Text style={{ fontFamily: 'monospace', fontSize: 14 }}>
                  <Text style={{ color: theme.text }}>/{c.name}</Text>
                  {!!c.argumentHint && <Text style={{ color: theme.faint }}> {c.argumentHint}</Text>}
                </Text>
                {!!c.description && (
                  <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 2 }} numberOfLines={3}>
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{a.name}</Text>
                  {!!a.model && <Chip>{a.model}</Chip>}
                </View>
                {!!a.description && (
                  <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 2 }} numberOfLines={3}>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500', flexShrink: 1 }} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Chip>{m.transport.toUpperCase()}</Chip>
                  </View>
                  <Text style={{ color: theme.faint, fontSize: 12, fontFamily: 'monospace', marginTop: 2 }} numberOfLines={1}>
                    {hostOf(substituteConfig(m.url, plugin))}
                  </Text>
                  {live && (
                    <View style={[styles.noteRow, { marginTop: 6 }]}>
                      {error ? (
                        <>
                          <Icon name="alert-circle" size={14} color={theme.danger} />
                          <Text style={{ color: theme.danger, fontSize: 12, flex: 1 }} numberOfLines={3}>
                            {error}
                          </Text>
                        </>
                      ) : tools ? (
                        <>
                          <Icon name="check-circle" size={14} color={theme.accent} />
                          <Text style={{ color: theme.muted, fontSize: 12 }}>
                            {tools.length} tool{tools.length === 1 ? '' : 's'}
                          </Text>
                        </>
                      ) : (
                        <>
                          <ActivityIndicator size="small" color={theme.muted} />
                          <Text style={{ color: theme.muted, fontSize: 12 }}>Connecting…</Text>
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
              <View style={[styles.itemRow, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                <Icon name="slash" size={15} color={theme.faint} />
                <Text style={{ color: theme.muted, fontSize: 14, flex: 1 }}>{u}</Text>
              </View>
            </View>
          ))}
        </ContentSection>
      )}
    </KeyboardAwareScrollView>
  );
}

function ContentSection({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <>
      <SectionLabel>{title}</SectionLabel>
      <Card>{children}</Card>
      <Text style={{ color: theme.faint, fontSize: 12, marginTop: 6 }}>{note}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 64, paddingVertical: 10 },
  fieldRow: { paddingHorizontal: 16, paddingVertical: 14 },
  itemRow: { paddingHorizontal: 16, paddingVertical: 12, minHeight: 52, justifyContent: 'center' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 48 },
});
