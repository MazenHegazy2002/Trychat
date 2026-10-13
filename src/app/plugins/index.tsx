import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Chip, ClaySwitch, Divider, Icon, IconTile, PillButton, ScreenIntro, SectionLabel } from '../../components/ui';
import type { IconName } from '../../components/ui';
import { carryOverSettings, inspectGithubSource, installFromMarketplace, marketplacePluginId } from '../../lib/pluginInstaller';
import type { MarketplaceEntry, MarketplaceInfo } from '../../lib/pluginInstaller';
import { findNameConflict, missingConfig, pluginOrigin } from '../../lib/plugins';
import { useStore } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import type { Plugin } from '../../lib/types';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a plugin brings, e.g. [{ icon: 'layers', label: '3 skills', names: [...] }]. Empty parts are left out. */
function pluginParts(p: Plugin): { icon: IconName; label: string; names: string[] }[] {
  const parts: [IconName, string, string[]][] = [
    ['layers', 'skill', p.skills.map((s) => s.name)],
    ['terminal', 'command', p.commands.map((c) => `/${c.name}`)],
    ['users', 'agent', p.agents.map((a) => a.name)],
    ['zap', 'MCP server', p.mcpServers.map((m) => m.name)],
  ];
  return parts.filter(([, , names]) => names.length > 0).map(([icon, one, names]) => ({ icon, label: plural(names.length, one), names }));
}

/** "3 skills · 2 commands · 1 agent · 1 MCP server" */
const metaLine = (p: Plugin) => pluginParts(p).map((x) => x.label).join(' · ') || 'Nothing that runs on mobile';

const openPlugin = (id: string) => router.push({ pathname: '/plugins/[id]', params: { id } });

/** A freshly fetched plugin as it will look once installed (reinstalls keep the user's settings). */
function withSavedSettings(plugin: Plugin, installed: Plugin[]): Plugin {
  const old = installed.find((p) => p.id === plugin.id);
  return old ? { ...plugin, ...carryOverSettings(old, plugin) } : plugin;
}

export default function PluginsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { plugins, settings, installPlugin, updatePlugin, uninstallPlugin } = useStore();
  const [link, setLink] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState('');
  /** A single plugin waiting for the user to confirm the install. */
  const [pending, setPending] = useState<Plugin | null>(null);
  /** A marketplace the user is browsing. */
  const [market, setMarket] = useState<MarketplaceInfo | null>(null);
  const [query, setQuery] = useState('');
  const [installingEntry, setInstallingEntry] = useState<string | null>(null);
  const [entryErrors, setEntryErrors] = useState<Record<string, string>>({});

  const token = settings.githubToken || undefined;
  const input = [styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }];

  const inspect = async () => {
    const value = link.trim();
    if (!value || inspecting) return;
    setInspecting(true);
    setError('');
    try {
      const target = await inspectGithubSource(value, token);
      if (target.kind === 'plugin') {
        setPending(target.plugin);
      } else {
        setQuery('');
        setEntryErrors({});
        setMarket(target.marketplace);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setInspecting(false);
    }
  };

  /**
   * Runs `install`, unless a plugin with the same name from another marketplace or repo is installed: their commands,
   * skills and tools would clash, so the user decides whether this one replaces it.
   */
  const replacingSameName = (plugin: Plugin, install: () => void) => {
    const old = findNameConflict(plugins, plugin);
    if (!old) return install();
    Alert.alert(
      `Replace ${old.displayName ?? old.name} from ${pluginOrigin(old)}?`,
      `Only one plugin named “${plugin.name}” can be installed. The one from ${pluginOrigin(plugin)} replaces it, and its settings are removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            uninstallPlugin(old.id);
            install();
          },
        },
      ],
    );
  };

  const confirmInstall = () => {
    if (!pending) return;
    const plugin = pending;
    replacingSameName(plugin, () => {
      installPlugin(plugin);
      setPending(null);
      setLink('');
      openPlugin(plugin.id);
    });
  };

  const closeMarket = () => {
    setMarket(null);
    setQuery('');
    setEntryErrors({});
  };

  const installedFrom = (m: MarketplaceInfo, entry: MarketplaceEntry) =>
    plugins.find((p) => p.id === marketplacePluginId(m, entry));

  const installEntry = async (entry: MarketplaceEntry) => {
    if (!market || installingEntry) return;
    setInstallingEntry(entry.name);
    setEntryErrors(({ [entry.name]: _, ...rest }) => rest);
    try {
      const plugin = await installFromMarketplace(market, entry, token);
      const missing = missingConfig(withSavedSettings(plugin, plugins));
      replacingSameName(plugin, () => {
        installPlugin(plugin);
        if (missing.length) {
          Alert.alert(`${plugin.displayName ?? plugin.name} needs setup`, `Add ${missing.join(', ')} so it works.`, [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Set up',
              onPress: () => {
                closeMarket();
                openPlugin(plugin.id);
              },
            },
          ]);
        }
      });
    } catch (e) {
      setEntryErrors((errs) => ({ ...errs, [entry.name]: errorText(e) }));
    } finally {
      setInstallingEntry(null);
    }
  };

  const q = query.trim().toLowerCase();
  const entries = (market?.entries ?? []).filter(
    (e) => !q || [e.name, e.displayName, e.description, e.category].some((s) => s?.toLowerCase().includes(q)),
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <ScreenIntro title="Plugins">
          Add skills, commands, agents and tools in one install. Works with Claude Code plugins and marketplaces on GitHub.
        </ScreenIntro>

        <Pressable
          onPress={() => router.push('/store')}
          style={[styles.storeCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
          accessibilityRole="button"
        >
          <IconTile name="shopping-bag" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>Browse the Store</Text>
            <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
              Anthropic’s marketplaces, skills and the MCP Registry
            </Text>
          </View>
          <Icon name="chevron-right" size={16} />
        </Pressable>

        <SectionLabel>Add from GitHub</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            value={link}
            onChangeText={(v) => {
              setLink(v);
              if (error) setError('');
            }}
            onSubmitEditing={inspect}
            placeholder="github.com/owner/plugin-or-marketplace"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            editable={!inspecting}
            accessibilityLabel="Plugin or marketplace link"
            style={[input, { flex: 1 }]}
          />
          <PillButton title="Install" onPress={inspect} loading={inspecting} disabled={!link.trim()} />
        </View>
        {inspecting && <Text style={{ color: theme.muted, fontSize: 13, marginTop: 8 }}>Looking at the repository…</Text>}
        {!!error && (
          <View style={styles.errorRow}>
            <Icon name="alert-circle" size={16} color={theme.danger} />
            <Text style={{ color: theme.danger, fontSize: 13, flex: 1 }}>{error}</Text>
          </View>
        )}
        {!settings.githubToken && (
          <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>
            Private repos need a GitHub token in Settings → Connections.
          </Text>
        )}

        <SectionLabel>Installed</SectionLabel>
        {plugins.length > 0 ? (
          <Card>
            {plugins.map((p, i) => {
              const needsSetup = missingConfig(p).length > 0;
              const name = p.displayName ?? p.name;
              return (
                <View key={p.id}>
                  {i > 0 && <Divider />}
                  <View style={styles.row}>
                    <Pressable
                      onPress={() => openPlugin(p.id)}
                      style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                      accessibilityHint="Opens the plugin"
                    >
                      <IconTile name="package" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
                          {name}
                        </Text>
                        {!!p.description && (
                          <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                            {p.description}
                          </Text>
                        )}
                        <Text style={{ color: theme.faint, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
                          {metaLine(p)}
                        </Text>
                        {needsSetup && (
                          <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '600', marginTop: 3 }}>Needs setup</Text>
                        )}
                      </View>
                    </Pressable>
                    <ClaySwitch value={p.enabled} onValueChange={(enabled) => updatePlugin({ ...p, enabled })} label={`Use ${name}`} />
                  </View>
                </View>
              );
            })}
          </Card>
        ) : (
          <Card style={{ padding: 16 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>No plugins yet</Text>
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 4 }}>
              Paste a link to a plugin or a plugin marketplace above. Its skills, slash commands, agents and MCP tools show up in
              your chats.
            </Text>
          </Card>
        )}
      </KeyboardAwareScrollView>

      {/* Confirm a single plugin */}
      <Modal visible={!!pending} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setPending(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,20,19,0.45)' }]}
            onPress={() => setPending(null)}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          />
          {pending && (
            <View style={[styles.sheet, { backgroundColor: theme.bg, paddingBottom: insets.bottom + 16 }]}>
              <View style={[styles.grabber, { backgroundColor: theme.oat }]} />
              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 8 }}>
                <PluginSummary plugin={pending} installed={plugins} />
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <PillButton title="Cancel" variant="secondary" onPress={() => setPending(null)} style={{ flex: 1 }} />
                <PillButton
                  title={plugins.some((p) => p.id === pending.id) ? 'Update' : 'Install'}
                  icon="download"
                  onPress={confirmInstall}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Browse a marketplace */}
      <Modal visible={!!market} animationType="slide" onRequestClose={closeMarket}>
        {market && (
          <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 4 }}>
            <View style={styles.modalHeader}>
              <Pressable onPress={closeMarket} hitSlop={10} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={22} color={theme.text} />
              </Pressable>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '600' }}>Marketplace</Text>
              <View style={styles.headerBtn} />
            </View>

            <View style={{ paddingHorizontal: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <IconTile name="shopping-bag" size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 24, lineHeight: 30 }} numberOfLines={2}>
                    {market.name}
                  </Text>
                  <Text style={{ color: theme.muted, fontSize: 13 }} numberOfLines={1}>
                    {[market.owner && `By ${market.owner}`, plural(market.entries.length, 'plugin')].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
              {!!market.description && (
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 10 }} numberOfLines={3}>
                  {market.description}
                </Text>
              )}
              <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Icon name="search" size={17} color={theme.faint} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search plugins"
                  placeholderTextColor={theme.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Search plugins"
                  style={{ flex: 1, color: theme.text, fontSize: 15, minHeight: 44 }}
                />
                {!!query && (
                  <Pressable onPress={() => setQuery('')} hitSlop={10} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel="Clear search">
                    <Icon name="x-circle" size={17} color={theme.faint} />
                  </Pressable>
                )}
              </View>
            </View>

            <FlatList
              data={entries}
              keyExtractor={(e) => e.name}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ padding: 20, paddingTop: 14, paddingBottom: insets.bottom + 24 }}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              ListEmptyComponent={
                <Text style={{ color: theme.muted, fontSize: 14, textAlign: 'center', marginTop: 24 }}>
                  {market.entries.length ? 'No plugins match your search.' : 'This marketplace has no plugins.'}
                </Text>
              }
              renderItem={({ item }) => {
                const installed = installedFrom(market, item);
                const busy = installingEntry === item.name;
                const entryError = entryErrors[item.name];
                const title = item.displayName ?? item.name;
                return (
                  <Card style={[{ padding: 14 }, !item.supported && { opacity: 0.6 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
                          {title}
                        </Text>
                        {!!item.version && (
                          <Text style={{ color: theme.faint, fontSize: 12, fontFamily: 'monospace', marginTop: 2 }}>v{item.version}</Text>
                        )}
                      </View>
                      {installed ? (
                        <Pressable
                          onPress={() => {
                            closeMarket();
                            openPlugin(installed.id);
                          }}
                          style={styles.installedBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`${title} is installed. Open it`}
                        >
                          <Icon name="check" size={15} color={theme.accent} />
                          <Text style={{ color: theme.muted, fontSize: 14, fontWeight: '600' }}>Installed</Text>
                        </Pressable>
                      ) : busy ? (
                        <ActivityIndicator color={theme.primary} style={styles.installedBtn} />
                      ) : item.supported ? (
                        <PillButton
                          title="Install"
                          onPress={() => installEntry(item)}
                          disabled={!!installingEntry}
                          style={styles.smallPill}
                        />
                      ) : null}
                    </View>
                    {!!item.description && (
                      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 6 }} numberOfLines={3}>
                        {item.description}
                      </Text>
                    )}
                    {!!item.category && (
                      <View style={{ flexDirection: 'row', marginTop: 8 }}>
                        <Chip>{item.category}</Chip>
                      </View>
                    )}
                    {!item.supported && (
                      <View style={styles.noteRow}>
                        <Icon name="slash" size={14} color={theme.faint} />
                        <Text style={{ color: theme.faint, fontSize: 12, flex: 1 }}>
                          Not available on mobile{item.reason ? `: ${item.reason}` : ''}
                        </Text>
                      </View>
                    )}
                    {!!entryError && (
                      <View style={styles.noteRow}>
                        <Icon name="alert-circle" size={14} color={theme.danger} />
                        <Text style={{ color: theme.danger, fontSize: 12, flex: 1 }}>{entryError}</Text>
                      </View>
                    )}
                  </Card>
                );
              }}
            />
          </View>
        )}
      </Modal>
    </View>
  );
}

/** What a plugin contains, shown before installing it. */
function PluginSummary({ plugin, installed }: { plugin: Plugin; installed: Plugin[] }) {
  const theme = useTheme();
  const parts = pluginParts(plugin);
  const reinstall = installed.some((p) => p.id === plugin.id);
  const missing = missingConfig(withSavedSettings(plugin, installed));

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile name="package" size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 24, lineHeight: 30 }} numberOfLines={2}>
            {plugin.displayName ?? plugin.name}
          </Text>
          {(!!plugin.version || !!plugin.author) && (
            <Text style={{ color: theme.muted, fontSize: 13 }} numberOfLines={1}>
              {[plugin.version && `v${plugin.version}`, plugin.author && `By ${plugin.author}`].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
      </View>
      {!!plugin.description && (
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 10 }}>{plugin.description}</Text>
      )}
      {reinstall && (
        <Text style={{ color: theme.faint, fontSize: 13, marginTop: 8 }}>
          Already installed. Installing again updates it and keeps your settings.
        </Text>
      )}

      <SectionLabel>What’s inside</SectionLabel>
      {parts.length ? (
        <Card>
          {parts.map((part, i) => (
            <View key={part.label}>
              {i > 0 && <Divider />}
              <View style={styles.partRow}>
                <Icon name={part.icon} size={18} color={theme.text} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 15 }}>{part.label}</Text>
                  <Text style={{ color: theme.faint, fontSize: 12, fontFamily: 'monospace', marginTop: 2 }} numberOfLines={2}>
                    {part.names.join(', ')}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </Card>
      ) : (
        <Text style={{ color: theme.muted, fontSize: 14 }}>No skills, commands, agents or tools that work on a phone.</Text>
      )}

      {plugin.unsupported.length > 0 && (
        <>
          <SectionLabel>Not available on mobile</SectionLabel>
          <View style={{ gap: 6 }}>
            {plugin.unsupported.map((u) => (
              <View key={u} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="slash" size={14} color={theme.faint} />
                <Text style={{ color: theme.muted, fontSize: 14, flex: 1 }}>{u}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {plugin.userConfig.length > 0 && (
        <>
          <SectionLabel>Settings it asks for</SectionLabel>
          <View style={{ gap: 6 }}>
            {plugin.userConfig.map((f) => (
              <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name={f.sensitive ? 'lock' : 'sliders'} size={14} color={theme.faint} />
                <Text style={{ color: theme.text, fontSize: 14, flex: 1 }} numberOfLines={1}>
                  {f.title || f.key}
                </Text>
                {f.required && <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '600' }}>Required</Text>}
              </View>
            ))}
          </View>
          <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>
            {missing.length ? 'You can fill these in after installing.' : 'Optional — you can change these after installing.'}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  storeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 48 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 14 },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 52 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8 },
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingLeft: 12, marginTop: 14 },
  clearBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  installedBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, minWidth: 44, justifyContent: 'center' },
  smallPill: { minHeight: 44, paddingHorizontal: 18 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 },
});
