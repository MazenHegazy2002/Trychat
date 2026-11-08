import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Text } from '../components/Text';
import {
  Card,
  Chip,
  ClaySwitch,
  Divider,
  Icon,
  IconButton,
  IconTile,
  PillButton,
  ScreenIntro,
  SectionLabel,
  StatusBadge,
  TextAction,
  TextField,
} from '../components/ui';
import { placeholders } from '../lib/catalog';
import { uid } from '../lib/id';
import { mcpTransport } from '../lib/mcp';
import { useStore } from '../lib/store';
import { FONT, RADIUS, SIZE, TYPE, WIDE_BREAKPOINT, shadow, useTheme } from '../lib/theme';
import type { McpServer } from '../lib/types';

/** Host of a URL without credentials or query (plugin URLs can carry secrets). */
const hostOf = (url: string) => url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]+)/i)?.[1] ?? url;

const blank = (): McpServer => ({ id: uid(), name: '', url: '', token: '', enabled: true, confirm: true, updatedAt: Date.now() });

/** A header being edited; `id` keeps the row (and its keyboard focus) stable while its name changes. */
interface HeaderRow {
  id: string;
  name: string;
  value: string;
}

/** Characters an HTTP header name may use (RFC 9110 token). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** What's wrong with the headers being edited, or '' when they can be saved. */
function headersProblem(rows: HeaderRow[]): string {
  const seen = new Set<string>();
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) {
      if (r.value.trim()) return 'Give every header a name.';
      continue;
    }
    if (!HEADER_NAME.test(name)) return `“${name}” isn’t a valid header name (letters, digits and dashes, no spaces).`;
    if (/[\r\n]/.test(r.value)) return `The value of ${name} can’t contain line breaks.`;
    if (seen.has(name.toLowerCase())) return `${name} is listed twice.`;
    seen.add(name.toLowerCase());
  }
  return '';
}

export default function McpScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const { mcpServers, pluginServers, plugins, mcpTools, mcpErrors, saveMcpServer, deleteMcpServer, refreshMcpTools } = useStore();
  const [draft, setDraft] = useState<McpServer | null>(null);
  /** The draft's headers and URL keys (decoded). Like the token, they stay on this device: sync strips them. */
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([]);
  const [urlKeys, setUrlKeys] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState<string | null>(null);

  /** {name} placeholders in the URL, filled from device-only values when connecting (e.g. an API key). */
  const urlKeyNames = draft ? placeholders(draft.url) : [];
  const headerError = headersProblem(headerRows);
  const canSave = !!draft && !!draft.name.trim() && /^https?:\/\/\S+$/.test(draft.url) && !headerError;
  const editingExisting = !!draft && mcpServers.some((x) => x.id === draft.id);

  const edit = (server: McpServer | null) => {
    setDraft(server);
    setHeaderRows(Object.entries(server?.headers ?? {}).map(([name, value]) => ({ id: uid(), name, value })));
    // Stored percent-encoded, ready for the URL; edited as typed.
    setUrlKeys(Object.fromEntries(Object.entries(server?.urlSecrets ?? {}).map(([k, v]) => [k, safeDecode(v)])));
    setRevealed({});
  };

  const setHeader = (id: string, patch: Partial<HeaderRow>) => setHeaderRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = () => {
    if (!draft || !canSave) return;
    const headers = Object.fromEntries(
      headerRows.filter((r) => r.name.trim() && r.value.trim()).map((r) => [r.name.trim(), r.value.trim()]),
    );
    const urlSecrets = Object.fromEntries(urlKeyNames.map((k) => [k, encodeURIComponent((urlKeys[k] ?? '').trim())]));
    saveMcpServer({
      ...draft,
      name: draft.name.trim(),
      headers: Object.keys(headers).length ? headers : undefined,
      urlSecrets: urlKeyNames.length ? urlSecrets : undefined,
    });
    edit(null);
  };

  /** A masked field for a key, with a Show / Hide text button at its end. */
  const secretInput = (id: string, label: string, value: string, onChange: (v: string) => void, placeholder = '', fieldLabel?: string) => {
    const shown = !!revealed[id];
    return (
      <TextField
        label={fieldLabel}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!shown}
        accessibilityLabel={label}
        mono
        right={
          <Pressable
            onPress={() => setRevealed((r) => ({ ...r, [id]: !shown }))}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={shown ? `Hide ${label}` : `Show ${label}`}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.fieldAction,
              { backgroundColor: pressed || hovered ? theme.surfaceRaised : 'transparent' },
            ]}
          >
            <Text style={[TYPE.subhead, { color: theme.accent }]}>{shown ? 'Hide' : 'Show'}</Text>
          </Pressable>
        }
      />
    );
  };

  const refresh = async (id: string) => {
    setRefreshing(id);
    await refreshMcpTools(id);
    setRefreshing(null);
  };

  const remove = (server: McpServer) =>
    Alert.alert('Remove server?', server.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteMcpServer(server.id) },
    ]);

  const form = draft && (
    <View style={{ gap: 16 }}>
      <View style={styles.formHead}>
        <Text style={[TYPE.headline, { color: theme.ink, flex: 1 }]} accessibilityRole="header">
          {editingExisting ? 'Edit server' : 'Add MCP server'}
        </Text>
        {wide && <IconButton name="x" label="Close" onPress={() => edit(null)} style={{ marginRight: -8 }} />}
      </View>
      {/* "Name" stays a plain label: tapping it dismisses the keyboard (the scroll view only keeps taps it handles). */}
      <TextField
        label="Name"
        value={draft.name}
        onChangeText={(name) => setDraft({ ...draft, name })}
        placeholder="e.g. Docs search"
        accessibilityLabel="Server name"
      />
      <TextField
        label="Server URL"
        value={draft.url}
        onChangeText={(url) => setDraft({ ...draft, url: url.trim() })}
        placeholder="https://example.com/mcp"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        mono
      />
      <View style={styles.inlineSwitch}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[TYPE.callout, { color: theme.ink }]}>Legacy SSE transport</Text>
          <Text style={[TYPE.caption, { color: theme.inkMuted, marginTop: 2 }]}>For older servers, usually at a URL ending in /sse</Text>
        </View>
        <ClaySwitch
          value={mcpTransport(draft) === 'sse'}
          onValueChange={(v) => setDraft({ ...draft, transport: v ? 'sse' : 'http' })}
          label="Legacy SSE transport"
        />
      </View>
      {secretInput(
        'token',
        'Access token',
        draft.token ?? '',
        (token) => setDraft({ ...draft, token: token.trim() }),
        'Sent as Authorization: Bearer …',
        'Access token (optional)',
      )}

      {urlKeyNames.map((key) => (
        <View key={key}>
          {secretInput(`url:${key}`, key, urlKeys[key] ?? '', (v) => setUrlKeys((k) => ({ ...k, [key]: v })), '', `${key} (in the URL)`)}
        </View>
      ))}

      <View style={{ gap: 8 }}>
        <Text style={{ color: theme.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: '500' }}>Headers (optional)</Text>
        {headerRows.map((row) => (
          <View key={row.id} style={[styles.headerBox, { borderColor: theme.border }]}>
            <View style={styles.headerNameRow}>
              <TextField
                style={{ flex: 1 }}
                value={row.name}
                onChangeText={(name) => setHeader(row.id, { name })}
                placeholder="Name, e.g. X-API-Key"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Header name"
                mono
              />
              <IconButton
                name="x"
                label={`Remove header ${row.name.trim()}`}
                onPress={() => setHeaderRows((rows) => rows.filter((r) => r.id !== row.id))}
              />
            </View>
            {secretInput(`header:${row.id}`, `${row.name.trim() || 'Header'} value`, row.value, (value) => setHeader(row.id, { value }), 'Value')}
          </View>
        ))}
        <View style={{ alignSelf: 'flex-start' }}>
          <TextAction title="Add header" onPress={() => setHeaderRows((rows) => [...rows, { id: uid(), name: '', value: '' }])} />
        </View>
        {!!headerError && <Text style={[TYPE.caption, { color: theme.danger }]}>{headerError}</Text>}
        {!!draft.token?.trim() && headerRows.some((r) => r.name.trim().toLowerCase() === 'authorization') && (
          <Text style={[TYPE.caption, { color: theme.inkFaint }]}>The access token replaces the Authorization header.</Text>
        )}
      </View>

      <Text style={[TYPE.caption, { color: theme.inkFaint }]}>
        The token, header values and URL keys stay on this device; the server list syncs.
      </Text>
      <View style={[styles.formButtons, wide && { justifyContent: 'flex-end' }]}>
        <PillButton title="Cancel" variant="secondary" onPress={() => edit(null)} style={!wide && { flex: 1 }} />
        <PillButton title={editingExisting ? 'Save' : 'Add server'} disabled={!canSave} onPress={save} style={!wide && { flex: 1 }} />
      </View>
    </View>
  );

  const toolsLabel = (n: number) => `${n} tool${n === 1 ? '' : 's'}`;

  return (
    <>
      <KeyboardAwareScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={[styles.page, { paddingHorizontal: wide ? 24 : 16, paddingTop: wide ? 24 : 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <ScreenIntro title="Connect more tools">
          Add remote MCP servers and their tools show up in chat. You approve each call unless you turn that off.
        </ScreenIntro>

        <View style={{ gap: 12 }}>
          {mcpServers.map((server) => {
            // On phones the edit form opens in place of the server's card.
            if (!wide && draft && draft.id === server.id) {
              return (
                <Card key={server.id} style={styles.formCard}>
                  {form}
                </Card>
              );
            }
            const tools = mcpTools[server.id];
            const error = mcpErrors[server.id];
            return (
              <Card key={server.id}>
                <View style={styles.head}>
                  <IconTile name="server" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '600' }]} numberOfLines={1}>
                      {server.name}
                    </Text>
                    <Text style={[styles.mono, { color: theme.inkMuted }]} numberOfLines={1}>
                      {server.url}
                    </Text>
                  </View>
                  <ClaySwitch value={server.enabled} onValueChange={(v) => saveMcpServer({ ...server, enabled: v })} label={`Use ${server.name}`} />
                </View>

                <View style={styles.statusBlock}>
                  {!server.enabled ? (
                    <View style={styles.status}>
                      <StatusBadge tone="neutral">Off</StatusBadge>
                      <Text style={[TYPE.caption, { color: theme.inkMuted, flex: 1 }]}>Its tools aren’t offered to the model.</Text>
                    </View>
                  ) : error ? (
                    <View style={{ gap: 6 }}>
                      <View style={{ alignSelf: 'flex-start' }}>
                        <StatusBadge tone="danger">Failed</StatusBadge>
                      </View>
                      <Text style={[TYPE.caption, { color: theme.danger }]}>{error}</Text>
                    </View>
                  ) : tools ? (
                    <>
                      <View style={styles.status}>
                        <StatusBadge tone="success">Connected</StatusBadge>
                        <Text style={[TYPE.caption, { color: theme.inkMuted }]}>{toolsLabel(tools.length)}</Text>
                      </View>
                      {tools.length > 0 && (
                        <View style={styles.chips}>
                          {tools.slice(0, 8).map((t) => (
                            <Chip key={t.name}>{t.name}</Chip>
                          ))}
                          {tools.length > 8 && <Chip>+{tools.length - 8}</Chip>}
                        </View>
                      )}
                    </>
                  ) : (
                    <View style={styles.status}>
                      <StatusBadge tone="running">Connecting…</StatusBadge>
                    </View>
                  )}
                </View>

                <Divider />
                <View style={styles.askRow}>
                  <Text style={[TYPE.callout, { color: theme.ink, flex: 1 }]}>Ask before each call</Text>
                  <ClaySwitch value={server.confirm} onValueChange={(v) => saveMcpServer({ ...server, confirm: v })} label="Ask before each call" />
                </View>
                <Divider />
                <View style={styles.actions}>
                  {refreshing === server.id ? (
                    <ActivityIndicator color={theme.inkMuted} style={{ minHeight: 44 }} />
                  ) : (
                    <TextAction title="Reconnect" onPress={() => refresh(server.id)} />
                  )}
                  <TextAction title={error ? 'Edit keys' : 'Edit'} tone="ink" onPress={() => edit(server)} />
                  <TextAction title="Remove" tone="danger" onPress={() => remove(server)} />
                </View>
              </Card>
            );
          })}
        </View>

        {!wide && draft && !editingExisting ? (
          <Card style={[styles.formCard, { marginTop: mcpServers.length ? 16 : 0 }]}>{form}</Card>
        ) : !draft || wide ? (
          <PillButton title="Add MCP server" icon="plus" onPress={() => edit(blank())} style={{ marginTop: mcpServers.length ? 20 : 0 }} />
        ) : null}

        {pluginServers.length > 0 && (
          <>
            <SectionLabel>From plugins</SectionLabel>
            <Card>
              {pluginServers.map((server, i) => {
                const tools = mcpTools[server.id];
                const error = mcpErrors[server.id];
                const plugin = plugins.find((p) => p.id === server.pluginId);
                return (
                  <View key={server.id}>
                    {i > 0 && <Divider inset={68} />}
                    <View style={styles.pluginRow}>
                      <IconTile name="package" />
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={[TYPE.callout, { color: theme.ink, fontWeight: '600' }]} numberOfLines={1}>
                          {server.name}
                        </Text>
                        <Text style={[styles.mono, { color: theme.inkFaint }]} numberOfLines={1}>
                          {hostOf(server.url)}
                          {plugin ? ` · ${plugin.displayName ?? plugin.name}` : ''}
                        </Text>
                        {error ? (
                          <View style={{ gap: 4, marginTop: 4 }}>
                            <View style={{ alignSelf: 'flex-start' }}>
                              <StatusBadge tone="danger">Failed</StatusBadge>
                            </View>
                            <Text style={[TYPE.caption, { color: theme.danger }]} numberOfLines={3}>
                              {error}
                            </Text>
                          </View>
                        ) : tools ? (
                          <View style={[styles.status, { marginTop: 4 }]}>
                            <StatusBadge tone="success">Connected</StatusBadge>
                            <Text style={[TYPE.caption, { color: theme.inkMuted, flex: 1 }]} numberOfLines={1}>
                              {toolsLabel(tools.length)} · asks before each call
                            </Text>
                          </View>
                        ) : (
                          <View style={[styles.status, { marginTop: 4 }]}>
                            <StatusBadge tone="running">Connecting…</StatusBadge>
                          </View>
                        )}
                      </View>
                      {!!error &&
                        (refreshing === server.id ? (
                          <ActivityIndicator color={theme.inkMuted} style={{ minWidth: 44, minHeight: 44 }} />
                        ) : (
                          <TextAction title="Retry" onPress={() => refresh(server.id)} />
                        ))}
                    </View>
                  </View>
                );
              })}
            </Card>
            <Pressable
              onPress={() => router.push('/plugins')}
              style={styles.manageRow}
              accessibilityRole="link"
              accessibilityLabel="Manage these in Plugins"
            >
              <Text style={[TYPE.caption, { color: theme.inkMuted }]}>Manage these in </Text>
              <Text style={[TYPE.caption, { color: theme.accent, fontWeight: '600' }]}>Plugins</Text>
              <Icon name="chevron-right" size={14} color={theme.accent} />
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollView>

      {/* Wide screens: the same form as a centred 440px dialog over the scrim. */}
      <Modal visible={wide && !!draft} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => edit(null)}>
        <KeyboardAvoidingView behavior="padding" style={[styles.scrim, { backgroundColor: theme.scrim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => edit(null)} accessible={false} />
          <View style={[styles.dialog, { backgroundColor: theme.surfaceRaised }, shadow(theme, 'sheet')]}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent} style={{ borderRadius: RADIUS.lg }}>
              {form}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 48, width: '100%', maxWidth: SIZE.contentMax, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingBottom: 10 },
  mono: { fontFamily: FONT.mono, fontSize: 12, lineHeight: 16, marginTop: 2 },
  statusBlock: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52 },
  actions: { flexDirection: 'row', gap: 24, paddingHorizontal: 16 },
  pluginRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64 },
  manageRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 4 },
  formCard: { padding: 16 },
  formHead: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
  inlineSwitch: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  headerBox: { borderWidth: 1, borderRadius: RADIUS.md, padding: 8, gap: 8 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  formButtons: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  fieldAction: { minHeight: 40, paddingHorizontal: 12, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  dialog: { width: '100%', maxWidth: 440, maxHeight: '90%', borderRadius: RADIUS.lg },
  dialogContent: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 },
});
