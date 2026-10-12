import { createElement } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { getPreview, toHtmlDocument } from '../lib/preview';

/** Runs model-generated HTML/JS in a sandboxed web view. */
export default function PreviewScreen() {
  const { code, lang } = getPreview();
  const html = toHtmlDocument(code, lang);

  if (Platform.OS === 'web') {
    return createElement('iframe', {
      srcDoc: html,
      sandbox: 'allow-scripts allow-forms allow-modals',
      style: { border: 'none', width: '100%', height: '100%', background: '#fff' },
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost/' }}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
      />
    </View>
  );
}
