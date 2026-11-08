import { router } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../../components/Text';
import {
  Card,
  Chip,
  ClaySwitch,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  IconTile,
  PillButton,
  ScreenIntro,
  SearchField,
  SectionLabel,
  StatusBadge,
  TextField,
} from '../../components/ui';
import type { IconName } from '../../components/ui';
import { carryOverSettings, inspectGithubSource, installFromMarketplace, marketplacePluginId } from '../../lib/pluginInstaller';
import type { MarketplaceEntry, MarketplaceInfo } from '../../lib/pluginInstaller';
import { findNameConflict, missingConfig, pluginOrigin } from '../../lib/plugins';
import { useStore } from '../../lib/store';
import { FONT, RADIUS, SIZE, SPACE, TYPE, WIDE_BREAKPOINT, shadow, useTheme } from '../../lib/theme';
import type { Plugin } from '../../lib/types';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a plugin brings, e.g. [{ icon: 'zap', label: '3 skills', names: [...] }]. Empty parts are left out. */
function pluginParts(p: Plugin): { icon: IconName; label: string; names: string[] }[] {
  const parts: [IconName, string, string[]][] = [
    ['zap', 'skill', p.skills.map((s) => s.name)],
    ['terminal', 'command', p.commands.map((c) => `/${c.name}`)],
    ['users', 'agent', p.agents.map((a) => a.name)],
    ['server', 'MCP server', p.mcpServers.map((m) => m.name)],
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

/** The content column: 16px gutters on phones; on wide screens 24px gutters, at most 760 wide and centred. */
function useColumn() {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const gutter = wide ? SPACE[6] : SPACE[4];
  const column: ViewStyle = { width: '100%', maxWidth: SIZE.contentMax + gutter * 2, alignSelf: 'center', paddingHorizontal: gutter };
  return { wide, column };
}

type PressState = { pressed: boolean; hovered?: boolean };

export default function PluginsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { wide, column } = useColumn();
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
  const buttonSize = wide ? 'md' : 'lg';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAwareScrollView contentContainerStyle={[column, styles.page]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <ScreenIntro title="Plugins">Works with Claude Code plugins and marketplaces on GitHub.</ScreenIntro>

        {plugins.length > 0 ? (
          <>
            <SectionLabel style={styles.firstLabel}>Installed</SectionLabel>
            <View style={styles.list}>
              {plugins.map((p) => (
                <InstalledCard key={p.id} plugin={p} onToggle={(enabled) => updatePlugin({ ...p, enabled })} />
              ))}
            </View>

            <SectionLabel>More plugins</SectionLabel>
            <Pressable
              onPress={() => router.push('/store')}
              accessibilityRole="button"
              accessibilityLabel="Browse the Store"
              accessibilityHint="Anthropic’s marketplaces, skills and the MCP Registry"
              style={({ pressed, hovered }: PressState) => [
                styles.storeCard,
                { backgroundColor: pressed || hovered ? theme.fill : theme.surface, borderColor: theme.border },
              ]}
            >
              <IconTile name="package" />
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: theme.ink }]}>Browse the Store</Text>
                <Text style={[TYPE.caption, { color: theme.inkMuted }]}>Anthropic’s marketplaces, skills and the MCP Registry</Text>
              </View>
              <Icon name="chevron-right" size={16} color={theme.inkFaint} />
            </Pressable>
          </>
        ) : (
          <EmptyState
            icon="layers"
            title="No plugins yet"
            action={<PillButton title="Browse the Store" icon="package" onPress={() => router.push('/store')} />}
          >
            Add skills, commands, agents and tools in one install.
          </EmptyState>
        )}

        <SectionLabel>Add from GitHub</SectionLabel>
        <View style={styles.formRow}>
          <TextField
            value={link}
            onChangeText={(v) => {
              setLink(v);
              if (error) setError('');
            }}
            onSubmitEditing={inspect}
            placeholder="github.com/owner/plugin-or-marketplace"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            editable={!inspecting}
            accessibilityLabel="Plugin or marketplace link"
            error={error}
            style={styles.flex1}
          />
          <PillButton title="Install" variant="secondary" onPress={inspect} loading={inspecting} disabled={!link.trim()} style={styles.formButton} />
        </View>
        {inspecting && <Text style={[TYPE.caption, styles.noteSm, { color: theme.inkMuted }]}>Looking at the repository…</Text>}
        {!settings.githubToken && (
          <Text style={[TYPE.caption, styles.noteSm, { color: theme.inkFaint }]}>Private repos need a GitHub token in Settings → Connections.</Text>
        )}
      </KeyboardAwareScrollView>

      {/* Confirm a single plugin: a sheet on phones, a centred dialog on wide screens */}
      <Modal
        visible={!!pending}
        transparent
        animationType={wide ? 'fade' : 'slide'}
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setPending(null)}
      >
        <View style={[styles.backdrop, wide && styles.backdropWide]}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}
            onPress={() => setPending(null)}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          />
          {pending && (
            <View
              style={[
                wide ? styles.dialog : [styles.sheet, { paddingBottom: insets.bottom + SPACE[4] }],
                { backgroundColor: theme.surfaceRaised },
                shadow(theme, 'sheet'),
              ]}
            >
              {!wide && <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />}
              <ScrollView style={styles.sheetScroll} contentContainerStyle={{ paddingBottom: SPACE[2] }}>
                <PluginSummary plugin={pending} installed={plugins} />
              </ScrollView>
              <View style={[styles.actions, wide && styles.actionsWide]}>
                <PillButton title="Cancel" variant="secondary" size={buttonSize} onPress={() => setPending(null)} style={!wide && styles.flex1} />
                <PillButton
                  title={plugins.some((p) => p.id === pending.id) ? 'Update' : 'Install'}
                  icon="download"
                  size={buttonSize}
                  onPress={confirmInstall}
                  style={!wide && styles.flex1}
                />
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Browse a marketplace */}
      <Modal statusBarTranslucent navigationBarTranslucent visible={!!market} animationType="slide" onRequestClose={closeMarket}>
        {market && (
          <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 4 }}>
            <View style={styles.modalHeader}>
              <IconButton name="x" label="Close" onPress={closeMarket} />
              <Text style={[TYPE.headline, { color: theme.ink }]}>Marketplace</Text>
              <View style={styles.headerSpacer} />
            </View>

            <View style={column}>
              <View style={styles.marketHead}>
                <IconTile name="shopping-bag" size={48} />
                <View style={styles.flex1}>
                  <Text style={[TYPE.title, { color: theme.ink }]} numberOfLines={2}>
                    {market.name}
                  </Text>
                  <Text style={[TYPE.caption, { color: theme.inkMuted }]} numberOfLines={1}>
                    {[market.owner && `By ${market.owner}`, plural(market.entries.length, 'plugin')].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
              {!!market.description && (
                <Text style={[styles.lede, { color: theme.inkMuted, marginTop: SPACE[3] }]} numberOfLines={3}>
                  {market.description}
                </Text>
              )}
              <View style={styles.searchWrap}>
                <SearchField
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search plugins"
                  accessibilityLabel="Search plugins"
                  inputStyle={query ? styles.searchWithClear : undefined}
                />
                {!!query && (
                  <Pressable onPress={() => setQuery('')} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear search">
                    <Icon name="x-circle" size={16} color={theme.inkFaint} />
                  </Pressable>
                )}
              </View>
            </View>

            <FlatList
              data={entries}
              keyExtractor={(e) => e.name}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={[column, { paddingTop: SPACE[3], paddingBottom: insets.bottom + SPACE[6] }]}
              ItemSeparatorComponent={Gap}
              ListEmptyComponent={
                market.entries.length ? (
                  <EmptyState icon="search" title="No plugins match your search">
                    Try another word.
                  </EmptyState>
                ) : (
                  <EmptyState icon="shopping-bag" title="This marketplace has no plugins">
                    Check back later, or try another marketplace.
                  </EmptyState>
                )
              }
              renderItem={({ item }) => {
                const installed = installedFrom(market, item);
                const entryError = entryErrors[item.name];
                const title = item.displayName ?? item.name;
                return (
                  <View style={[styles.entry, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                    <IconTile name="layers" />
                    <View style={styles.cardText}>
                      <Text style={[styles.cardTitle, { color: theme.ink }]} numberOfLines={1}>
                        {title}
                      </Text>
                      {!!item.version && <Text style={[styles.mono, { color: theme.inkFaint }]}>v{item.version}</Text>}
                      {!!item.description && (
                        <Text style={[TYPE.caption, styles.gap2, { color: theme.inkMuted }]} numberOfLines={2}>
                          {item.description}
                        </Text>
                      )}
                      {!!item.category && (
                        <View style={styles.chipRow}>
                          <Chip>{item.category}</Chip>
                        </View>
                      )}
                      {!item.supported && (
                        <Note icon="slash" color={theme.inkFaint}>
                          Not available on mobile{item.reason ? `: ${item.reason}` : ''}
                        </Note>
                      )}
                      {!!entryError && (
                        <Note icon="alert-circle" color={theme.danger}>
                          {entryError}
                        </Note>
                      )}
                    </View>
                    {installed ? (
                      <Pressable
                        onPress={() => {
                          closeMarket();
                          openPlugin(installed.id);
                        }}
                        hitSlop={4}
                        style={({ pressed, hovered }: PressState) => [styles.installed, (pressed || hovered) && { backgroundColor: theme.fill }]}
                        accessibilityRole="button"
                        accessibilityLabel={`${title} is installed. Open it`}
                      >
                        <Icon name="check" size={16} color={theme.success} />
                        <Text style={[TYPE.caption, { color: theme.success }]}>Installed</Text>
                        <Icon name="chevron-right" size={16} color={theme.inkFaint} />
                      </Pressable>
                    ) : item.supported ? (
                      <PillButton
                        title="Install"
                        size="sm"
                        variant="secondary"
                        loading={installingEntry === item.name}
                        disabled={!!installingEntry}
                        onPress={() => installEntry(item)}
                      />
                    ) : null}
                  </View>
                );
              }}
            />
          </View>
        )}
      </Modal>
    </View>
  );
}

function Gap() {
  return <View style={{ height: SPACE[2] }} />;
}

/** A small icon and a line of text under an item: why it can't be installed, or what went wrong. */
function Note({ icon, color, children }: { icon: IconName; color: string; children: ReactNode }) {
  return (
    <View style={styles.noteRow}>
      <Icon name={icon} size={14} color={color} style={styles.noteIcon} />
      <Text style={[styles.small, styles.flex1, { color }]}>{children}</Text>
    </View>
  );
}

/** An installed plugin: the card opens it; the switch beside it turns it on or off. */
function InstalledCard({ plugin: p, onToggle }: { plugin: Plugin; onToggle: (enabled: boolean) => void }) {
  const theme = useTheme();
  const name = p.displayName ?? p.name;
  const needsSetup = missingConfig(p).length > 0;
  const meta = [p.version && `v${p.version}`, pluginOrigin(p)].filter(Boolean).join(' · ');
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        onPress={() => openPlugin(p.id)}
        style={({ pressed, hovered }: PressState) => [styles.cardMain, (pressed || hovered) && { backgroundColor: theme.fill }]}
        accessibilityRole="button"
        accessibilityLabel={needsSetup ? `${name}, needs setup` : name}
        accessibilityHint="Opens the plugin"
      >
        <IconTile name="layers" />
        <View style={styles.cardText}>
          <Text style={[styles.cardTitle, { color: theme.ink }]} numberOfLines={1}>
            {name}
          </Text>
          {!!meta && (
            <Text style={[styles.mono, { color: theme.inkFaint }]} numberOfLines={1}>
              {meta}
            </Text>
          )}
          {!!p.description && (
            <Text style={[TYPE.caption, styles.gap2, { color: theme.inkMuted }]} numberOfLines={2}>
              {p.description}
            </Text>
          )}
          <View style={styles.cardFoot}>
            <Text style={[styles.small, styles.shrink, { color: theme.inkFaint }]} numberOfLines={1}>
              {metaLine(p)}
            </Text>
            {needsSetup && <StatusBadge tone="warning">Needs setup</StatusBadge>}
          </View>
        </View>
        <Icon name="chevron-right" size={16} color={theme.inkFaint} style={styles.chevron} />
      </Pressable>
      <View style={[styles.switchZone, { borderLeftColor: theme.border }]}>
        <ClaySwitch value={p.enabled} onValueChange={onToggle} label={`Use ${name}`} />
      </View>
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
      <View style={styles.marketHead}>
        <IconTile name="layers" size={48} />
        <View style={styles.flex1}>
          <Text style={[TYPE.headline, { color: theme.ink }]} numberOfLines={2} accessibilityRole="header">
            {plugin.displayName ?? plugin.name}
          </Text>
          {(!!plugin.version || !!plugin.author) && (
            <Text style={[TYPE.caption, { color: theme.inkMuted }]} numberOfLines={1}>
              {[plugin.version && `v${plugin.version}`, plugin.author && `By ${plugin.author}`].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
      </View>
      {!!plugin.description && <Text style={[styles.lede, { color: theme.inkMuted, marginTop: SPACE[3] }]}>{plugin.description}</Text>}
      {reinstall && (
        <Text style={[TYPE.caption, styles.noteSm, { color: theme.inkFaint }]}>
          Already installed. Installing again updates it and keeps your settings.
        </Text>
      )}

      <SectionLabel>What’s inside</SectionLabel>
      {parts.length ? (
        <Card>
          {parts.map((part, i) => (
            <View key={part.label}>
              {i > 0 && <Divider inset={44} />}
              <View style={styles.partRow}>
                <Icon name={part.icon} size={16} />
                <View style={styles.flex1}>
                  <Text style={[TYPE.callout, { color: theme.ink }]}>{part.label}</Text>
                  <Text style={[styles.mono, { color: theme.inkFaint }]} numberOfLines={2}>
                    {part.names.join(', ')}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </Card>
      ) : (
        <Text style={[styles.lede, { color: theme.inkMuted }]}>No skills, commands, agents or tools that work on a phone.</Text>
      )}

      {plugin.unsupported.length > 0 && (
        <>
          <SectionLabel>Not available on mobile</SectionLabel>
          <View style={styles.bullets}>
            {plugin.unsupported.map((u) => (
              <View key={u} style={styles.bullet}>
                <Icon name="slash" size={14} color={theme.inkFaint} />
                <Text style={[styles.lede, styles.flex1, { color: theme.inkMuted }]}>{u}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {plugin.userConfig.length > 0 && (
        <>
          <SectionLabel>Settings it asks for</SectionLabel>
          <View style={styles.bullets}>
            {plugin.userConfig.map((f) => (
              <View key={f.key} style={styles.bullet}>
                <Icon name={f.sensitive ? 'lock' : 'sliders'} size={14} color={theme.inkFaint} />
                <Text style={[styles.lede, styles.flex1, { color: theme.ink }]} numberOfLines={1}>
                  {f.title || f.key}
                </Text>
                {f.required && <StatusBadge tone="neutral">Required</StatusBadge>}
              </View>
            ))}
          </View>
          <Text style={[TYPE.caption, styles.noteSm, { color: theme.inkFaint }]}>
            {missing.length ? 'You can fill these in after installing.' : 'Optional — you can change these after installing.'}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  shrink: { flexShrink: 1 },
  gap2: { marginTop: 2 },
  page: { paddingTop: SPACE[2], paddingBottom: SPACE[12] },
  firstLabel: { marginTop: 0 },
  list: { gap: SPACE[2] },
  noteSm: { marginTop: SPACE[2] },
  lede: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 16 },
  mono: { fontFamily: FONT.mono, fontSize: 12, lineHeight: 16 },
  chevron: { alignSelf: 'center' },
  card: { flexDirection: 'row', alignItems: 'stretch', borderRadius: RADIUS.md, borderWidth: 1, overflow: 'hidden' },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[3], padding: SPACE[3] },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACE[2], marginTop: 4 },
  switchZone: { justifyContent: 'center', paddingHorizontal: SPACE[3], borderLeftWidth: StyleSheet.hairlineWidth },
  storeCard: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], padding: SPACE[3], borderRadius: RADIUS.md, borderWidth: 1 },
  entry: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[3], padding: SPACE[3], borderRadius: RADIUS.md, borderWidth: 1 },
  chipRow: { flexDirection: 'row', marginTop: 6 },
  installed: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: SIZE.controlSm, paddingHorizontal: 8, borderRadius: RADIUS.pill },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  noteIcon: { marginTop: 1 },
  formRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[2] },
  formButton: { minHeight: 48 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropWide: { justifyContent: 'center', alignItems: 'center', padding: SPACE[4] },
  sheet: { maxHeight: '90%', borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, paddingHorizontal: SPACE[5], paddingTop: SPACE[2] },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    borderRadius: RADIUS.lg,
    paddingTop: SPACE[5],
    paddingHorizontal: SPACE[6],
    paddingBottom: SPACE[6],
  },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: SPACE[3] },
  sheetScroll: { flexGrow: 0 },
  actions: { flexDirection: 'row', gap: SPACE[2], paddingTop: SPACE[3] },
  actionsWide: { justifyContent: 'flex-end' },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], paddingHorizontal: SPACE[4], paddingVertical: 10, minHeight: 52 },
  bullets: { gap: SPACE[2] },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  headerSpacer: { width: SIZE.controlMd },
  marketHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE[3], marginTop: 4 },
  searchWrap: { marginTop: SPACE[4] },
  clear: { position: 'absolute', right: 0, top: 0, bottom: 0, width: SIZE.controlMd, alignItems: 'center', justifyContent: 'center' },
  searchWithClear: { paddingRight: 32 },
});
