import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '../lib/theme';

/** Shared Claude-style building blocks used by the Account, Skills and MCP screens. */

export type IconName = ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const theme = useTheme();
  return <Feather name={name} size={size} color={color ?? theme.muted} />;
}

/** Serif heading with a short muted explanation under it. */
export function ScreenIntro({ title, children }: { title: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontFamily: theme.serif, fontSize: 26, lineHeight: 32, color: theme.text }}>{title}</Text>
      {!!children && <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 6 }}>{children}</Text>}
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '500', marginTop: 24, marginBottom: 8 }}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>{children}</View>
  );
}

/** Hairline between rows inside a Card. */
export function Divider() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }} />;
}

export function IconTile({ name, size = 36 }: { name: IconName; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: theme.surface2 }]}>
      <Icon name={name} size={size * 0.5} color={theme.text} />
    </View>
  );
}

export function ClaySwitch({ value, onValueChange, label }: { value: boolean; onValueChange: (v: boolean) => void; label: string }) {
  const theme = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={label}
      trackColor={{ true: theme.accent, false: theme.oat }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={theme.oat}
    />
  );
}

export function PillButton({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const fg = primary ? theme.bg : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.pill,
        primary
          ? { backgroundColor: disabled ? theme.oat : theme.text }
          : { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon && <Feather name={icon} size={17} color={fg} />}
          <Text style={{ color: fg, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Small text action, e.g. "Reconnect" / "Remove". */
export function TextAction({ title, onPress, tone = 'clay' }: { title: string; onPress: () => void; tone?: 'clay' | 'ink' | 'danger' }) {
  const theme = useTheme();
  const color = tone === 'danger' ? theme.danger : tone === 'ink' ? theme.text : theme.primary;
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: theme.surface2 }]}>
      <Text style={{ color: theme.text, fontSize: 12, fontFamily: 'monospace' }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  tile: { borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pill: { minHeight: 48, borderRadius: 999, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
