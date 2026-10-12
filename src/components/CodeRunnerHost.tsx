import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { uid } from '../lib/id';
import { registerExecutor, RUNNER_HTML } from '../lib/runner';

type Pending = { resolve: (s: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/** Invisible WebView that executes code for the model and for "Run" buttons. Mounted once at the root. */
export function CodeRunnerHost() {
  const ref = useRef<WebView>(null);
  const pending = useRef(new Map<string, Pending>());
  const ready = useRef<Promise<void>>(Promise.resolve());
  const markReady = useRef<() => void>(() => {});
  const [instance, setInstance] = useState(0); // bump to reload after a runaway script

  useEffect(() => {
    if (Platform.OS === 'web') return;
    ready.current = new Promise((r) => (markReady.current = r));
    registerExecutor(async (language, code, timeoutMs) => {
      await ready.current;
      const id = uid();
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error(`Timed out after ${timeoutMs / 1000}s`));
          setInstance((n) => n + 1); // the page may be stuck in a loop: start fresh
        }, timeoutMs);
        pending.current.set(id, { resolve, reject, timer });
        ref.current?.injectJavaScript(`window.__run(${JSON.stringify({ id, language, code })});true;`);
      });
    });
    return () => registerExecutor(null);
  }, [instance]);

  if (Platform.OS === 'web') return null;

  return (
    <View style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }} pointerEvents="none">
      <WebView
        key={instance}
        ref={ref}
        originWhitelist={['*']}
        source={{ html: RUNNER_HTML, baseUrl: 'https://localhost/' }}
        javaScriptEnabled
        onMessage={(e) => {
          let msg: any;
          try {
            msg = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (msg.ready) return markReady.current();
          const p = pending.current.get(msg.id);
          if (!p) return;
          clearTimeout(p.timer);
          pending.current.delete(msg.id);
          if (msg.ok) p.resolve(msg.output || '(no output)');
          else p.reject(new Error((msg.output ? msg.output + '\n' : '') + msg.error));
        }}
      />
    </View>
  );
}
