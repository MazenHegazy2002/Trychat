import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Conversation, Memory, Settings } from './types';

const KEYS = {
  settings: 'trychat.settings',
  conversations: 'trychat.conversations',
  memories: 'trychat.memories',
  apiKey: 'trychat.apiKey',
};

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://169.58.133.158:20128/v1',
  apiKey: process.env.EXPO_PUBLIC_API_KEY ?? '',
  model: process.env.EXPO_PUBLIC_DEFAULT_MODEL ?? '',
  systemPrompt: 'You are a helpful, knowledgeable assistant. Answer clearly and use Markdown when it helps.',
  builderMode: true,
  memoryEnabled: true,
  stream: true,
  temperature: 0.7,
  contextMessages: 40,
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): Promise<void> {
  return AsyncStorage.setItem(key, JSON.stringify(value));
}

// SecureStore is native-only; fall back to AsyncStorage on web.
async function readSecret(): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(KEYS.apiKey);
  return SecureStore.getItemAsync(KEYS.apiKey);
}

async function writeSecret(value: string): Promise<void> {
  if (Platform.OS === 'web') return AsyncStorage.setItem(KEYS.apiKey, value);
  return SecureStore.setItemAsync(KEYS.apiKey, value);
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(KEYS.settings, {});
  const apiKey = await readSecret();
  return { ...DEFAULT_SETTINGS, ...stored, apiKey: apiKey ?? DEFAULT_SETTINGS.apiKey };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const { apiKey, ...rest } = settings;
  await Promise.all([writeJson(KEYS.settings, rest), writeSecret(apiKey)]);
}

export const loadConversations = () => readJson<Conversation[]>(KEYS.conversations, []);
export const saveConversations = (c: Conversation[]) => writeJson(KEYS.conversations, c);

export const loadMemories = () => readJson<Memory[]>(KEYS.memories, []);
export const saveMemories = (m: Memory[]) => writeJson(KEYS.memories, m);
