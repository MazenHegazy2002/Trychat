import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Chip, ClaySwitch, Divider, Icon, IconTile, PillButton, ScreenIntro, TextAction } from '../components/ui';
import { uid } from '../lib/id';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';
import type { McpServer } from '../lib/types';

const blank = (): McpServer => ({ id: uid(), name: '', url: '', token: '', enabled: true, confirm: true, updatedAt: Date.now() });

export default function McpScreen() {
  const theme = useTheme();
  const { mcpServers, mcpTools, mcpErrors, saveMcpServer, deleteMcpServer, refreshMcpTools } = useStore();
  const [draft, setDraft] = useState<McpServer | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const input = [styles.input, { backgroundColor: theme.bg, color: theme.text, borderColor: theme.border }];
  const canSave = !!draft && !!draft.name.trim() && /^https?:\/\/\S+$/.test(draft.url);

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

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <ScreenIntro title="Connect more tools">
        Add remote MCP servers and their tools show up in chat. You approve each call unless you turn that off.
      </ScreenIntro>

      <View style={{ gap: 12 }}>
        {mcpServers.map((server) => {
          const tools = mcpTools[server.id];
          const error = mcpErrors[server.id];
          return (
            <Card key={server.id}>
              <View style={styles.head}>
                <IconTile name="zap" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '500' }}>{server.name}</Text>
                  <Text style={{ color: theme.muted, fontSize: 12, fontFamily: 'monospace', marginTop: 2 }} numberOfLines={1}>
                    {server.url}
                  </Text>
                </View>
                <ClaySwitch value={server.enabled} onValueChange={(v) => saveMcpServer({ ...server, enabled: v })} label={`Use ${server.name}`} />
              </View>

              <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
                {!server.enabled ? (
                  <Text style={{ color: theme.muted, fontSize: 13 }}>Off — its tools aren't offered to the model.</Text>
                ) : error ? (
                  <View style={styles.status}>
                    <Icon name="alert-circle" size={16} color={theme.danger} />
                    <Text style={{ color: theme.danger, fontSize: 13, flex: 1 }}>{error}</Text>
                  </View>
                ) : tools ? (
                  <>
                    <View style={styles.status}>
                      <Icon name="check-circle" size={16} color={theme.accent} />
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {tools.length} tool{tools.length === 1 ? '' : 's'}
                      </Text>
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
                    <ActivityIndicator size="small" color={theme.muted} />
                    <Text style={{ color: theme.muted, fontSize: 13 }}>Connecting…</Text>
                  </View>
                )}
              </View>

              <Divider />
              <View style={styles.askRow}>
                <Text style={{ color: theme.text, fontSize: 14, flex: 1 }}>Ask before each call</Text>
                <ClaySwitch value={server.confirm} onValueChange={(v) => saveMcpServer({ ...server, confirm: v })} label="Ask before each call" />
              </View>
              <Divider />
              <View style={styles.actions}>
                {refreshing === server.id ? (
                  <ActivityIndicator color={theme.primary} style={{ minHeight: 44 }} />
                ) : (
                  <TextAction title="Reconnect" onPress={() => refresh(server.id)} />
                )}
                <TextAction title={error ? 'Edit token' : 'Edit'} tone="ink" onPress={() => setDraft(server)} />
                <TextAction title="Remove" tone="danger" onPress={() => remove(server)} />
              </View>
            </Card>
          );
        })}
      </View>

      {draft ? (
        <Card style={{ padding: 16, marginTop: 16 }}>
          <Text style={{ color: theme.text, fontFamily: theme.serif, fontSize: 20 }}>
            {mcpServers.some((x) => x.id === draft.id) ? 'Edit server' : 'Add MCP server'}
          </Text>
          <Text style={[styles.label, { color: theme.muted }]}>Name</Text>
          <TextInput value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="e.g. Docs search" placeholderTextColor={theme.faint} style={input} />
          <Text style={[styles.label, { color: theme.muted }]}>Server URL</Text>
          <TextInput
            value={draft.url}
            onChangeText={(url) => setDraft({ ...draft, url: url.trim() })}
            placeholder="https://example.com/mcp"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[input, { fontFamily: 'monospace', fontSize: 14 }]}
          />
          <Text style={[styles.label, { color: theme.muted }]}>Access token (optional)</Text>
          <TextInput
            value={draft.token}
            onChangeText={(token) => setDraft({ ...draft, token: token.trim() })}
            placeholder="Sent as Authorization: Bearer …"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={input}
          />
          <Text style={{ color: theme.faint, fontSize: 12, marginTop: 6 }}>Tokens stay on this device; the server list syncs.</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <PillButton
              title="Save"
              disabled={!canSave}
              onPress={() => {
                if (!canSave) return;
                saveMcpServer({ ...draft, name: draft.name.trim() });
                setDraft(null);
              }}
            />
            <PillButton title="Cancel" variant="secondary" onPress={() => setDraft(null)} />
          </View>
        </Card>
      ) : (
        <PillButton title="Add MCP server" icon="plus" onPress={() => setDraft(blank())} style={{ marginTop: 20 }} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingBottom: 10 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 12 },
  askRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 52 },
  actions: { flexDirection: 'row', gap: 24, paddingHorizontal: 16 },
  label: { fontSize: 13, marginTop: 14, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 48 },
});
