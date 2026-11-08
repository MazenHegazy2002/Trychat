import { Stack, router } from 'expo-router';
import { createElement } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { IconButton } from '../components/ui';
import { getPreview, toHtmlDocument } from '../lib/preview';

/**
 * The page's own canvas. Generated pages expect the browser's default white ground, so the stage
 * keeps it (the LivePreview rule: the stage keeps the app's own colours).
 */
const STAGE = '#FFFFFF';

function closePreview() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** Runs model-generated HTML/JS in a sandboxed web view. */
export default function PreviewScreen() {
  const { code, lang } = getPreview();
  const html = toHtmlDocument(code, lang);
  const header = <Stack.Screen options={{ headerLeft: () => <IconButton name="x" label="Close" onPress={closePreview} /> }} />;

  if (Platform.OS === 'web') {
    return (
      <>
        {header}
        {createElement('iframe', {
          srcDoc: html,
          sandbox: 'allow-scripts allow-forms allow-modals',
          style: { border: 'none', width: '100%', height: '100%', background: STAGE },
        })}
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: STAGE }}>
      {header}
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
