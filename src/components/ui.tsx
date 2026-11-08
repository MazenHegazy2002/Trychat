import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Switch, View } from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';

import { RADIUS, SIZE, TYPE, shadow, useTheme } from '../lib/theme';
import { Text, TextInput } from './Text';

/**
 * TryChat's shared building blocks (the design system's Button, IconButton, TextField, SearchField,
 * Switch, ListRow, Card, StatusBadge, Banner and EmptyState). Screens compose these instead of
 * styling their own, so the whole app keeps one look: charcoal grounds, Geist, and Ember only for
 * the few things that matter.
 */

export type IconName = ComponentProps<typeof Feather>['name'];

/** Feather outline icon; takes the colour of the text it sits with (ink-muted by default). */
export function Icon({ name, size = 20, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return <Feather name={name} size={size} color={color ?? theme.inkMuted} style={style} />;
}

/** The TryChat mark (an Ember chat bubble with a T cut out of it). */
export function Mark({ size = 28 }: { size?: number }) {
  const theme = useTheme();
  return (
    <Image
      source={theme.dark ? require('../../assets/mark.png') : require('../../assets/mark-light.png')}
      style={{ width: size, height: size }}
      accessibilityLabel="TryChat"
    />
  );
}

/** Large screen title with a one-line explanation under it. */
export function ScreenIntro({ title, children }: { title: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={[TYPE.title, { color: theme.ink }]} accessibilityRole="header">
        {title}
      </Text>
      {!!children && <Text style={[TYPE.caption, { color: theme.inkMuted, marginTop: 6, fontSize: 14, lineHeight: 20 }]}>{children}</Text>}
    </View>
  );
}

/** Capitals section label above a group of rows. */
export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <Text style={[TYPE.overline, { color: theme.inkFaint, marginTop: 24, marginBottom: 8, marginHorizontal: 4 }, style]} accessibilityRole="header">
      {children}
    </Text>
  );
}
export const Overline = SectionLabel;

/** Content grouped on `surface` with a hairline border and no shadow. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>{children}</View>;
}

/** Hairline between rows inside a Card. `inset` lines it up with the row text. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: inset }} />;
}

export function IconTile({ name, size = 40 }: { name: IconName; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: theme.fill }]}>
      <Icon name={name} size={Math.round(size * 0.5)} color={theme.ink} />
    </View>
  );
}

/** On/off switch: Ember when on. */
export function ClaySwitch({
  value,
  onValueChange,
  label,
  disabled,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={label}
      // The off track uses border-strong so an off switch still reads as a control (3:1).
      trackColor={{ true: theme.accent, false: theme.borderStrong }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={theme.borderStrong}
    />
  );
}
export const Toggle = ClaySwitch;

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * The design system's Button. One `primary` (Ember) per screen; `secondary` is outlined;
 * `ghost` is text only; `danger` is outlined in red. Disabled buttons are filled and faint, never faded.
 */
export function PillButton({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  style,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const off = disabled && !loading;
  const fg = off
    ? theme.inkFaint
    : variant === 'primary'
      ? theme.onAccent
      : variant === 'danger'
        ? theme.danger
        : variant === 'ghost'
          ? theme.accent
          : theme.ink;
  const height = size === 'lg' ? SIZE.controlLg : size === 'sm' ? SIZE.controlSm : SIZE.controlMd;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      hitSlop={size === 'sm' ? 4 : 0}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.pill,
        { minHeight: height, paddingHorizontal: size === 'sm' ? 14 : 20 },
        off
          ? { backgroundColor: theme.fill }
          : variant === 'primary'
            ? { backgroundColor: pressed ? theme.accentPress : hovered ? theme.accentHover : theme.accent }
            : variant === 'ghost'
              ? { backgroundColor: pressed || hovered ? theme.fill : 'transparent' }
              : {
                  backgroundColor: pressed || hovered ? theme.fill : 'transparent',
                  borderWidth: 1,
                  borderColor: variant === 'danger' ? theme.danger : theme.borderStrong,
                },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon && <Feather name={icon} size={size === 'sm' ? 16 : 18} color={fg} />}
          <Text style={[TYPE.subhead, { color: fg, fontSize: size === 'sm' ? 14 : 15, fontFamily: undefined, fontWeight: '600' }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
export const Button = PillButton;

/** Small text action, e.g. "Reconnect" / "Remove". */
export function TextAction({ title, onPress, tone = 'clay' }: { title: string; onPress: () => void; tone?: 'clay' | 'ink' | 'danger' }) {
  const theme = useTheme();
  const color = tone === 'danger' ? theme.danger : tone === 'ink' ? theme.ink : theme.accent;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={{ minHeight: SIZE.controlMd, justifyContent: 'center' }}
    >
      <Text style={{ color, fontSize: 14, fontWeight: '500' }}>{title}</Text>
    </Pressable>
  );
}

/** Icon-only button with a 44px target; always pass the action as `label`. */
export function IconButton({
  name,
  onPress,
  label,
  color,
  size = 20,
  disabled,
  active,
  style,
}: {
  name: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
  disabled?: boolean;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.iconButton,
        { backgroundColor: active ? theme.accentSoft : pressed || hovered ? theme.fill : 'transparent' },
        style,
      ]}
    >
      <Feather name={name} size={size} color={disabled ? theme.inkFaint : (color ?? (active ? theme.accent : theme.inkMuted))} />
    </Pressable>
  );
}

/** Monospace badge (a model id, a command, a branch). */
export function Chip({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: theme.fill }]}>
      <Text style={[TYPE.codeLabel, { color: theme.ink }]}>{children}</Text>
    </View>
  );
}

export type StatusTone = 'success' | 'danger' | 'warning' | 'neutral' | 'running' | 'accent';

/** Short status word on a soft ground: Done, Failed, Needs OK, Running. Never colour alone. */
export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  const theme = useTheme();
  const map: Record<StatusTone, [string, string]> = {
    success: [theme.successSoft, theme.success],
    danger: [theme.dangerSoft, theme.danger],
    warning: [theme.warningSoft, theme.warning],
    neutral: [theme.fill, theme.inkMuted],
    running: [theme.fill, theme.ink],
    accent: [theme.accentSoft, theme.accent],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {tone === 'running' && <View style={[styles.dot, { backgroundColor: theme.accent }]} />}
      <Text style={{ color: fg, fontSize: 12, lineHeight: 16, fontWeight: '500' }}>{children}</Text>
    </View>
  );
}

/** The small Ember dot that marks something running. */
export function RunningDot({ size = 8 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: theme.accent,
        borderWidth: 0,
        boxShadow: `0px 0px 0px 3px ${theme.accentSoft}`,
      } as ViewStyle}
    />
  );
}

/**
 * A row in a grouped list: optional icon, title, subtitle, a value or control on the right, and a
 * chevron when it opens another screen. Pressed rows show `fill`; selected rows `accent-soft`.
 */
export function ListRow({
  icon,
  title,
  subtitle,
  value,
  right,
  onPress,
  chevron,
  selected,
  danger,
  accessibilityLabel,
  accessibilityHint,
  style,
  titleStyle,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  selected?: boolean;
  danger?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  const body = (pressed = false, hovered = false) => (
    <View
      style={[
        styles.row,
        { minHeight: subtitle ? 60 : 48, backgroundColor: selected ? theme.accentSoft : pressed || hovered ? theme.fill : 'transparent' },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={20} color={danger ? theme.danger : selected ? theme.accent : theme.inkMuted} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[TYPE.callout, { color: danger ? theme.danger : theme.ink, fontFamily: undefined }, selected && { fontWeight: '600' }, titleStyle]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text style={[TYPE.caption, { color: theme.inkMuted, fontFamily: undefined }]} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {!!value && (
        <Text style={[TYPE.caption, { color: theme.inkMuted, fontFamily: undefined, maxWidth: '45%' }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {right}
      {chevron && <Icon name="chevron-right" size={16} color={theme.inkFaint} />}
    </View>
  );
  if (!onPress) return body();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint ?? subtitle}
      accessibilityState={{ selected: !!selected }}
    >
      {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => body(pressed, hovered)}
    </Pressable>
  );
}

/** Pill-shaped segmented control; the chosen option sits on `accent-soft`. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  style,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.segmented, { backgroundColor: theme.surface, borderColor: theme.border }, style]}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: on, selected: on }}
            style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.segment,
              { backgroundColor: on ? theme.accentSoft : hovered ? theme.fill : 'transparent' },
            ]}
          >
            <Text style={{ color: on ? theme.ink : theme.inkMuted, fontSize: 14, lineHeight: 20, fontWeight: on ? '600' : '500' }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Rounded search box on `fill` with a search icon. */
export function SearchField({
  style,
  inputStyle,
  ...props
}: TextInputProps & { style?: StyleProp<ViewStyle>; inputStyle?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: theme.fill }, style]}>
      <Icon name="search" size={16} color={theme.inkFaint} />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
        {...props}
        style={[styles.searchInput, { color: theme.ink }, inputStyle]}
      />
    </View>
  );
}

/** Labelled text field: `fill` ground outlined in `border-strong`; Ember while focused; red with a sentence on error. */
export function TextField({
  label,
  error,
  hint,
  mono,
  style,
  inputStyle,
  right,
  ...props
}: TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
  mono?: boolean;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  right?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[{ gap: 6 }, style]}>
      {!!label && <Text style={{ color: theme.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: '500' }}>{label}</Text>}
      <View
        style={[
          styles.field,
          { backgroundColor: theme.fill, borderColor: error ? theme.danger : theme.borderStrong },
          props.multiline && { alignItems: 'flex-start' },
        ]}
      >
        <TextInput
          accessibilityLabel={props.accessibilityLabel ?? label}
          {...props}
          style={[
            styles.fieldInput,
            mono ? TYPE.code : TYPE.callout,
            { color: theme.ink, fontSize: mono ? 14 : 15 },
            props.multiline && { minHeight: 96, textAlignVertical: 'top', paddingVertical: 12 },
            inputStyle,
          ]}
        />
        {right}
      </View>
      {!!error && <Text style={{ color: theme.danger, fontSize: 13, lineHeight: 18 }}>{error}</Text>}
      {!error && !!hint && <Text style={{ color: theme.inkFaint, fontSize: 13, lineHeight: 18 }}>{hint}</Text>}
    </View>
  );
}

/** One-sentence notice with what to do: `info` on surface, `success` / `warning` / `danger` on their soft grounds. */
export function Banner({
  tone = 'info',
  title,
  children,
  icon,
  onPress,
  style,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode;
  icon?: IconName;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [bg, fg, defaultIcon]: [string, string, IconName] =
    tone === 'success'
      ? [theme.successSoft, theme.success, 'check-circle']
      : tone === 'warning'
        ? [theme.warningSoft, theme.warning, 'alert-triangle']
        : tone === 'danger'
          ? [theme.dangerSoft, theme.danger, 'alert-circle']
          : [theme.surface, theme.accent, 'info'];
  const content = (
    <View
      style={[
        styles.banner,
        { backgroundColor: bg },
        tone === 'info' && { borderWidth: 1, borderColor: theme.border },
        style,
      ]}
    >
      <Icon name={icon ?? defaultIcon} size={20} color={fg} />
      <View style={{ flex: 1, gap: 2 }}>
        {!!title && <Text style={{ color: tone === 'info' ? theme.ink : fg, fontSize: 14, lineHeight: 20, fontWeight: '600' }}>{title}</Text>}
        {!!children && <Text style={{ color: theme.ink, fontSize: 14, lineHeight: 20 }}>{children}</Text>}
      </View>
      {onPress && <Icon name="chevron-right" size={16} color={theme.inkFaint} />}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      {content}
    </Pressable>
  );
}

/** Centered empty state: an icon tile, a headline, one sentence and an optional action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  style,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 10 }, style]}>
      {icon && (
        <View style={[styles.emptyIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Icon name={icon} size={24} color={theme.inkMuted} />
        </View>
      )}
      <Text style={[TYPE.headline, { color: theme.ink, textAlign: 'center' }]}>{title}</Text>
      {!!children && <Text style={[TYPE.callout, { color: theme.inkMuted, textAlign: 'center', maxWidth: 360 }]}>{children}</Text>}
      {action && <View style={{ marginTop: 8 }}>{action}</View>}
    </View>
  );
}

/** Floating surface for menus and popovers (`surface-raised` with the raised shadow). */
export function RaisedSurface({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[{ backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderWidth: 1, borderRadius: RADIUS.md }, shadow(theme, 'raised'), style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.md, overflow: 'hidden' },
  tile: { borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  pill: { borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  iconButton: { width: SIZE.controlMd, height: SIZE.controlMd, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  chip: { borderRadius: RADIUS.xs, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.xs, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  segmented: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: RADIUS.md, borderWidth: 1 },
  segment: { flex: 1, minHeight: 40, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: SIZE.controlMd, borderRadius: RADIUS.sm, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 10, outlineStyle: 'none' } as object,
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: RADIUS.sm, borderWidth: 1, paddingLeft: 14, paddingRight: 4 },
  fieldInput: { flex: 1, paddingVertical: 12, paddingRight: 10, outlineStyle: 'none' } as object,
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: RADIUS.md },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
});
