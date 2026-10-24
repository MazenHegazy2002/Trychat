import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

/** Shows an HTML document (a file preview). The web version is an iframe (HtmlView.web.tsx). */
export function HtmlView({
  html,
  uri,
  background = '#FFFFFF',
  onMessage,
}: {
  html?: string;
  uri?: string;
  background?: string;
  /** Messages the page sends with window.ReactNativeWebView.postMessage (parent.postMessage on web). */
  onMessage?: (data: string) => void;
}) {
  return (
    <WebView
      originWhitelist={['*']}
      source={html !== undefined ? { html, baseUrl: 'https://localhost/' } : { uri: uri ?? 'about:blank' }}
      style={{ backgroundColor: background }}
      setSupportMultipleWindows={false}
      onMessage={(e: WebViewMessageEvent) => onMessage?.(e.nativeEvent.data)}
    />
  );
}
