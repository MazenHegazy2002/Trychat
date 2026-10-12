import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import type { SlashCommand } from '../lib/plugins';
import { useTheme } from '../lib/theme';
import { Divider, Icon } from './ui';

/** Monospace face that exists on both platforms ("monospace" alone falls back to the system font on iOS). */
export const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const MAX_ROWS = 30;

/** True while the user is still typing a command name: a leading "/" and no whitespace yet. */
export function isTypingSlashCommand(text: string): boolean {
  return text.startsWith('/') && !/\s/.test(text);
}

export interface SlashMatch {
  command: SlashCommand;
  /** What goes after the "/" — the short name, or "plugin:name" when two plugins share the name. */
  token: string;
}

/**
 * Commands whose name or "plugin:name" contains `query` (case-insensitive). Exact and prefix matches
 * come first, then substring matches; at most 30.
 */
export function matchSlashCommands(query: string, commands: SlashCommand[]): SlashMatch[] {
  const q = query.trim().toLowerCase();
  const nameCount = new Map<string, number>();
  for (const c of commands) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);

  const ranked: (SlashMatch & { rank: number })[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    const full = command.fullName.toLowerCase();
    let rank: number;
    if (!q || name === q || full === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (full.startsWith(q)) rank = 2;
    else if (name.includes(q)) rank = 3;
    else if (full.includes(q)) rank = 4;
    else continue;
    const token = (nameCount.get(command.name) ?? 0) > 1 ? command.fullName : command.name;
    ranked.push({ command, token, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.token.localeCompare(b.token))
    .slice(0, MAX_ROWS)
    .map(({ command, token }) => ({ command, token }));
}

/**
 * Claude-style command picker shown above the composer while the user types "/name".
 * `query` is the text after the slash. Rows keep the keyboard up when tapped.
 */
export function SlashMenu({
  query,
  commands,
  onSelect,
  onOpenPlugins,
  style,
}: {
  query: string;
  commands: SlashCommand[];
  /** Called with the token to insert (without the leading "/"). */
  onSelect: (token: string) => void;
  onOpenPlugins: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const matches = matchSlashCommands(query, commands);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        nestedScrollEnabled
        accessibilityLabel="Slash commands"
      >
        {commands.length === 0 ? (
          <Pressable
            onPress={onOpenPlugins}
            accessibilityRole="button"
            accessibilityLabel="No commands yet. Install a plugin in Settings, Plugins"
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surface2 }]}
          >
            <Icon name="package" size={18} color={theme.muted} />
            <Text style={[styles.flex, { color: theme.muted, fontSize: 14, lineHeight: 20 }]}>
              No commands yet — install a plugin in Settings › Plugins
            </Text>
            <Icon name="chevron-right" size={16} color={theme.faint} />
          </Pressable>
        ) : matches.length === 0 ? (
          <View style={styles.row} accessible accessibilityLabel="No commands match">
            <Icon name="search" size={16} color={theme.faint} />
            <Text style={{ color: theme.muted, fontSize: 14 }}>No commands match</Text>
          </View>
        ) : (
          matches.map(({ command, token }, i) => (
            <View key={`${command.pluginId}/${command.name}/${i}`}>
              {i > 0 && <Divider />}
              <Pressable
                onPress={() => onSelect(token)}
                accessibilityRole="button"
                accessibilityLabel={`/${token}${command.description ? `. ${command.description}` : ''}. From ${command.pluginName}`}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surface2 }]}
              >
                <View style={styles.flex}>
                  <Text numberOfLines={1}>
                    <Text style={{ fontFamily: MONO, fontSize: 14, color: theme.text }}>/{token}</Text>
                    {!!command.argumentHint && (
                      <Text style={{ color: theme.faint, fontSize: 13 }}>{` ${command.argumentHint}`}</Text>
                    )}
                  </Text>
                  {!!command.description && (
                    <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }}>
                      {command.description}
                    </Text>
                  )}
                </View>
                <Text numberOfLines={1} style={[styles.plugin, { color: theme.faint }]}>
                  {command.pluginName}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    maxHeight: 280,
    flexShrink: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0px 6px 20px rgba(20, 20, 19, 0.10)',
  },
  scroll: { flexGrow: 0 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  flex: { flex: 1, minWidth: 0 },
  plugin: { fontSize: 12, maxWidth: '38%', textAlign: 'right' },
});
