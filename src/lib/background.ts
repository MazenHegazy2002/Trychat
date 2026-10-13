/**
 * Keeps replies running while the app is in the background, and notifies when they finish.
 *
 * Android: a foreground service (react-native-background-actions, type dataSync) runs while any
 * conversation is busy, so the OS keeps the JS thread alive. It must be started while the app is
 * visible (Android 12+ forbids starting one from the background), so it starts when work starts.
 * iOS: the same library wraps the work in beginBackgroundTask, which buys roughly 30 s after leaving
 * the app; longer replies are suspended by iOS and continue when the app returns.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';

const ENABLED_KEY = 'trychat.background.enabled';
const ASKED_KEY = 'trychat.background.askedPermission';
const CHANNEL = 'replies';

let enabled = true;
let loaded: Promise<void> | null = null;
const listeners = new Set<(v: boolean) => void>();

function load() {
  loaded ??= AsyncStorage.getItem(ENABLED_KEY)
    .then((v) => {
      enabled = v !== 'false';
      listeners.forEach((l) => l(enabled));
    })
    .catch(() => {});
  return loaded;
}

/** Device-only setting "Keep working in the background" (default on). */
export async function isBackgroundEnabled() {
  await load();
  return enabled;
}

export function subscribeBackgroundEnabled(fn: (v: boolean) => void) {
  listeners.add(fn);
  load().then(() => fn(enabled));
  return () => void listeners.delete(fn);
}

export async function setBackgroundEnabled(v: boolean) {
  enabled = v;
  listeners.forEach((l) => l(v));
  await AsyncStorage.setItem(ENABLED_KEY, String(v)).catch(() => {});
  if (!v) await stopService();
}

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Replies',
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => {});
  }
}

/** Asks for notification permission once, the first time work runs with background mode on. */
async function askPermissionOnce() {
  try {
    if ((await AsyncStorage.getItem(ASKED_KEY)) === '1') return;
    await AsyncStorage.setItem(ASKED_KEY, '1');
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && canAskAgain) await Notifications.requestPermissionsAsync();
  } catch {}
}

let release: (() => void) | null = null;
let starting: Promise<void> | null = null;

function describe(count: number, progress?: string) {
  return progress || (count > 1 ? `Working on ${count} chats` : 'Finishing your reply');
}

/** Starts (or updates) the background service while `count` conversations are busy; stops it at 0. */
export async function syncBackgroundWork(count: number, progress?: string) {
  if (Platform.OS === 'web') return;
  if (count === 0 || !(await isBackgroundEnabled())) return stopService();
  if (release || starting) {
    await starting;
    if (Platform.OS === 'android' && BackgroundService.isRunning()) {
      await BackgroundService.updateNotification({ taskDesc: describe(count, progress) }).catch(() => {});
    }
    return;
  }
  // Only start while visible: Android refuses to start a foreground service from the background.
  if (AppState.currentState !== 'active') return;
  askPermissionOnce();
  starting = BackgroundService.start(
    () => new Promise<void>((resolve) => (release = resolve)),
    {
      taskName: 'TryChatWork',
      taskTitle: 'TryChat is working…',
      taskDesc: describe(count, progress),
      taskIcon: { name: 'ic_launcher', type: 'mipmap' },
      linkingURI: 'trychat://',
      progressBar: { max: 1, value: 0, indeterminate: true },
      foregroundServiceType: ['dataSync'],
    },
  )
    .catch(() => {
      release = null;
    })
    .finally(() => {
      starting = null;
    });
  await starting;
}

async function stopService() {
  await starting;
  const r = release;
  release = null;
  r?.();
  if (BackgroundService.isRunning()) await BackgroundService.stop().catch(() => {});
}

/** Shows a local notification when the app is not in the foreground. Tapping opens the chat. */
export async function notifyIfBackground(conversationId: string, title: string, body: string) {
  if (Platform.OS === 'web' || AppState.currentState === 'active') return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body: body.slice(0, 200), data: { url: `/chat/${conversationId}` } },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  } catch {}
}
