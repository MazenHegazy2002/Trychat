import { uid } from './id';
import type { Settings } from './types';

/** Result of a laptop command (same shape as the bridge's /run, minus what was streamed). */
export interface LaptopRunResult {
  exitCode: number | null;
  signal?: string | null;
  timedOut?: boolean;
  timeoutMs?: number;
  outputLimit?: number;
  killed?: boolean;
  stdout: string;
  stderr: string;
  stdoutBytes?: number;
  stderrBytes?: number;
}

export interface LaptopRunHandle {
  id: string;
  /** Stops the command (and what it started) on the laptop. */
  kill: () => void;
  done: Promise<LaptopRunResult>;
}

const base = (s: Settings) => {
  const u = s.bridgeUrl.trim().replace(/\/+$/, '');
  return !u || /^[a-z][a-z\d+.-]*:\/\//i.test(u) ? u : `http://${u}`;
};
const headers = (s: Settings) => ({ Authorization: `Bearer ${s.bridgeToken}`, 'Content-Type': 'application/json' });

export async function killLaptopRun(s: Settings, id: string): Promise<void> {
  await fetch(base(s) + '/run/kill', { method: 'POST', headers: headers(s), body: JSON.stringify({ id }) }).catch(() => {});
}

/**
 * Runs a command through the bridge's POST /run/stream (NDJSON), reporting output as it arrives.
 * XMLHttpRequest is used because its progress events give incremental text on Android, iOS and web,
 * which fetch's body stream does not on React Native. Falls back to POST /run on an older bridge.
 */
export function runOnLaptop(
  s: Settings,
  req: { command: string; cwd?: string },
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void,
): LaptopRunHandle {
  const id = uid();
  const xhr = new XMLHttpRequest();
  let killed = false;
  const done = new Promise<LaptopRunResult>((resolve, reject) => {
    let read = 0;
    let buf = '';
    let exit: Record<string, unknown> | null = null;
    let streamError: string | null = null;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const consume = () => {
      const text = xhr.responseText ?? '';
      if (text.length <= read) return;
      buf += text.slice(read);
      read = text.length;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === 'stdout' || ev.type === 'stderr') {
          (ev.type === 'stdout' ? stdout : stderr).push(ev.data);
          onOutput(ev.type, ev.data);
        } else if (ev.type === 'exit') exit = ev;
        else if (ev.type === 'error') streamError = ev.error;
      }
    };
    xhr.open('POST', base(s) + '/run/stream');
    Object.entries(headers(s)).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.onprogress = consume;
    xhr.onerror = () => reject(new Error('Couldn’t reach the laptop bridge'));
    xhr.onabort = () => reject(new Error('Stopped'));
    xhr.onload = async () => {
      if (xhr.status === 404) {
        // Older bridge without streaming.
        try {
          const res = await fetch(base(s) + '/run', { method: 'POST', headers: headers(s), body: JSON.stringify(req) });
          const json = await res.json().catch(() => null);
          if (!res.ok) throw new Error(`Laptop ${res.status}: ${json?.error ?? res.statusText}`);
          if (json.stdout) onOutput('stdout', json.stdout);
          if (json.stderr) onOutput('stderr', json.stderr);
          resolve(json);
        } catch (e) {
          reject(e);
        }
        return;
      }
      if (xhr.status !== 200) {
        let msg = xhr.statusText;
        try {
          msg = JSON.parse(xhr.responseText).error ?? msg;
        } catch {}
        reject(new Error(`Laptop ${xhr.status}: ${msg}`));
        return;
      }
      consume();
      if (streamError) return reject(new Error(streamError));
      if (!exit) return reject(new Error('The laptop bridge closed the connection before the command finished'));
      resolve({ ...(exit as object), killed: killed || !!(exit as any).killed, stdout: stdout.join(''), stderr: stderr.join('') } as LaptopRunResult);
    };
    xhr.send(JSON.stringify({ ...req, id }));
  });
  return {
    id,
    kill: () => {
      killed = true;
      killLaptopRun(s, id);
    },
    done,
  };
}
