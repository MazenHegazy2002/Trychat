import { useEffect, useRef, useState } from 'react';

import { uid } from '../lib/id';
import { registerExecutor, RUNNER_HTML } from '../lib/runner';
import type { RunResult } from '../lib/runner';

type Pending = { resolve: (r: RunResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Web / desktop version of CodeRunnerHost: the same runner page in a hidden sandboxed iframe
 * (scripts only, no access to the app's storage). The page talks through the same message bridge as
 * the phone WebView: window.ReactNativeWebView.postMessage becomes a postMessage to this window.
 */
const BRIDGE = `<script>
window.ReactNativeWebView = { postMessage: (data) => parent.postMessage({ __trychatRunner: true, data }, '*') };
addEventListener('message', (e) => { if (e.source === parent && e.data && e.data.__trychatRun) window.__run(e.data.__trychatRun); });
</script>`;
const HTML = RUNNER_HTML.replace('<head>', '<head>' + BRIDGE);

export function CodeRunnerHost() {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const ready = useRef<Promise<void>>(Promise.resolve());
  const markReady = useRef<() => void>(() => {});
  const [instance, setInstance] = useState(0); // bump to reload after a runaway script

  useEffect(() => {
    ready.current = new Promise((r) => (markReady.current = r));
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow || !e.data?.__trychatRunner) return;
      let msg: any;
      try {
        msg = JSON.parse(e.data.data);
      } catch {
        return;
      }
      if (msg.ready) return markReady.current();
      const p = pending.current.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.current.delete(msg.id);
      if (msg.ok) p.resolve({ output: msg.output || (msg.files?.length ? '' : '(no output)'), files: msg.files ?? [] });
      else p.reject(new Error((msg.output ? msg.output + '\n' : '') + msg.error));
    };
    window.addEventListener('message', onMessage);
    registerExecutor(async (language, code, timeoutMs) => {
      await ready.current;
      const id = uid();
      return new Promise<RunResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error(`Timed out after ${timeoutMs / 1000}s`));
          setInstance((n) => n + 1); // the page may be stuck in a loop: start fresh
        }, timeoutMs);
        pending.current.set(id, { resolve, reject, timer });
        frame.current?.contentWindow?.postMessage({ __trychatRun: { id, language, code } }, '*');
      });
    });
    return () => {
      window.removeEventListener('message', onMessage);
      registerExecutor(null);
    };
  }, [instance]);

  return (
    <iframe
      key={instance}
      ref={frame}
      srcDoc={HTML}
      sandbox="allow-scripts"
      title="Code runner"
      aria-hidden
      tabIndex={-1}
      style={{ position: 'absolute', width: 0, height: 0, border: 'none', opacity: 0, pointerEvents: 'none' }}
    />
  );
}
