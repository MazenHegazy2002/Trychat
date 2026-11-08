import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View, useWindowDimensions } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { AlertHost } from '../components/AlertHost';
import { CodeRunnerHost } from '../components/CodeRunnerHost';
import { Sidebar } from '../components/Sidebar';
import { useAppFonts } from '../lib/fonts';
import { useNotificationNavigation } from '../lib/notificationNav';
import { StoreProvider, useStore } from '../lib/store';
import { FONT, WIDE_BREAKPOINT, loadAppearance, useTheme } from '../lib/theme';
import { filesReady } from '../lib/webFiles';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Navigator() {
  const theme = useTheme();
  const { ready } = useStore();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  useNotificationNavigation(ready);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  // The Stack keeps the same place in the tree at every width, so resizing a desktop window never
  // resets navigation; the sidebar simply appears beside it from 900px.
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.bg }}>
      {wide && <Sidebar />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.bg },
            headerTintColor: theme.ink,
            headerShadowVisible: false,
            headerTitleStyle: { fontFamily: FONT.semibold, fontSize: 17, color: theme.ink },
            headerLargeTitleStyle: { fontFamily: FONT.semibold, color: theme.ink },
            headerBackTitleStyle: { fontFamily: FONT.regular },
            headerBackButtonDisplayMode: 'minimal',
            headerTitleAlign: 'center',
            contentStyle: { backgroundColor: theme.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'TryChat', headerShown: wide ? false : undefined }} />
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
          <Stack.Screen name="tasks" options={{ title: 'Tasks & terminal' }} />
          <Stack.Screen name="tasks/[id]" options={{ title: 'Task' }} />
          <Stack.Screen name="terminal" options={{ title: 'Laptop terminal' }} />
          <Stack.Screen name="friends" options={{ title: 'Friends' }} />
          <Stack.Screen name="projects/index" options={{ title: 'Projects' }} />
          <Stack.Screen name="projects/[id]" options={{ title: '' }} />
          <Stack.Screen name="projects/new" options={{ title: 'New project' }} />
          <Stack.Screen name="designs/index" options={{ title: 'Design studio' }} />
          <Stack.Screen name="designs/[id]" options={{ title: '' }} />
          <Stack.Screen name="designs/play" options={{ title: 'Preview', presentation: 'fullScreenModal' }} />
          <Stack.Screen name="preview" options={{ title: 'Preview', presentation: 'modal' }} />
        </Stack>
      </View>
    </View>
  );
}

function Themed() {
  const theme = useTheme();
  useEffect(() => {
    // The window behind the app (seen while the keyboard or a sheet moves) matches the ground.
    SystemUI.setBackgroundColorAsync(theme.bg).catch(() => {});
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.style.backgroundColor = theme.bg;
      document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light';
    }
  }, [theme]);
  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Navigator />
      <CodeRunnerHost />
      <AlertHost />
    </>
  );
}

export default function RootLayout() {
  const [filesLoaded, setFilesLoaded] = useState(Platform.OS !== 'web');
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  const fontsLoaded = useAppFonts();
  useEffect(() => {
    filesReady.finally(() => setFilesLoaded(true));
    loadAppearance().finally(() => setAppearanceLoaded(true));
  }, []);
  const ready = filesLoaded && appearanceLoaded && fontsLoaded;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;
  return (
    <KeyboardProvider>
      <StoreProvider>
        <Themed />
      </StoreProvider>
    </KeyboardProvider>
  );
}
