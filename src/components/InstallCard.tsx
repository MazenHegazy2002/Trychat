import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ClaySwitch, Icon, PillButton, TextField } from './ui';
import type { ToolApproval } from '../lib/store';
import { useStore } from '../lib/store';
import { parseRef, previewInstall, refName } from '../lib/storeTools';
import type { InstallField, InstallPreview } from '../lib/storeTools';
import { FONT, RADIUS, TYPE, shadow, useTheme } from '../lib/theme';
import type { ToolCall } from '../lib/types';
import { Text } from './Text';

interface Props {
  call: ToolCall;
  onApprove: (extra?: ToolApproval) => void;
  onDeny: () => void;
}

const KIND_TEXT = { plugin: 'Plugin', skill: 'Skill', mcp: 'MCP server' } as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The approval card for store.install: what the item is and adds, why the assistant wants it, and any keys it needs. */
export function InstallCard({ call, onApprove, onDeny }: Props) {
  const theme = useTheme();
  const { settings } = useStore();
  const ref = String(call.args.ref ?? '');
  const reason = typeof call.args.reason === 'string' ? call.args.reason.trim() : '';
  const name = refName(ref);
  const [open, setOpen] = useState(false);

  if (call.status === 'pending') {
    return <PendingInstall key={ref} call={call} ref_={ref} reason={reason} token={settings.githubToken} onApprove={onApprove} onDeny={onDeny} />;
  }

  const done = call.status === 'done';
  const tone = call.status === 'denied' ? theme.inkMuted : call.status === 'error' ? theme.danger : theme.ink;
  const title =
    call.status === 'running'
      ? `Installing ${name}…`
      : done
        ? `Installed ${name}`
        : call.status === 'denied'
          ? `Didn’t install ${name}`
          : `Couldn’t install ${name}`;
  return (
    <View style={[styles.step, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.stepRow, (pressed || hovered) && { backgroundColor: theme.fill }]}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
      >
        {call.status === 'running' ? (
          <ActivityIndicator size="small" color={theme.inkMuted} />
        ) : (
          <Icon
            name={done ? 'check-circle' : call.status === 'denied' ? 'slash' : 'alert-circle'}
            size={16}
            color={done ? theme.success : call.status === 'denied' ? theme.inkMuted : theme.danger}
          />
        )}
        <Text style={{ color: tone, flex: 1, fontSize: 14, lineHeight: 20 }} numberOfLines={open ? undefined : 1}>
          {title}
        </Text>
        {!!call.result && <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.inkFaint} />}
      </Pressable>
      {open && !!call.result && (
        <ScrollView style={[styles.output, { backgroundColor: theme.codeBg }]} nestedScrollEnabled>
          <Text selectable style={[styles.mono, { color: theme.codeInk }]}>
            {call.result}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function PendingInstall({
  call,
  ref_,
  reason,
  token,
  onApprove,
  onDeny,
}: {
  call: ToolCall;
  ref_: string;
  reason: string;
  token: string;
  onApprove: (extra?: ToolApproval) => void;
  onDeny: () => void;
}) {
  const theme = useTheme();
  const { plugins, skills, mcpServers } = useStore();
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState(false);

  const fill = useCallback(
    (p: InstallPreview) => {
      // Defaults, then non-secret values the assistant suggested.
      const given = call.args.config && typeof call.args.config === 'object' ? (call.args.config as Record<string, unknown>) : {};
      const initial: Record<string, string> = {};
      for (const f of p.fields) {
        const v = !f.secret && given[f.key] !== undefined ? given[f.key] : f.defaultValue;
        if (v !== undefined && v !== null) initial[f.key] = String(v);
      }
      setValues((old) => ({ ...initial, ...old }));
      setPreview(p);
    },
    [call.args.config],
  );

  useEffect(() => {
    let live = true;
    previewInstall(ref_, token)
      .then((p) => live && fill(p))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [ref_, token, attempt, fill]);

  const parsed = parseRef(ref_);
  const installed =
    !!parsed &&
    (parsed.kind === 'mcp'
      ? mcpServers.some((m) => m.registryName === parsed.name)
      : parsed.kind === 'plugin'
        ? plugins.some((p) => p.id.startsWith(`${parsed.entry}@`) && p.source.toLowerCase().includes(parsed.repo.toLowerCase()))
        : skills.some((k) => !!k.source?.includes(parsed.repo) && k.source.endsWith(parsed.path)));

  const fields = preview?.fields ?? [];
  const missing = fields.filter((f) => f.required && !values[f.key]?.trim());
  const canInstall = !!preview && preview.worksOnPhone && !missing.length && !sent;

  const install = () => {
    if (!canInstall) return;
    const secrets: Record<string, string> = {};
    const config: Record<string, string> = {};
    for (const f of fields) {
      const v = values[f.key]?.trim();
      if (!v) continue;
      if (f.secret) secrets[f.key] = v;
      else config[f.key] = v;
    }
    setSent(true);
    onApprove({
      ...(Object.keys(config).length ? { args: { config } } : {}),
      ...(Object.keys(secrets).length ? { secrets } : {}),
    });
  };

  const renderField = (f: InstallField) => (
    <View key={f.key} style={{ marginTop: 12 }}>
      <View style={styles.fieldLabel}>
        {f.secret && <Icon name="lock" size={13} color={theme.inkFaint} />}
        <Text style={{ color: theme.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: '500' }}>
          {f.label}
          {f.required ? '' : ' (optional)'}
        </Text>
      </View>
      {f.type === 'boolean' ? (
        <ClaySwitch
          label={f.label}
          value={values[f.key] === 'true'}
          onValueChange={(v) => setValues((x) => ({ ...x, [f.key]: String(v) }))}
        />
      ) : f.choices?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {f.choices.map((c) => {
            const on = values[f.key] === c;
            return (
              <Pressable
                key={c}
                onPress={() => setValues((x) => ({ ...x, [f.key]: c }))}
                hitSlop={2}
                style={[styles.choice, { backgroundColor: on ? theme.accentSoft : theme.fill, borderColor: on ? theme.accent : 'transparent' }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={{ color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: on ? '600' : '500' }}>{c}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <TextField
          value={values[f.key] ?? ''}
          onChangeText={(t) => setValues((x) => ({ ...x, [f.key]: t }))}
          secureTextEntry={f.secret && !shown[f.key]}
          keyboardType={f.type === 'number' ? 'numeric' : 'default'}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={f.secret ? 'Stays on this device' : undefined}
          accessibilityLabel={f.label}
          right={
            f.secret ? (
              <Pressable
                onPress={() => setShown((s) => ({ ...s, [f.key]: !s[f.key] }))}
                hitSlop={4}
                style={styles.eye}
                accessibilityRole="button"
                accessibilityLabel={shown[f.key] ? 'Hide' : 'Show'}
              >
                <Icon name={shown[f.key] ? 'eye-off' : 'eye'} size={18} />
              </Pressable>
            ) : undefined
          }
        />
      )}
      {!!f.description && <Text style={{ color: theme.inkFaint, fontSize: 13, lineHeight: 18, marginTop: 6 }}>{f.description}</Text>}
    </View>
  );

  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.warning }, shadow(theme, 'raised')]}>
      <View style={styles.ask}>
        <Icon name="package" size={16} color={theme.warning} />
        <Text style={{ color: theme.warning, fontSize: 13, lineHeight: 18, fontWeight: '600' }}>
          Store · {parsed ? KIND_TEXT[parsed.kind] : 'Install'} · needs your OK
        </Text>
      </View>
      <Text style={[TYPE.headline, { color: theme.ink, marginTop: 8 }]}>Install {preview?.name ?? refName(ref_)}?</Text>
      {!!preview && (
        <Text style={{ color: theme.inkFaint, fontFamily: FONT.mono, fontSize: 12, lineHeight: 16, marginTop: 2 }} numberOfLines={2}>
          {preview.source}
          {preview.version ? ` · v${preview.version}` : ''}
        </Text>
      )}
      {!!reason && (
        <View style={[styles.reason, { backgroundColor: theme.fill }]}>
          <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: '600' }}>Why the assistant wants it</Text>
          <Text style={{ color: theme.ink, fontSize: 14, marginTop: 2, lineHeight: 20 }}>{reason}</Text>
        </View>
      )}

      {!preview && !error && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <ActivityIndicator size="small" color={theme.inkMuted} />
          <Text style={{ color: theme.inkMuted, fontSize: 13, lineHeight: 18 }}>Checking what it adds…</Text>
        </View>
      )}
      {!!error && <Text style={{ color: theme.danger, marginTop: 12, lineHeight: 20 }}>{error}</Text>}

      {!!preview && (
        <>
          {!!preview.description && (
            <Text style={{ color: theme.ink, fontSize: 14, marginTop: 10, lineHeight: 20 }} numberOfLines={4}>
              {preview.description}
            </Text>
          )}
          <Text style={[TYPE.overline, styles.heading, { color: theme.inkFaint }]}>What it adds</Text>
          {preview.adds.map((a) => (
            <Bullet key={a} icon="plus" text={a} />
          ))}
          {preview.hosts.length > 0 && <Bullet icon="globe" text={`Talks to ${preview.hosts.join(', ')}`} />}
          {preview.notes.map((n) => (
            <Bullet key={n} icon={preview.worksOnPhone ? 'smartphone' : 'alert-triangle'} text={n} />
          ))}
          {installed && <Bullet icon="check" text="Already installed — installing again updates it." />}
          {fields.length > 0 && (
            <>
              <Text style={[TYPE.overline, styles.heading, { color: theme.inkFaint }]}>
                {fields.some((f) => f.secret) ? 'Keys and settings (keys stay on this device)' : 'Settings'}
              </Text>
              {fields.map(renderField)}
            </>
          )}
        </>
      )}

      <View style={styles.buttons}>
        <PillButton title="Not now" variant="secondary" onPress={onDeny} disabled={sent} style={styles.button} />
        {error ? (
          <PillButton
            title="Try again"
            onPress={() => {
              setError('');
              setAttempt((n) => n + 1);
            }}
            style={styles.button}
          />
        ) : (
          <PillButton title="Install" icon="download" onPress={install} disabled={!canInstall} loading={sent} style={styles.button} />
        )}
      </View>
      {!!preview && missing.length > 0 && (
        <Text style={{ color: theme.inkFaint, fontSize: 13, lineHeight: 18, marginTop: 8 }}>Fill in {missing.map((f) => f.label).join(', ')} to install.</Text>
      )}
    </View>
  );
}

function Bullet({ icon, text }: { icon: 'plus' | 'globe' | 'smartphone' | 'alert-triangle' | 'check'; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.bullet}>
      <Icon name={icon} size={16} color={icon === 'alert-triangle' ? theme.danger : theme.inkMuted} style={{ marginTop: 2 }} />
      <Text style={{ color: theme.ink, fontSize: 14, lineHeight: 20, flex: 1 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.md, padding: 16, marginTop: 8 },
  ask: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: { borderWidth: 1, borderRadius: RADIUS.md, marginTop: 8, overflow: 'hidden' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 48 },
  output: { maxHeight: 220, borderRadius: RADIUS.sm, margin: 8, marginTop: 0 },
  mono: { fontFamily: FONT.monoMedium, fontSize: 12, lineHeight: 18, padding: 12 },
  reason: { borderRadius: RADIUS.sm, padding: 12, marginTop: 12 },
  heading: { marginTop: 16, marginBottom: 2 },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 6 },
  fieldLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  eye: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  choice: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  button: { flexGrow: 1, flexBasis: 120 },
});
