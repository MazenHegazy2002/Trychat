import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { MONO, TERM, TerminalLog } from '../components/TerminalLog';
import { runOnLaptop } from '../lib/laptopStream';
import type { LaptopRunHandle } from '../lib/laptopStream';
import { useStore } from '../lib/store';
import { appendTask, endTask, setTaskCancel, startTask } from '../lib/tasks';
import { useTheme } from '../lib/theme';
import { laptopConnected, laptopInfo } from '../lib/tools';

/** Marks the end of a command's output, followed by the shell's working folder afterwards. */
const CWD_MARK = '\u001eTRYCHAT_CWD:';
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Interactive shell on the connected laptop: each line runs through the bridge (streaming), cwd is carried over. */
export default function TerminalScreen() {
  const theme = useTheme();
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
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: 24 }}>
        <Text style={{ color: theme.text, fontSize: 16 }}>The laptop isn’t connected.</Text>
        <Text style={{ color: theme.muted, marginTop: 8 }}>Start the bridge on your laptop and pair it in Settings → Connections → Laptop.</Text>
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
    setLog((l) => `${l}\x1b[32m${cwd ?? ''} $\x1b[0m ${command}\n`);
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

  return (
    <View style={{ flex: 1, backgroundColor: TERM.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#3A2A20' }}>
        <Text style={{ color: '#FFCB6B', fontSize: 12, flex: 1 }} numberOfLines={1}>
          Running on {host}: commands have full access to your laptop
        </Text>
      </View>
      <TerminalLog text={log} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderTopWidth: 1, borderTopColor: '#30302E' }}>
        <Pressable onPress={() => recall(1)} hitSlop={6} accessibilityLabel="Previous command">
          <Text style={{ color: TERM.dim, fontSize: 18 }}>↑</Text>
        </Pressable>
        <Pressable onPress={() => recall(-1)} hitSlop={6} accessibilityLabel="Next command">
          <Text style={{ color: TERM.dim, fontSize: 18 }}>↓</Text>
        </Pressable>
        <Text style={{ color: TERM.prompt, fontFamily: MONO }}>$</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={run}
          submitBehavior="submit"
          placeholder={running ? 'running…' : 'command'}
          placeholderTextColor={TERM.dim}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="go"
          style={{ flex: 1, color: TERM.fg, fontFamily: MONO, fontSize: 14, minHeight: 40 }}
        />
        {running ? (
          <Pressable onPress={running.kill} style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: TERM.err }}>
            <Text style={{ color: TERM.err, fontWeight: '600' }}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable onPress={run} style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 18, backgroundColor: theme.accent }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Run</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
