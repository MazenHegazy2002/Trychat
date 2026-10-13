import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { CodeRunnerHost } from '../components/CodeRunnerHost';
import { StoreProvider, useStore } from '../lib/store';
import { useTheme } from '../lib/theme';

function Navigator() {
  const theme = useTheme();
  const { ready } = useStore();
  const response = Notifications.useLastNotificationResponse();

  // Tapping a "TryChat replied" notification opens that chat.
  useEffect(() => {
    const url = response?.notification.request.content.data?.url;
    if (!ready || typeof url !== 'string') return;
    router.push(url as never);
    Notifications.clearLastNotificationResponse();
  }, [ready, response]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'TryChat' }} />
      <Stack.Screen name="chat/[id]" options={{ title: '' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="memory" options={{ title: 'Memory' }} />
      <Stack.Screen name="connections" options={{ title: 'Connections' }} />
      <Stack.Screen name="account" options={{ title: 'Account' }} />
      <Stack.Screen name="skills" options={{ title: 'Skills' }} />
      <Stack.Screen name="mcp" options={{ title: 'MCP servers' }} />
      <Stack.Screen name="plugins/index" options={{ title: 'Plugins' }} />
      <Stack.Screen name="plugins/[id]" options={{ title: '' }} />
      <Stack.Screen name="store" options={{ title: 'Store' }} />
      <Stack.Screen name="files" options={{ title: 'Files' }} />
      <Stack.Screen name="friends" options={{ title: 'Friends' }} />
      <Stack.Screen name="projects/index" options={{ title: 'Projects' }} />
      <Stack.Screen name="projects/[id]" options={{ title: '' }} />
      <Stack.Screen name="projects/new" options={{ title: 'New project' }} />
      <Stack.Screen name="preview" options={{ title: 'Preview', presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <StoreProvider>
        <StatusBar style="auto" />
        <Navigator />
        <CodeRunnerHost />
      </StoreProvider>
    </KeyboardProvider>
  );
}
