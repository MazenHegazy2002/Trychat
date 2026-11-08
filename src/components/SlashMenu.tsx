import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import type { SlashCommand } from '../lib/plugins';
import { FONT, RADIUS, TYPE, shadow, useTheme } from '../lib/theme';
import { Icon } from './ui';
import { Text } from './Text';

/** Geist Mono, for commands and other code-like text. */
export const MONO = FONT.mono;

const MAX_ROWS = 30;

/** True while the user is still typing a command name: a leading "/" and no whitespace yet. */
export function isTypingSlashCommand(text: string): boolean {
  return text.startsWith('/') && !/\s/.test(text);
}

export interface SlashMatch {
  command: SlashCommand;
  /** What goes after the "/" — the short name, or the unique "plugin:name" when "/name" would be ambiguous. */
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
  const fullNames = new Set(commands.map((c) => c.fullName));

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
    // "/name" must resolve to this command (resolveSlashCommand prefers an exact "plugin:name" match).
    const token = (nameCount.get(command.name) ?? 0) > 1 || fullNames.has(command.name) ? command.fullName : command.name;
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
  const rowStyle =
    (highlighted = false) =>
    ({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
      styles.row,
      { backgroundColor: highlighted ? theme.accentSoft : pressed || hovered ? theme.fill : 'transparent' },
    ];

  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }, shadow(theme, 'raised'), style]}>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        nestedScrollEnabled
        accessibilityLabel="Slash commands"
      >
        <Text style={[TYPE.overline, styles.overline, { color: theme.inkFaint }]} accessibilityRole="header">
          Commands
        </Text>
        {commands.length === 0 ? (
          <Pressable
            onPress={onOpenPlugins}
            accessibilityRole="button"
            accessibilityLabel="No commands yet. Install a plugin in Settings, Plugins"
            style={rowStyle()}
          >
            <Icon name="package" size={16} color={theme.inkMuted} />
            <Text style={[styles.flex, { color: theme.inkMuted, fontSize: 14, lineHeight: 20 }]}>
              No commands yet — install a plugin in Settings › Plugins
            </Text>
            <Icon name="chevron-right" size={16} color={theme.inkFaint} />
          </Pressable>
        ) : (
          <>
            {matches.length === 0 ? (
              <View style={styles.row} accessible accessibilityLabel="No commands match">
                <Icon name="search" size={16} color={theme.inkFaint} />
                <Text style={{ color: theme.inkMuted, fontSize: 14, lineHeight: 20 }}>No commands match</Text>
              </View>
            ) : (
              matches.map(({ command, token }, i) => (
                <Pressable
                  key={`${command.pluginId}/${command.name}/${i}`}
                  onPress={() => onSelect(token)}
                  accessibilityRole="button"
                  accessibilityLabel={`/${token}${command.description ? `. ${command.description}` : ''}. From ${command.pluginName}`}
                  style={rowStyle(i === 0)}
                >
                  <View style={styles.flex}>
                    <Text numberOfLines={1}>
                      <Text style={[styles.command, { color: i === 0 ? theme.accent : theme.ink }]}>/{token}</Text>
                      {!!command.argumentHint && <Text style={{ color: theme.inkFaint, fontSize: 13 }}>{` ${command.argumentHint}`}</Text>}
                    </Text>
                    {!!command.description && (
                      <Text numberOfLines={1} style={[TYPE.caption, { color: theme.inkMuted }]}>
                        {command.description}
                      </Text>
                    )}
                  </View>
                  <Text numberOfLines={1} style={[styles.plugin, { color: theme.inkFaint }]}>
                    {command.pluginName}
                  </Text>
                </Pressable>
              ))
            )}
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <Pressable onPress={onOpenPlugins} accessibilityRole="button" accessibilityLabel="Get more commands in Plugins" style={rowStyle()}>
              <Icon name="package" size={16} color={theme.inkMuted} />
              <Text style={[styles.flex, { color: theme.inkMuted, fontSize: 14, lineHeight: 20, fontWeight: '500' }]}>
                Get more commands in Plugins
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { maxHeight: 320, flexShrink: 1, borderWidth: 1, borderRadius: RADIUS.md, padding: 6 },
  scroll: { flexGrow: 0 },
  overline: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.sm },
  flex: { flex: 1, minWidth: 0 },
  command: { fontFamily: FONT.monoMedium, fontSize: 13, lineHeight: 20 },
  plugin: { fontSize: 12, lineHeight: 16, maxWidth: '38%', textAlign: 'right' },
  divider: { height: 1, marginVertical: 6, marginHorizontal: 4 },
});
