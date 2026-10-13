import { WebView } from 'react-native-webview';

/** Shows an HTML document (a file preview). The web version is an iframe (HtmlView.web.tsx). */
export function HtmlView({ html, uri, background = '#FFFFFF' }: { html?: string; uri?: string; background?: string }) {
  return (
    <WebView
      originWhitelist={['*']}
      source={html !== undefined ? { html, baseUrl: 'https://localhost/' } : { uri: uri ?? 'about:blank' }}
      style={{ backgroundColor: background }}
      setSupportMultipleWindows={false}
    />
  );
}
