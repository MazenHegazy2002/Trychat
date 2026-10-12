import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Account, Conversation, McpServer, Memory, Plugin, Project, Settings, Skill } from './types';

const KEYS = {
  settings: 'trychat.settings',
  conversations: 'trychat.conversations',
  memories: 'trychat.memories',
  skills: 'trychat.skills',
  projects: 'trychat.projects',
  plugins: 'trychat.plugins',
  mcpServers: 'trychat.mcpServers',
  account: 'trychat.account',
  syncSnapshot: 'trychat.syncSnapshot',
};

// Settings fields kept in the device's secure storage instead of AsyncStorage.
const SECRET_FIELDS = ['apiKey', 'githubToken', 'bridgeToken'] as const;
type SecretField = (typeof SECRET_FIELDS)[number];
const secretKey = (field: SecretField) => `trychat.${field}`;

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
  githubToken: '',
  bridgeUrl: '',
  bridgeToken: '',
  confirmCommands: true,
  confirmWrites: true,
  confirmReads: false,
  repos: [],
  subAgents: true,
  codeExecution: true,
  marketplaces: [],
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
async function readSecret(field: SecretField): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(secretKey(field));
  return SecureStore.getItemAsync(secretKey(field));
}

async function writeSecret(field: SecretField, value: string): Promise<void> {
  if (Platform.OS === 'web') return AsyncStorage.setItem(secretKey(field), value);
  return SecureStore.setItemAsync(secretKey(field), value);
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(KEYS.settings, {});
  const settings: Settings = { ...DEFAULT_SETTINGS, ...stored };
  for (const field of SECRET_FIELDS) {
    const value = await readSecret(field);
    if (value !== null) settings[field] = value;
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const rest: Partial<Settings> = { ...settings };
  for (const field of SECRET_FIELDS) delete rest[field];
  await Promise.all([
    writeJson(KEYS.settings, rest),
    ...SECRET_FIELDS.map((field) => writeSecret(field, settings[field])),
  ]);
}

export const loadConversations = () => readJson<Conversation[]>(KEYS.conversations, []);
export const saveConversations = (c: Conversation[]) => writeJson(KEYS.conversations, c);

export const loadMemories = () => readJson<Memory[]>(KEYS.memories, []);
export const saveMemories = (m: Memory[]) => writeJson(KEYS.memories, m);

export const loadPlugins = () => readJson<Plugin[]>(KEYS.plugins, []);
export const savePlugins = (p: Plugin[]) => writeJson(KEYS.plugins, p);

export const loadProjects = () => readJson<Project[]>(KEYS.projects, []);
export const saveProjects = (p: Project[]) => writeJson(KEYS.projects, p);

export const loadSkills = () => readJson<Skill[]>(KEYS.skills, []);
export const saveSkills = (s: Skill[]) => writeJson(KEYS.skills, s);

export const loadMcpServers = () => readJson<McpServer[]>(KEYS.mcpServers, []);
export const saveMcpServers = (s: McpServer[]) => writeJson(KEYS.mcpServers, s);

// The account (with its session token) goes in secure storage on native.
export async function loadAccount(): Promise<Account | null> {
  const raw = Platform.OS === 'web' ? await AsyncStorage.getItem(KEYS.account) : await SecureStore.getItemAsync(KEYS.account);
  try {
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

export async function saveAccount(account: Account | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (account) await AsyncStorage.setItem(KEYS.account, JSON.stringify(account));
    else await AsyncStorage.removeItem(KEYS.account);
    return;
  }
  if (account) await SecureStore.setItemAsync(KEYS.account, JSON.stringify(account));
  else await SecureStore.deleteItemAsync(KEYS.account);
}

/** What the server last confirmed, per "collection/id" → updatedAt. Used to detect local edits and deletions. */
export const loadSyncSnapshot = () => readJson<Record<string, number>>(KEYS.syncSnapshot, {});
export const saveSyncSnapshot = (s: Record<string, number>) => writeJson(KEYS.syncSnapshot, s);
