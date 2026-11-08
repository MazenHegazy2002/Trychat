import { Stack, router, useFocusEffect } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, BackHandler, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../components/Text';
import { Banner, Chip, EmptyState, Icon, IconTile, PillButton, SearchField, SectionLabel, SegmentedControl, TextField } from '../components/ui';
import type { IconName } from '../components/ui';
import {
  BUILTIN_MARKETPLACES,
  BUILTIN_SKILL_REPOS,
  bestRemote,
  buildRemote,
  displayName,
  placeholders,
  remoteFields,
  remoteTransport,
  searchRegistry,
} from '../lib/catalog';
import type { CatalogSource, RegistryServer, RemoteField } from '../lib/catalog';
import { uid } from '../lib/id';
import { inspectGithubSource, installFromMarketplace, marketplacePluginId } from '../lib/pluginInstaller';
import type { MarketplaceEntry, MarketplaceInfo } from '../lib/pluginInstaller';
import { findNameConflict, missingConfig, pluginOrigin } from '../lib/plugins';
import { findSkills, importSkill, parseGithubLink } from '../lib/skills';
import type { SkillCandidate } from '../lib/skills';
import { useStore } from '../lib/store';
import { FONT, RADIUS, SIZE, SPACE, TYPE, WIDE_BREAKPOINT, shadow, useTheme } from '../lib/theme';
import type { Plugin } from '../lib/types';

type Tab = 'plugins' | 'skills' | 'mcp';

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'plugins', label: 'Plugins' },
  { value: 'skills', label: 'Skills' },
  { value: 'mcp', label: 'MCP servers' },
];

// Catalogs fetched this session, so switching tabs doesn't refetch from GitHub.
const marketplaceCache = new Map<string, MarketplaceInfo>();
const skillRepoCache = new Map<string, SkillCandidate[]>();

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

const openPlugin = (id: string) => router.push({ pathname: '/plugins/[id]', params: { id } });

/** The content column: 16px gutters on phones; on wide screens 24px gutters, at most 760 wide and centred. */
function useColumn() {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const gutter = wide ? SPACE[6] : SPACE[4];
  const column: ViewStyle = { width: '100%', maxWidth: SIZE.contentMax + gutter * 2, alignSelf: 'center', paddingHorizontal: gutter };
  return { wide, column };
}

export default function StoreScreen() {
  const theme = useTheme();
  const { column } = useColumn();
  const [tab, setTab] = useState<Tab>('plugins');
  // Kept here rather than in PluginsTab, so an open marketplace survives switching tabs.
  const browser = useMarketplaceBrowser();
  const { close: closeMarketplace } = browser;
  const browsing = tab === 'plugins' && !!browser.open;

  // While a marketplace is open, Back (header button, iOS swipe, Android back) returns to the list of
  // marketplaces instead of leaving the Store.
  usePreventRemove(browsing, closeMarketplace);
  // Android back also when nothing is under the Store to go back to (then no screen is removed, so the
  // hook above isn't asked). Only while the Store is focused, so Back on a plugin opened from here pops that.
  useFocusEffect(
    useCallback(() => {
      if (!browsing) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        closeMarketplace();
        return true;
      });
      return () => sub.remove();
    }, [browsing, closeMarketplace]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen options={{ title: 'Store' }} />
      <View style={[column, styles.top]}>
        <Text style={[TYPE.caption, { color: theme.inkMuted }]}>Plugins, skills and MCP servers, ready to add.</Text>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} label="Store sections" style={styles.tabs} />
      </View>
      {tab === 'plugins' && <PluginsTab browser={browser} />}
      {tab === 'skills' && <SkillsTab />}
      {tab === 'mcp' && <McpTab />}
    </View>
  );
}

// ---------------------------------------------------------------- Building blocks

/** One catalog item on a `surface` card: icon tile, name, description, details, and an action on the right. */
function ItemCard({
  icon,
  title,
  description,
  meta,
  children,
  right,
  onPress,
  onLongPress,
  accessibilityHint,
}: {
  icon: IconName;
  title: string;
  description?: string;
  meta?: string;
  children?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const body = (active: boolean) => (
    <View style={[styles.item, { backgroundColor: active ? theme.fill : theme.surface, borderColor: theme.border }]}>
      <IconTile name={icon} />
      <View style={styles.itemText}>
        <Text style={[styles.itemTitle, { color: theme.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {!!description && (
          <Text style={[TYPE.caption, { color: theme.inkMuted }]} numberOfLines={2}>
            {description}
          </Text>
        )}
        {!!meta && (
          <Text style={[styles.mono, { color: theme.inkFaint }]} numberOfLines={1}>
            {meta}
          </Text>
        )}
        {children}
      </View>
      {right}
    </View>
  );
  if (!onPress) return body(false);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
    >
      {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => body(pressed || !!hovered)}
    </Pressable>
  );
}

/** "Added" / "Installed": a success check and the word. */
function Done({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.done}>
      <Icon name="check" size={16} color={theme.success} />
      <Text style={[TYPE.caption, { color: theme.success }]}>{label}</Text>
    </View>
  );
}

/** The design system's search field, with a clear button once there is text. */
function ClearableSearch({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  const theme = useTheme();
  return (
    <View>
      <SearchField value={value} onChangeText={onChangeText} placeholder={placeholder} inputStyle={value ? styles.searchWithClear : undefined} />
      {!!value && (
        <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clear}>
          <Icon name="x-circle" size={16} color={theme.inkFaint} />
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- Plugins

/** The marketplace open in the Plugins tab: which one, its catalog once loaded, and the search in it. */
function useMarketplaceBrowser() {
  const { settings } = useStore();
  const token = settings.githubToken;
  const [open, setOpen] = useState<CatalogSource | null>(null);
  const [market, setMarket] = useState<MarketplaceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  /** The plugin being installed, as "name@marketplace". */
  const [installing, setInstalling] = useState<string | null>(null);
  // Bumped whenever a marketplace is opened or closed: a slow load for one that's no longer open is dropped,
  // so it can't replace the page (and the Install buttons) of the marketplace opened since.
  const request = useRef(0);

  const show = useCallback(
    async (source: CatalogSource) => {
      const id = ++request.current;
      setOpen(source);
      setQuery('');
      setError('');
      const cached = marketplaceCache.get(source.repo);
      setMarket(cached ?? null);
      setLoading(!cached);
      if (cached) return;
      try {
        const target = await inspectGithubSource(source.repo, token);
        if (target.kind !== 'marketplace') {
          throw new Error(`${source.repo} is a single plugin, not a marketplace. Install it from Settings › Plugins.`);
        }
        marketplaceCache.set(source.repo, target.marketplace);
        if (id === request.current) setMarket(target.marketplace);
      } catch (e) {
        if (id === request.current) setError(errorText(e));
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [token],
  );

  const close = useCallback(() => {
    request.current++;
    setOpen(null);
    setMarket(null);
    setLoading(false);
    setError('');
    setQuery('');
  }, []);

  return { open, market, loading, error, query, setQuery, installing, setInstalling, show, close };
}

type MarketplaceBrowser = ReturnType<typeof useMarketplaceBrowser>;

function PluginsTab({ browser }: { browser: MarketplaceBrowser }) {
  const theme = useTheme();
  const { column } = useColumn();
  const { settings, updateSettings } = useStore();
  const [newRepo, setNewRepo] = useState('');
  const [adding, setAdding] = useState(false);
  /** Adding a marketplace failed (shown under that form only). */
  const [error, setError] = useState('');

  const custom: CatalogSource[] = settings.marketplaces.map((repo) => ({
    repo,
    title: repo.split('/')[1] ?? repo,
    description: 'Marketplace you added',
    publisher: repo.split('/')[0] ?? '',
    custom: true,
  }));
  const sources = [...BUILTIN_MARKETPLACES, ...custom.filter((c) => !BUILTIN_MARKETPLACES.some((b) => b.repo === c.repo))];

  const addMarketplace = async () => {
    const ref = parseGithubLink(newRepo);
    if (!ref) return setError('Enter a GitHub repo like owner/repo.');
    // Keep a pinned ref (owner/repo#v1, owner/repo@v1): dropping it would list the default branch instead.
    const repo = `${ref.owner}/${ref.repo}${ref.branch ? `#${ref.branch}` : ''}`;
    setAdding(true);
    setError('');
    try {
      const target = await inspectGithubSource(repo, settings.githubToken);
      if (target.kind !== 'marketplace') throw new Error('That repo is a single plugin, not a marketplace. Install it from Settings › Plugins.');
      marketplaceCache.set(repo, target.marketplace);
      await updateSettings((s) => (s.marketplaces.includes(repo) ? {} : { marketplaces: [...s.marketplaces, repo] }));
      setNewRepo('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAdding(false);
    }
  };

  const removeMarketplace = (repo: string) =>
    Alert.alert('Remove marketplace?', `${repo}\nPlugins you installed from it stay installed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => updateSettings((s) => ({ marketplaces: s.marketplaces.filter((r) => r !== repo) })) },
    ]);

  if (browser.open) return <MarketplacePage source={browser.open} browser={browser} />;

  return (
    <KeyboardAwareScrollView contentContainerStyle={[column, styles.page]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <SectionLabel style={styles.firstLabel}>Plugin marketplaces</SectionLabel>
      <View style={styles.list}>
        {sources.map((s) => (
          <ItemCard
            key={s.repo}
            icon="shopping-bag"
            title={s.title}
            description={s.description}
            meta={s.repo}
            onPress={() => browser.show(s)}
            onLongPress={s.custom ? () => removeMarketplace(s.repo) : undefined}
            accessibilityHint={s.custom ? 'Long-press to remove' : s.description}
            right={<Icon name="chevron-right" size={16} color={theme.inkFaint} style={styles.chevron} />}
          />
        ))}
      </View>
      <Text style={[TYPE.caption, styles.note, { color: theme.inkFaint }]}>
        Catalogs of Claude Code plugins. Each plugin can add skills, slash commands, agents and MCP servers.
      </Text>

      <SectionLabel>Add a marketplace</SectionLabel>
      <View style={styles.formRow}>
        <TextField
          value={newRepo}
          onChangeText={(v) => {
            setNewRepo(v);
            if (error) setError('');
          }}
          placeholder="owner/repo or GitHub link"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Marketplace repo"
          error={error}
          style={styles.flex1}
        />
        <PillButton title="Add" variant="secondary" onPress={addMarketplace} loading={adding} disabled={!newRepo.trim()} style={styles.formButton} />
      </View>
      <Text style={[TYPE.caption, styles.noteSm, { color: theme.inkFaint }]}>
        Any GitHub repo with a .claude-plugin/marketplace.json works. Your marketplaces sync with your account.
      </Text>
    </KeyboardAwareScrollView>
  );
}

/** One marketplace's plugins, with search and Install. */
function MarketplacePage({ source, browser }: { source: CatalogSource; browser: MarketplaceBrowser }) {
  const theme = useTheme();
  const { column } = useColumn();
  const { settings, plugins, installPlugin, uninstallPlugin } = useStore();
  const { market, loading, error, query, setQuery, installing, setInstalling, close } = browser;

  const installedFrom = (m: MarketplaceInfo, entry: MarketplaceEntry) =>
    // By id only: the id is scoped by the marketplace's real repo, while its declared name can be faked.
    plugins.find((p) => p.id === marketplacePluginId(m, entry));

  /** Installs `plugin`, then offers to open its settings when it needs values to work. */
  const finishInstall = (plugin: Plugin) => {
    installPlugin(plugin);
    const missing = missingConfig(plugin);
    if (!missing.length) return;
    Alert.alert(`${plugin.displayName ?? plugin.name} needs setup`, `Add ${missing.join(', ')} so it works.`, [
      { text: 'Later', style: 'cancel' },
      { text: 'Set up', onPress: () => openPlugin(plugin.id) },
    ]);
  };

  const install = async (m: MarketplaceInfo, entry: MarketplaceEntry) => {
    if (installing) return;
    setInstalling(marketplacePluginId(m, entry));
    try {
      const plugin = await installFromMarketplace(m, entry, settings.githubToken);
      // The same plugin from another marketplace or repo: their commands and tools would clash.
      const old = findNameConflict(plugins, plugin);
      if (!old) return finishInstall(plugin);
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
              finishInstall(plugin);
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert(`Couldn’t install ${entry.name}`, errorText(e));
    } finally {
      setInstalling(null);
    }
  };

  const q = query.trim().toLowerCase();
  const entries = (market?.entries ?? []).filter(
    (e) => !q || `${e.name} ${e.displayName ?? ''} ${e.description ?? ''} ${e.category ?? ''}`.toLowerCase().includes(q),
  );
  const shown = entries.slice(0, 150);
  const empty = !!market && market.entries.length === 0;

  return (
    <KeyboardAwareScrollView contentContainerStyle={[column, styles.page]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      {!empty && <ClearableSearch value={query} onChangeText={setQuery} placeholder="Search plugins" />}

      <View style={styles.labelRow}>
        <SectionLabel style={styles.rowLabel}>{source.title}</SectionLabel>
        <Pressable
          onPress={close}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="All marketplaces"
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.picker, (pressed || hovered) && { backgroundColor: theme.fill }]}
        >
          <Text style={[TYPE.subhead, { color: theme.accent }]}>All marketplaces</Text>
          <Icon name="chevron-down" size={16} color={theme.accent} />
        </Pressable>
      </View>
      <Text style={[TYPE.caption, { color: theme.inkMuted }]}>
        {market?.owner ? `by ${market.owner} · ` : ''}
        <Text style={styles.monoInline}>{source.repo}</Text>
        {market ? ` · ${plural(market.entries.length, 'plugin')}` : ''}
      </Text>
      {!!market?.description && <Text style={[TYPE.caption, styles.description, { color: theme.inkMuted }]}>{market.description}</Text>}

      {loading && <ActivityIndicator color={theme.inkMuted} style={styles.spinner} />}
      {!!error && (
        <Banner tone="danger" title="Couldn’t open this marketplace" style={styles.block}>
          {error}
        </Banner>
      )}

      {empty && (
        <EmptyState icon="shopping-bag" title="No plugins here yet">
          This marketplace doesn’t list any plugins right now. Check back later, or try another marketplace.
        </EmptyState>
      )}

      {!!market &&
        !empty &&
        (shown.length > 0 ? (
          <View style={[styles.list, styles.block]}>
            {shown.map((entry) => {
              const id = marketplacePluginId(market, entry);
              const installed = installedFrom(market, entry);
              const title = entry.displayName ?? entry.name;
              return (
                <ItemCard
                  key={entry.name}
                  icon="layers"
                  title={title}
                  description={entry.description}
                  meta={[entry.category, entry.version && `v${entry.version}`].filter(Boolean).join(' · ')}
                  right={
                    installed ? (
                      <Pressable
                        onPress={() => openPlugin(installed.id)}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={`${title} is installed. Open it`}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.done,
                          styles.installed,
                          (pressed || hovered) && { backgroundColor: theme.fill },
                        ]}
                      >
                        <Icon name="check" size={16} color={theme.success} />
                        <Text style={[TYPE.caption, { color: theme.success }]}>Installed</Text>
                        <Icon name="chevron-right" size={16} color={theme.inkFaint} />
                      </Pressable>
                    ) : (
                      <PillButton
                        title="Install"
                        size="sm"
                        variant="secondary"
                        loading={installing === id}
                        disabled={!entry.supported || !!installing}
                        onPress={() => install(market, entry)}
                      />
                    )
                  }
                >
                  {!entry.supported && (
                    <View style={styles.noteRow}>
                      <Icon name="slash" size={14} color={theme.inkFaint} style={styles.noteIcon} />
                      <Text style={[styles.small, styles.flex1, { color: theme.inkFaint }]}>{entry.reason ?? 'Not available on mobile.'}</Text>
                    </View>
                  )}
                </ItemCard>
              );
            })}
          </View>
        ) : (
          <EmptyState icon="search" title="No matches">
            No plugins match “{query.trim()}”.
          </EmptyState>
        ))}
      {entries.length > shown.length && (
        <Text style={[TYPE.caption, styles.noteSm, { color: theme.inkFaint }]}>
          Showing {shown.length} of {entries.length} — search to narrow it down.
        </Text>
      )}
      <Text style={[TYPE.caption, styles.note, { color: theme.inkFaint }]}>
        Plugins can add instructions and tools to your chats. Only install plugins from sources you trust — third-party
        marketplaces aren’t reviewed by Anthropic.
      </Text>
    </KeyboardAwareScrollView>
  );
}

// ---------------------------------------------------------------- Skills

function SkillsTab() {
  const theme = useTheme();
  const { column } = useColumn();
  const { skills, saveSkill, settings } = useStore();
  const [lists, setLists] = useState<Record<string, SkillCandidate[]>>(() => Object.fromEntries(skillRepoCache));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    for (const src of BUILTIN_SKILL_REPOS) {
      if (skillRepoCache.has(src.repo)) continue;
      findSkills(src.repo, settings.githubToken)
        .then((c) => {
          skillRepoCache.set(src.repo, c);
          setLists((l) => ({ ...l, [src.repo]: c }));
        })
        .catch((e) => setErrors((x) => ({ ...x, [src.repo]: errorText(e) })));
    }
  }, [settings.githubToken]);

  const q = query.trim().toLowerCase();
  return (
    <KeyboardAwareScrollView contentContainerStyle={[column, styles.page]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <ClearableSearch value={query} onChangeText={setQuery} placeholder="Search skills" />
      {BUILTIN_SKILL_REPOS.map((src) => {
        const list = (lists[src.repo] ?? []).filter((c) => !q || `${c.name} ${c.path}`.toLowerCase().includes(q));
        return (
          <View key={src.repo}>
            <SectionLabel style={styles.groupLabel}>
              {src.title} · {src.publisher}
            </SectionLabel>
            {!lists[src.repo] && !errors[src.repo] && <ActivityIndicator color={theme.inkMuted} style={styles.spinner} />}
            {!!errors[src.repo] && (
              <Banner tone="danger" title={`Couldn’t load ${src.title}`}>
                {errors[src.repo]}
              </Banner>
            )}
            {!!lists[src.repo] &&
              (list.length > 0 ? (
                <View style={styles.list}>
                  {list.map((c) => {
                    const key = `${src.repo}:${c.path}`;
                    const added = skills.some((k) => k.source?.includes(src.repo) && k.source?.endsWith(c.path));
                    return (
                      <ItemCard
                        key={c.path}
                        icon="zap"
                        title={c.name}
                        meta={c.path}
                        right={
                          added ? (
                            <Done label="Added" />
                          ) : (
                            <PillButton
                              title="Add"
                              size="sm"
                              variant="secondary"
                              loading={adding === key}
                              disabled={!!adding}
                              onPress={async () => {
                                setAdding(key);
                                try {
                                  saveSkill(await importSkill(c, `https://github.com/${src.repo}`, settings.githubToken));
                                } catch (e) {
                                  Alert.alert('Couldn’t add skill', errorText(e));
                                } finally {
                                  setAdding(null);
                                }
                              }}
                            />
                          )
                        }
                      />
                    );
                  })}
                </View>
              ) : (
                <EmptyState icon="search" title="No skills match">
                  Try another word, or import skills from any GitHub repo below.
                </EmptyState>
              ))}
          </View>
        );
      })}
      <Text style={[TYPE.caption, styles.note, { color: theme.inkFaint }]}>Add a single skill without installing a whole plugin.</Text>
      <Pressable onPress={() => router.push('/skills')} style={styles.linkRow} accessibilityRole="button">
        <Text style={[TYPE.subhead, styles.flex1, { color: theme.accent }]}>Import skills from any GitHub repo</Text>
        <Icon name="chevron-right" size={16} color={theme.accent} />
      </Pressable>
    </KeyboardAwareScrollView>
  );
}

// ---------------------------------------------------------------- MCP servers

function McpTab() {
  const theme = useTheme();
  const { column } = useColumn();
  const { mcpServers, saveMcpServer } = useStore();
  const [query, setQuery] = useState('');
  const [servers, setServers] = useState<RegistryServer[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configuring, setConfiguring] = useState<RegistryServer | null>(null);
  const searchId = useRef(0);

  // Debounced search; a newer search wins over a slower older one.
  useEffect(() => {
    const id = ++searchId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const r = await searchRegistry(query);
        if (id !== searchId.current) return;
        setServers(r.servers);
        setCursor(r.nextCursor);
      } catch (e) {
        if (id === searchId.current) setError(errorText(e));
      } finally {
        if (id === searchId.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const search = (q: string) => {
    setQuery(q);
    // Results on screen are for the old text until the debounced search lands: no "Load more" for them meanwhile.
    setLoading(true);
  };

  const more = async () => {
    if (!cursor || loading) return;
    // The next page belongs to the search on screen; a search started since makes it stale.
    const id = searchId.current;
    setLoading(true);
    try {
      const r = await searchRegistry(query, cursor);
      if (id !== searchId.current) return;
      setServers((s) => [...s, ...r.servers.filter((x) => !s.some((y) => y.name === x.name))]);
      setCursor(r.nextCursor);
    } catch (e) {
      if (id === searchId.current) setError(errorText(e));
    } finally {
      if (id === searchId.current) setLoading(false);
    }
  };

  const isAdded = (s: RegistryServer) => {
    const remote = bestRemote(s);
    return mcpServers.some((m) => m.registryName === s.name || (!!remote && m.url === remote.url));
  };

  const add = (s: RegistryServer, values: Record<string, string> = {}) => {
    const remote = bestRemote(s);
    if (!remote) return;
    // Pasted keys often carry a stray space or line break.
    const typed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
    // URL variables are percent-encoded, so a value with "/", "?", "#", "&" or spaces can't change the URL's shape
    // (one left empty becomes empty rather than a literal "{name}"). Secret ones go to urlSecrets already encoded:
    // the MCP client fills them into the URL as they are.
    const inUrl = Object.fromEntries(placeholders(remote.url).map((k) => [k, encodeURIComponent(typed[k] ?? '')]));
    const { url, urlSecrets } = buildRemote(remote, { ...typed, ...inUrl });
    const { headers } = buildRemote(remote, typed);
    saveMcpServer({
      id: uid(),
      name: displayName(s),
      url,
      transport: remoteTransport(remote),
      headers: Object.keys(headers).length ? headers : undefined,
      urlSecrets: Object.keys(urlSecrets).length ? urlSecrets : undefined,
      enabled: true,
      confirm: true,
      updatedAt: 0, // saveMcpServer stamps the real time
      registryName: s.name,
    });
  };

  return (
    <>
      <KeyboardAwareScrollView contentContainerStyle={[column, styles.page]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <ClearableSearch value={query} onChangeText={search} placeholder="Search servers, e.g. notion, github, maps" />
        {!!error && (
          <Banner tone="danger" title="Couldn’t reach the MCP Registry" style={styles.block}>
            {`${error.replace(/\.$/, '')}. Check your connection, then search again.`}
          </Banner>
        )}
        <SectionLabel style={styles.groupLabel}>MCP Registry</SectionLabel>
        {servers.length > 0 && (
          <View style={styles.list}>
            {servers.map((s) => {
              const remote = bestRemote(s);
              const added = isAdded(s);
              return (
                <ItemCard
                  key={s.name}
                  icon="server"
                  title={displayName(s)}
                  description={s.description}
                  right={
                    added ? (
                      <Done label="Added" />
                    ) : (
                      <PillButton
                        title="Add"
                        size="sm"
                        variant="secondary"
                        disabled={!remote}
                        onPress={() => (remote && remoteFields(remote).length ? setConfiguring(s) : add(s))}
                      />
                    )
                  }
                >
                  <View style={styles.tags}>
                    <Chip>{remote ? (remote.type === 'sse' ? 'SSE' : 'Remote') : 'Runs on a computer'}</Chip>
                    <Text style={[styles.mono, styles.shrink, { color: theme.inkFaint }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                  </View>
                </ItemCard>
              );
            })}
          </View>
        )}
        {!servers.length && !loading && !error && (
          <EmptyState icon="search" title="No servers found">
            Try another name, like notion or github.
          </EmptyState>
        )}
        {loading && <ActivityIndicator color={theme.inkMuted} style={styles.spinner} />}
        {!!cursor && !loading && <PillButton title="Load more" variant="secondary" onPress={more} style={styles.block} />}
        <Text style={[TYPE.caption, styles.note, { color: theme.inkFaint }]}>
          From the official MCP Registry. Remote servers work on your phone; ones that run on a computer are marked.
        </Text>
        <Text style={[TYPE.caption, styles.noteSm, { color: theme.inkFaint }]}>
          Added servers appear in Settings › MCP servers, ask before each tool call, and keep keys on this device. Servers
          that need you to sign in with an account (OAuth) aren’t supported yet.
        </Text>
      </KeyboardAwareScrollView>

      <ConfigureServer
        server={configuring}
        onClose={() => setConfiguring(null)}
        onSubmit={(values) => {
          if (configuring) add(configuring, values);
          setConfiguring(null);
        }}
      />
    </>
  );
}

/** Asks for the API keys / URL values a registry server needs: a sheet on phones, a centred dialog on wide screens. */
function ConfigureServer({
  server,
  onClose,
  onSubmit,
}: {
  server: RegistryServer | null;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const { wide } = useColumn();
  const remote = server ? bestRemote(server) : undefined;
  const fields: RemoteField[] = remote ? remoteFields(remote) : [];
  return (
    <Modal transparent statusBarTranslucent navigationBarTranslucent visible={!!server} animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      {server && <ConfigureBody key={server.name} fields={fields} title={displayName(server)} wide={wide} onClose={onClose} onSubmit={onSubmit} />}
    </Modal>
  );
}

function ConfigureBody({
  fields,
  title,
  wide,
  onClose,
  onSubmit,
}: {
  fields: RemoteField[];
  title: string;
  wide: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((f) => f.defaultValue).map((f) => [f.key, f.defaultValue!])),
  );
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const missing = fields.filter((f) => f.required && !values[f.key]?.trim());
  const set = (key: string, v: string) => setValues((x) => ({ ...x, [key]: v }));
  const size = wide ? 'md' : 'lg';

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={wide ? 0 : -insets.bottom} style={[styles.backdrop, wide && styles.backdropWide]}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View
        style={[
          wide ? styles.dialog : [styles.sheet, { paddingBottom: insets.bottom + SPACE[4] }],
          { backgroundColor: theme.surfaceRaised },
          shadow(theme, 'sheet'),
        ]}
      >
        {!wide && <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />}
        <Text style={[TYPE.headline, { color: theme.ink }]} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.lede, { color: theme.inkMuted }]}>This server needs a few details. Keys stay on this device.</Text>
        <ScrollView style={styles.formScroll} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {fields.map((f) => {
            const label = f.required ? f.label : `${f.label} (optional)`;
            if (f.choices?.length) {
              return (
                <View key={f.key} style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: theme.inkMuted }]}>{label}</Text>
                  <View style={styles.choices}>
                    {f.choices.map((c) => {
                      const on = values[f.key] === c;
                      return (
                        <Pressable
                          key={c}
                          onPress={() => set(f.key, c)}
                          hitSlop={4}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                            styles.choice,
                            on
                              ? { backgroundColor: theme.accentSoft, borderColor: theme.accent }
                              : { backgroundColor: pressed || hovered ? theme.fill : 'transparent', borderColor: theme.borderStrong },
                          ]}
                        >
                          {on && <Icon name="check" size={16} color={theme.accent} />}
                          <Text style={[TYPE.subhead, { color: theme.ink }, on && styles.semibold]}>{c}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {!!f.description && <Text style={[TYPE.caption, { color: theme.inkFaint }]}>{f.description}</Text>}
                </View>
              );
            }
            return (
              <TextField
                key={f.key}
                label={label}
                hint={f.description}
                value={values[f.key] ?? ''}
                onChangeText={(t) => set(f.key, t)}
                secureTextEntry={f.secret && !shown[f.key]}
                autoCapitalize="none"
                autoCorrect={false}
                right={
                  f.secret ? (
                    <Pressable
                      onPress={() => setShown((s) => ({ ...s, [f.key]: !s[f.key] }))}
                      hitSlop={4}
                      accessibilityRole="button"
                      accessibilityLabel={shown[f.key] ? `Hide ${f.label}` : `Show ${f.label}`}
                      style={styles.reveal}
                    >
                      <Text style={[TYPE.subhead, { color: theme.accent }]}>{shown[f.key] ? 'Hide' : 'Show'}</Text>
                    </Pressable>
                  ) : undefined
                }
              />
            );
          })}
        </ScrollView>
        <View style={[styles.actions, wide && styles.actionsWide]}>
          <PillButton title="Cancel" variant="secondary" size={size} onPress={onClose} style={!wide && styles.flex1} />
          <PillButton title="Connect" size={size} disabled={missing.length > 0} onPress={() => onSubmit(values)} style={!wide && styles.flex1} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  shrink: { flexShrink: 1 },
  semibold: { fontWeight: '600' },
  top: { paddingTop: SPACE[1] },
  tabs: { marginTop: SPACE[4] },
  page: { paddingTop: SPACE[3], paddingBottom: SPACE[12] },
  firstLabel: { marginTop: SPACE[1] },
  groupLabel: { marginTop: SPACE[5] },
  list: { gap: SPACE[2] },
  block: { marginTop: SPACE[3] },
  spinner: { marginVertical: SPACE[6] },
  note: { marginTop: SPACE[4] },
  noteSm: { marginTop: SPACE[2] },
  description: { marginTop: SPACE[1] },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[3], padding: SPACE[3], borderRadius: RADIUS.md, borderWidth: 1 },
  itemText: { flex: 1, minWidth: 0, gap: 2 },
  itemTitle: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  mono: { fontFamily: FONT.mono, fontSize: 12, lineHeight: 16 },
  monoInline: { fontFamily: FONT.mono, fontSize: 12 },
  small: { fontSize: 12, lineHeight: 16 },
  chevron: { alignSelf: 'center' },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: SIZE.controlSm, paddingHorizontal: 4 },
  installed: { borderRadius: RADIUS.pill, paddingHorizontal: 8 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  noteIcon: { marginTop: 1 },
  tags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACE[2] },
  rowLabel: { flex: 1, marginTop: 0, marginBottom: 0 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: SIZE.controlMd,
    paddingHorizontal: SPACE[3],
    marginRight: -SPACE[3],
    borderRadius: RADIUS.pill,
  },
  formRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[2] },
  formButton: { minHeight: 48 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2], minHeight: SIZE.controlMd, marginTop: SPACE[2] },
  clear: { position: 'absolute', right: 0, top: 0, bottom: 0, width: SIZE.controlMd, alignItems: 'center', justifyContent: 'center' },
  searchWithClear: { paddingRight: 32 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropWide: { justifyContent: 'center', alignItems: 'center', padding: SPACE[4] },
  sheet: { maxHeight: '92%', borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, paddingHorizontal: SPACE[5], paddingTop: SPACE[2] },
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
  lede: { fontSize: 14, lineHeight: 20, marginTop: SPACE[1] },
  formScroll: { flexGrow: 0 },
  form: { gap: SPACE[4], paddingTop: SPACE[4], paddingBottom: SPACE[2] },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2] },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: SIZE.controlSm,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  reveal: { minHeight: SIZE.controlMd, paddingHorizontal: 10, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: SPACE[2], paddingTop: SPACE[3] },
  actionsWide: { justifyContent: 'flex-end' },
});
