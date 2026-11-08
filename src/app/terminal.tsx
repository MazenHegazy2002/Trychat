import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardPadded } from '../components/KeyboardPadded';
import { TerminalLog, terminalColors } from '../components/TerminalLog';
import { Banner, EmptyState, IconButton } from '../components/ui';
import { runOnLaptop } from '../lib/laptopStream';
import type { LaptopRunHandle } from '../lib/laptopStream';
import { useStore } from '../lib/store';
import { appendTask, endTask, setTaskCancel, startTask } from '../lib/tasks';
import { FONT, RADIUS, SIZE, useTheme } from '../lib/theme';
import { laptopConnected, laptopInfo } from '../lib/tools';
import { Text, TextInput } from '../components/Text';

/** Marks the end of a command's output, followed by the shell's working folder afterwards. */
const CWD_MARK = '\u001eTRYCHAT_CWD:';
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Interactive shell on the connected laptop: each line runs through the bridge (streaming), cwd is carried over. */
export default function TerminalScreen() {
  const theme = useTheme();
  const term = terminalColors(theme);
  const insets = useSafeAreaInsets();
  const { settings } = useStore();
  const connected = laptopConnected(settings);
  const [log, setLog] = useState('');
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState<string | null>(null);
  const [host, setHost] = useState('laptop');
  const [windows, setWindows] = useState(false);
  const [running, setRunning] = useState<LaptopRunHandle | null>(null);
  const history = useRef<string[]>([]);
  const histPos = useRef(-1);

  useEffect(() => {
    if (!connected) return;
    laptopInfo(settings)
      .then((i) => {
        setHost(i.hostname);
        setWindows(i.platform === 'win32');
        setCwd((c) => c ?? i.root);
        setLog(`Connected to ${i.hostname} (${i.platform}). Commands run on your laptop in ${i.root}.\n`);
      })
      .catch((e) => setLog(`Couldn’t reach the laptop: ${e instanceof Error ? e.message : String(e)}\n`));
  }, [connected, settings]);

  if (!connected) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center' }}>
        <EmptyState icon="terminal" title="The laptop isn’t connected.">
          Start the bridge on your laptop and pair it in Settings → Connections → Laptop.
        </EmptyState>
      </View>
    );
  }

  const run = () => {
    const command = input.trim();
    if (!command || running) return;
    if (command === 'clear') {
      setLog('');
      setInput('');
      return;
    }
    history.current = [command, ...history.current.filter((c) => c !== command)].slice(0, 100);
    histPos.current = -1;
    setInput('');
    setLog((l) => `${l}\x1b[97m${cwd ?? ''} $ ${command}\x1b[0m\n`);
    // POSIX shells: run in the remembered folder and report where the command left us.
    const wrapped =
      windows || !cwd
        ? command
        : `cd ${quote(cwd)} 2>/dev/null; ${command}\n__trychat_s=$?; printf '\\n${CWD_MARK}%s\\n' "$PWD"; exit $__trychat_s`;
    const taskId = startTask({ kind: 'command', title: command });
    let pending = '';
    const h = runOnLaptop(settings, { command: wrapped, cwd: '.' }, (stream, text) => {
      // Hold back a possible partial marker so it never flashes on screen.
      pending += text;
      const mark = pending.indexOf(CWD_MARK);
      let show: string;
      if (mark !== -1) {
        show = pending.slice(0, mark);
        const rest = pending.slice(mark + CWD_MARK.length);
        const nl = rest.indexOf('\n');
        if (nl !== -1) setCwd(rest.slice(0, nl));
        pending = '';
        show = show.replace(/\n$/, '');
      } else {
        const keep = pending.lastIndexOf('\n');
        show = keep === -1 ? '' : pending.slice(0, keep + 1);
        pending = keep === -1 ? pending : pending.slice(keep + 1);
        if (pending.length > 200) {
          show += pending;
          pending = '';
        }
      }
      if (show) {
        const colored = stream === 'stderr' ? `\x1b[91m${show}\x1b[0m` : show;
        setLog((l) => (l + colored).slice(-200_000));
        appendTask(taskId, show);
      }
    });
    setTaskCancel(taskId, h.kill);
    setRunning(h);
    h.done
      .then((r) => {
        if (pending && !pending.startsWith(CWD_MARK)) setLog((l) => l + pending);
        const note = r.killed ? '^C stopped\n' : r.timedOut ? 'timed out — stopped\n' : r.exitCode ? `exit ${r.exitCode}\n` : '';
        if (note) setLog((l) => `${l}\x1b[90m${note}\x1b[0m`);
        endTask(taskId, r.killed ? 'cancelled' : r.exitCode === 0 ? 'done' : 'failed', { exitCode: r.exitCode });
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setLog((l) => `${l}\x1b[91m${msg}\x1b[0m\n`);
        endTask(taskId, 'failed', { output: msg });
      })
      .finally(() => setRunning(null));
  };

  const recall = (dir: 1 | -1) => {
    const next = Math.max(-1, Math.min(history.current.length - 1, histPos.current + dir));
    histPos.current = next;
    setInput(next === -1 ? '' : history.current[next]);
  };

  const canRun = !!input.trim();
  const bottom = Math.max(insets.bottom, 12);
  return (
    <KeyboardPadded bottomInset={bottom} style={{ backgroundColor: theme.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Banner tone="warning" icon="alert-triangle">
          Running on {host}: commands have full access to your laptop
        </Banner>
      </View>
      <TerminalLog text={log} style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 8 }} />
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: bottom, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <IconButton name="arrow-up" label="Previous command" onPress={() => recall(1)} size={18} />
          <IconButton name="arrow-down" label="Next command" onPress={() => recall(-1)} size={18} />
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              minHeight: SIZE.controlMd + 8,
              paddingLeft: 14,
              paddingRight: 4,
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              borderColor: theme.borderStrong,
              backgroundColor: term.bg,
            }}
          >
            <Text style={{ color: term.prompt, fontFamily: FONT.mono, fontSize: 14 }} accessibilityElementsHidden importantForAccessibility="no">
              $
            </Text>
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={run}
              submitBehavior="submit"
              placeholder={running ? 'running…' : 'command'}
              placeholderTextColor={term.dim}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="go"
              accessibilityLabel="Command"
              style={[
                { flex: 1, minWidth: 0, color: term.fg, fontFamily: FONT.mono, fontSize: 14, minHeight: SIZE.controlMd, paddingVertical: 10 },
                Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
              ]}
            />
            {running ? (
              <Pressable
                onPress={running.kill}
                accessibilityRole="button"
                accessibilityLabel="Stop"
                style={({ pressed }) => [
                  { height: 40, paddingHorizontal: 16, justifyContent: 'center', borderRadius: RADIUS.pill, borderWidth: 1, borderColor: term.err },
                  pressed && { backgroundColor: term.border },
                ]}
              >
                <Text style={{ color: term.err, fontSize: 14, fontWeight: '600' }}>Stop</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={run}
                accessibilityRole="button"
                accessibilityLabel="Run"
                accessibilityState={{ disabled: !canRun }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  { height: 40, paddingHorizontal: 16, justifyContent: 'center', borderRadius: RADIUS.pill },
                  { backgroundColor: !canRun ? theme.fill : pressed ? theme.accentPress : hovered ? theme.accentHover : theme.accent },
                ]}
              >
                <Text style={{ color: canRun ? theme.onAccent : theme.inkFaint, fontSize: 14, fontWeight: '600' }}>Run</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </KeyboardPadded>
  );
}
