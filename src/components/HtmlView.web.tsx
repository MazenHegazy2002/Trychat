import { createElement, useEffect, useRef, useState } from 'react';

import { displayUri } from '../lib/webFiles';

/** Web / desktop: a sandboxed iframe (scripts can run, but not reach the app). */
export function HtmlView({
  html,
  uri,
  background = '#FFFFFF',
  onMessage,
}: {
  html?: string;
  uri?: string;
  background?: string;
  onMessage?: (data: string) => void;
}) {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });
  const listening = !!onMessage;
  useEffect(() => {
    if (!listening || !frame) return;
    const listen = (e: MessageEvent) => {
      if (e.source === frame.contentWindow && typeof e.data === 'string') handler.current?.(e.data);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [listening, frame]);
  return createElement('iframe', {
    ref: setFrame,
    ...(html !== undefined ? { srcDoc: html, sandbox: 'allow-scripts allow-forms allow-modals allow-popups' } : { src: displayUri(uri ?? 'about:blank') }),
    style: { border: 'none', width: '100%', height: '100%', flex: 1, background },
  });
}
