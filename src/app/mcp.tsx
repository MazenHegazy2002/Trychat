import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

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

  const input = [styles.input, { backgroundColor: theme.bg, color: theme.text }];

  const refresh = async (id: string) => {
    setRefreshing(id);
    await refreshMcpTools(id);
    setRefreshing(null);
  };

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: theme.muted, lineHeight: 20 }}>
        Connect remote MCP servers (Streamable HTTP) to give TryChat more tools — search, databases, calendars, design
        tools and more. The server list syncs with your account; tokens stay on this device.
      </Text>

      {mcpServers.map((server) => {
        const tools = mcpTools[server.id];
        const error = mcpErrors[server.id];
        return (
          <View key={server.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{server.name}</Text>
                <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {server.url}
                </Text>
              </View>
              <Switch value={server.enabled} onValueChange={(v) => saveMcpServer({ ...server, enabled: v })} />
            </View>
            <Text style={{ color: error ? theme.danger : theme.muted, fontSize: 13, marginTop: 8 }}>
              {!server.enabled
                ? 'Off'
                : error
                  ? error
                  : tools
                    ? `${tools.length} tool${tools.length === 1 ? '' : 's'}: ${tools.map((t) => t.name).slice(0, 8).join(', ')}${tools.length > 8 ? '…' : ''}`
                    : 'Connecting…'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 20, marginTop: 12, alignItems: 'center' }}>
              <Pressable onPress={() => refresh(server.id)} hitSlop={8}>
                {refreshing === server.id ? (
                  <ActivityIndicator color={theme.primary} />
                ) : (
                  <Text style={{ color: theme.primary, fontWeight: '600' }}>Reconnect</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setDraft(server)} hitSlop={8}>
                <Text style={{ color: theme.primary, fontWeight: '600' }}>Edit</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert('Remove server?', server.name, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => deleteMcpServer(server.id) },
                  ])
                }
                hitSlop={8}
              >
                <Text style={{ color: theme.danger, fontWeight: '600' }}>Remove</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {draft ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
            {mcpServers.some((x) => x.id === draft.id) ? 'Edit server' : 'Add MCP server'}
          </Text>
          <Text style={[styles.label, { color: theme.muted }]}>Name</Text>
          <TextInput value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="e.g. Docs" placeholderTextColor={theme.muted} style={input} />
          <Text style={[styles.label, { color: theme.muted }]}>Server URL</Text>
          <TextInput
            value={draft.url}
            onChangeText={(url) => setDraft({ ...draft, url: url.trim() })}
            placeholder="https://example.com/mcp"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={input}
          />
          <Text style={[styles.label, { color: theme.muted }]}>Access token (optional)</Text>
          <TextInput
            value={draft.token}
            onChangeText={(token) => setDraft({ ...draft, token: token.trim() })}
            placeholder="Sent as Authorization: Bearer …"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={input}
          />
          <View style={styles.switchRow}>
            <Text style={{ color: theme.text, flex: 1 }}>Ask before each tool call</Text>
            <Switch value={draft.confirm} onValueChange={(confirm) => setDraft({ ...draft, confirm })} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
            <Pressable
              onPress={() => {
                if (!draft.name.trim() || !/^https?:\/\//.test(draft.url)) return;
                saveMcpServer({ ...draft, name: draft.name.trim() });
                setDraft(null);
              }}
              style={[styles.button, { backgroundColor: theme.text }]}
            >
              <Text style={{ color: theme.bg, fontWeight: '700' }}>Save</Text>
            </Pressable>
            <Pressable onPress={() => setDraft(null)} style={[styles.button, { borderWidth: 1, borderColor: theme.border }]}>
              <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setDraft(blank())} style={[styles.button, { backgroundColor: theme.text, marginTop: 20 }]}>
          <Text style={{ color: theme.bg, fontWeight: '700' }}>＋ Add MCP server</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16, marginTop: 16 },
  label: { fontSize: 13, marginTop: 14, marginBottom: 6 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, minHeight: 44 },
  button: { minHeight: 46, paddingHorizontal: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
});
