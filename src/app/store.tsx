import { Stack, router, useFocusEffect } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Chip, Divider, Icon, IconTile, PillButton, ScreenIntro, SectionLabel } from '../components/ui';
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
import { inspectGithubSource, installFromMarketplace } from '../lib/pluginInstaller';
import type { MarketplaceEntry, MarketplaceInfo } from '../lib/pluginInstaller';
import { findNameConflict, missingConfig, pluginOrigin } from '../lib/plugins';
import { findSkills, importSkill, parseGithubLink } from '../lib/skills';
import type { SkillCandidate } from '../lib/skills';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { Plugin } from '../lib/types';

type Tab = 'plugins' | 'skills' | 'mcp';

// Catalogs fetched this session, so switching tabs doesn't refetch from GitHub.
const marketplaceCache = new Map<string, MarketplaceInfo>();
const skillRepoCache = new Map<string, SkillCandidate[]>();

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

const openPlugin = (id: string) => router.push({ pathname: '/plugins/[id]', params: { id } });

export default function StoreScreen() {
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('plugins');
  // Kept here rather than in PluginsTab, so an open marketplace survives switching tabs.
  const browser = useMarketplaceBrowser();
  const { close: closeMarketplace } = browser;
  const browsing = tab === 'plugins' && !!browser.open;
  const tabs: [Tab, string][] = [
    ['plugins', 'Plugins'],
    ['skills', 'Skills'],
    ['mcp', 'MCP servers'],
  ];

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
      <View style={[styles.segment, { backgroundColor: theme.surface2 }]}>
        {tabs.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={[styles.segmentItem, tab === key && { backgroundColor: theme.surface }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
          >
            <Text style={{ color: tab === key ? theme.text : theme.muted, fontWeight: '600', fontSize: 14 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'plugins' && <PluginsTab browser={browser} />}
      {tab === 'skills' && <SkillsTab />}
      {tab === 'mcp' && <McpTab />}
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
    const repo = `${ref.owner}/${ref.repo}`;
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
    <KeyboardAwareScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenIntro title="Plugin marketplaces">
        Catalogs of Claude Code plugins. Each plugin can add skills, slash commands, agents and MCP servers.
      </ScreenIntro>
      <Card>
        {sources.map((s, i) => (
          <View key={s.repo}>
            {i > 0 && <Divider />}
            <Pressable
              onPress={() => browser.show(s)}
              onLongPress={s.custom ? () => removeMarketplace(s.repo) : undefined}
              style={styles.row}
              accessibilityRole="button"
              accessibilityHint={s.custom ? 'Long-press to remove' : undefined}
            >
              <IconTile name="package" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{s.title}</Text>
                <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                  {s.description}
                </Text>
                <Text style={{ color: theme.faint, fontSize: 12, marginTop: 2, fontFamily: 'monospace' }}>{s.repo}</Text>
              </View>
              <Icon name="chevron-right" size={16} />
            </Pressable>
          </View>
        ))}
      </Card>

      <SectionLabel>Add a marketplace</SectionLabel>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={newRepo}
          onChangeText={(v) => {
            setNewRepo(v);
            if (error) setError('');
          }}
          placeholder="owner/repo or GitHub link"
          placeholderTextColor={theme.faint}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { flex: 1, backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
        />
        <PillButton title="Add" onPress={addMarketplace} loading={adding} disabled={!newRepo.trim()} />
      </View>
      {!!error && <Text style={{ color: theme.danger, marginTop: 8 }}>{error}</Text>}
      <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>
        Any GitHub repo with a .claude-plugin/marketplace.json works. Your marketplaces sync with your account.
      </Text>
    </KeyboardAwareScrollView>
  );
}

/** One marketplace's plugins, with search and Install. */
function MarketplacePage({ source, browser }: { source: CatalogSource; browser: MarketplaceBrowser }) {
  const theme = useTheme();
  const { settings, plugins, installPlugin, uninstallPlugin } = useStore();
  const { market, loading, error, query, setQuery, installing, setInstalling, close } = browser;

  const installedFrom = (m: MarketplaceInfo, entry: MarketplaceEntry) =>
    plugins.find((p) => p.id === `${entry.name}@${m.name}` || (p.marketplace === m.name && p.name === entry.name));

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
    setInstalling(`${entry.name}@${m.name}`);
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
    <KeyboardAwareScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Pressable onPress={close} style={styles.backRow} accessibilityRole="button">
        <Icon name="chevron-left" size={18} color={theme.primary} />
        <Text style={{ color: theme.primary, fontWeight: '600' }}>All marketplaces</Text>
      </Pressable>
      <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 26 }}>{market?.name ?? source.title}</Text>
      <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
        {market?.owner ? `by ${market.owner} · ` : ''}
        {source.repo}
        {market ? ` · ${plural(market.entries.length, 'plugin')}` : ''}
      </Text>
      {!!market?.description && <Text style={{ color: theme.muted, marginTop: 8, lineHeight: 20 }}>{market.description}</Text>}

      {!empty && <SearchBox value={query} onChange={setQuery} placeholder="Search plugins" />}
      {loading && <ActivityIndicator color={theme.primary} style={{ marginTop: 24 }} />}
      {!!error && <Text style={{ color: theme.danger, marginTop: 12 }}>{error}</Text>}

      {empty && (
        <Card style={{ marginTop: 12, padding: 16 }}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>No plugins here yet</Text>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 4 }}>
            This marketplace doesn’t list any plugins right now. Check back later, or try another marketplace.
          </Text>
        </Card>
      )}

      {!!market && !empty && (
        <Card style={{ marginTop: 12 }}>
          {shown.map((entry, i) => {
            const id = `${entry.name}@${market.name}`;
            const installed = installedFrom(market, entry);
            const title = entry.displayName ?? entry.name;
            return (
              <View key={entry.name}>
                {i > 0 && <Divider />}
                <View style={[styles.row, !entry.supported && { opacity: 0.5 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{title}</Text>
                    {!!entry.description && (
                      <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                        {entry.description}
                      </Text>
                    )}
                    <Text style={{ color: theme.faint, fontSize: 12, marginTop: 4 }}>
                      {[entry.category, entry.version && `v${entry.version}`, !entry.supported && entry.reason].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {installed ? (
                    <Pressable
                      onPress={() => openPlugin(installed.id)}
                      style={({ pressed }) => [styles.installed, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${title} is installed. Open it`}
                    >
                      <Icon name="check" size={16} color={theme.accent} />
                      <Text style={{ color: theme.muted, fontSize: 13 }}>Installed</Text>
                      <Icon name="chevron-right" size={14} color={theme.faint} />
                    </Pressable>
                  ) : installing === id ? (
                    <ActivityIndicator color={theme.primary} style={styles.installBtn} />
                  ) : (
                    <PillButton
                      title="Install"
                      disabled={!entry.supported || !!installing}
                      onPress={() => install(market, entry)}
                      style={styles.installBtn}
                    />
                  )}
                </View>
              </View>
            );
          })}
          {!shown.length && <Text style={{ color: theme.muted, padding: 16 }}>No plugins match “{query.trim()}”.</Text>}
        </Card>
      )}
      {entries.length > shown.length && (
        <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>
          Showing {shown.length} of {entries.length} — search to narrow it down.
        </Text>
      )}
      <Text style={{ color: theme.faint, fontSize: 12, marginTop: 16, lineHeight: 17 }}>
        Plugins can add instructions and tools to your chats. Only install plugins from sources you trust — third-party
        marketplaces aren’t reviewed by Anthropic.
      </Text>
    </KeyboardAwareScrollView>
  );
}

// ---------------------------------------------------------------- Skills

function SkillsTab() {
  const theme = useTheme();
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
    <KeyboardAwareScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenIntro title="Skills">Add a single skill without installing a whole plugin.</ScreenIntro>
      <SearchBox value={query} onChange={setQuery} placeholder="Search skills" />
      {BUILTIN_SKILL_REPOS.map((src) => {
        const list = (lists[src.repo] ?? []).filter((c) => !q || `${c.name} ${c.path}`.toLowerCase().includes(q));
        return (
          <View key={src.repo}>
            <SectionLabel>
              {src.title} · {src.publisher}
            </SectionLabel>
            {!lists[src.repo] && !errors[src.repo] && <ActivityIndicator color={theme.primary} style={{ marginVertical: 16 }} />}
            {!!errors[src.repo] && <Text style={{ color: theme.danger }}>{errors[src.repo]}</Text>}
            {!!lists[src.repo] && (
              <Card>
                {list.map((c, i) => {
                  const key = `${src.repo}:${c.path}`;
                  const added = skills.some((k) => k.source?.includes(src.repo) && k.source?.endsWith(c.path));
                  return (
                    <View key={c.path}>
                      {i > 0 && <Divider />}
                      <View style={styles.row}>
                        <IconTile name="layers" />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{c.name}</Text>
                          <Text style={{ color: theme.faint, fontSize: 12, fontFamily: 'monospace' }} numberOfLines={1}>
                            {c.path}
                          </Text>
                        </View>
                        {added ? (
                          <View style={styles.installed}>
                            <Icon name="check" size={16} color={theme.accent} />
                            <Text style={{ color: theme.muted, fontSize: 13 }}>Added</Text>
                          </View>
                        ) : adding === key ? (
                          <ActivityIndicator color={theme.primary} style={styles.installBtn} />
                        ) : (
                          <PillButton
                            title="Add"
                            disabled={!!adding}
                            style={styles.installBtn}
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
                        )}
                      </View>
                    </View>
                  );
                })}
                {!list.length && <Text style={{ color: theme.muted, padding: 16 }}>No skills match.</Text>}
              </Card>
            )}
          </View>
        );
      })}
      <Pressable onPress={() => router.push('/skills')} style={styles.linkRow} accessibilityRole="button">
        <Text style={{ color: theme.primary, fontWeight: '600' }}>Import skills from any GitHub repo</Text>
        <Icon name="chevron-right" size={16} color={theme.primary} />
      </Pressable>
    </KeyboardAwareScrollView>
  );
}

// ---------------------------------------------------------------- MCP servers

function McpTab() {
  const theme = useTheme();
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
    <KeyboardAwareScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenIntro title="MCP servers">
        From the official MCP Registry. Remote servers work on your phone; ones that run on a computer are marked.
      </ScreenIntro>
      <SearchBox value={query} onChange={search} placeholder="Search servers, e.g. notion, github, maps" />
      {!!error && <Text style={{ color: theme.danger, marginTop: 8 }}>{error}</Text>}
      <Card style={{ marginTop: 12 }}>
        {servers.map((s, i) => {
          const remote = bestRemote(s);
          const added = isAdded(s);
          return (
            <View key={s.name}>
              {i > 0 && <Divider />}
              <View style={[styles.row, !remote && { opacity: 0.55 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500' }}>{displayName(s)}</Text>
                  {!!s.description && (
                    <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                      {s.description}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {remote ? <Chip>{remote.type === 'sse' ? 'SSE' : 'Remote'}</Chip> : <Chip>Runs on a computer</Chip>}
                    <Text style={{ color: theme.faint, fontSize: 11, fontFamily: 'monospace' }} numberOfLines={1}>
                      {s.name}
                    </Text>
                  </View>
                </View>
                {added ? (
                  <View style={styles.installed}>
                    <Icon name="check" size={16} color={theme.accent} />
                    <Text style={{ color: theme.muted, fontSize: 13 }}>Added</Text>
                  </View>
                ) : (
                  <PillButton
                    title="Add"
                    disabled={!remote}
                    style={styles.installBtn}
                    onPress={() => (remote && remoteFields(remote).length ? setConfiguring(s) : add(s))}
                  />
                )}
              </View>
            </View>
          );
        })}
        {!servers.length && !loading && <Text style={{ color: theme.muted, padding: 16 }}>No servers found.</Text>}
      </Card>
      {loading && <ActivityIndicator color={theme.primary} style={{ marginTop: 16 }} />}
      {!!cursor && !loading && <PillButton title="Load more" variant="secondary" onPress={more} style={{ marginTop: 12 }} />}
      <Text style={{ color: theme.faint, fontSize: 12, marginTop: 16, lineHeight: 17 }}>
        Added servers appear in Settings › MCP servers, ask before each tool call, and keep keys on this device. Servers
        that need you to sign in with an account (OAuth) aren’t supported yet.
      </Text>

      <ConfigureServer
        server={configuring}
        onClose={() => setConfiguring(null)}
        onSubmit={(values) => {
          if (configuring) add(configuring, values);
          setConfiguring(null);
        }}
      />
    </KeyboardAwareScrollView>
  );
}

/** Asks for the API keys / URL values a registry server needs. */
function ConfigureServer({
  server,
  onClose,
  onSubmit,
}: {
  server: RegistryServer | null;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const remote = server ? bestRemote(server) : undefined;
  const fields: RemoteField[] = remote ? remoteFields(remote) : [];
  return (
    <Modal visible={!!server} animationType="slide" onRequestClose={onClose}>
      {server && <ConfigureBody key={server.name} fields={fields} title={displayName(server)} insetsTop={insets.top} onClose={onClose} onSubmit={onSubmit} theme={theme} />}
    </Modal>
  );
}

function ConfigureBody({
  fields,
  title,
  insetsTop,
  onClose,
  onSubmit,
  theme,
}: {
  fields: RemoteField[];
  title: string;
  insetsTop: number;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((f) => f.defaultValue).map((f) => [f.key, f.defaultValue!])),
  );
  const missing = fields.filter((f) => f.required && !values[f.key]?.trim());
  return (
    <KeyboardAwareScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 20, paddingTop: insetsTop + 12 }} keyboardShouldPersistTaps="handled">
      <View style={styles.modalHeader}>
        <Pressable onPress={onClose} style={styles.headerBtn} accessibilityRole="button">
          <Text style={{ color: theme.muted, fontSize: 16 }}>Cancel</Text>
        </Pressable>
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: '600' }}>Connect</Text>
        <View style={styles.headerBtn} />
      </View>
      <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 24, marginTop: 12 }}>{title}</Text>
      <Text style={{ color: theme.muted, marginTop: 4, lineHeight: 20 }}>This server needs a few details. Keys stay on this device.</Text>
      {fields.map((f) => (
        <View key={f.key}>
          <Text style={{ color: theme.muted, fontSize: 13, marginTop: 16, marginBottom: 6 }}>
            {f.label}
            {f.required ? '' : ' (optional)'}
          </Text>
          {f.choices?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {f.choices.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setValues((v) => ({ ...v, [f.key]: c }))}
                  style={[styles.choice, { borderColor: theme.border, backgroundColor: values[f.key] === c ? theme.oat : theme.surface }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: values[f.key] === c }}
                >
                  <Text style={{ color: theme.text }}>{c}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <TextInput
              value={values[f.key] ?? ''}
              onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))}
              secureTextEntry={f.secret}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
            />
          )}
          {!!f.description && <Text style={{ color: theme.faint, fontSize: 12, marginTop: 4 }}>{f.description}</Text>}
        </View>
      ))}
      <PillButton title="Add server" disabled={missing.length > 0} onPress={() => onSubmit(values)} style={{ marginTop: 24 }} />
    </KeyboardAwareScrollView>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: theme.surface2 }]}>
      <Icon name="search" size={16} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.faint}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ flex: 1, color: theme.text, fontSize: 15, paddingVertical: 10 }}
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 48 },
  segment: { flexDirection: 'row', borderRadius: 999, padding: 4, marginHorizontal: 20, marginTop: 8 },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, marginBottom: 4 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginTop: 16 },
  installBtn: { minHeight: 44, paddingHorizontal: 16 },
  installed: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 48 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerBtn: { minWidth: 60, minHeight: 44, justifyContent: 'center' },
  choice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
});
