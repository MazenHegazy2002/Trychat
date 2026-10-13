import { createElement } from 'react';

import { displayUri } from '../lib/webFiles';

/** Web / desktop: a sandboxed iframe (scripts can run, but not reach the app). */
export function HtmlView({ html, uri, background = '#FFFFFF' }: { html?: string; uri?: string; background?: string }) {
  return createElement('iframe', {
    ...(html !== undefined ? { srcDoc: html, sandbox: 'allow-scripts allow-forms allow-modals allow-popups' } : { src: displayUri(uri ?? 'about:blank') }),
    style: { border: 'none', width: '100%', height: '100%', flex: 1, background },
  });
}
