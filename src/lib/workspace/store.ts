import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { uid } from '../id';
import type { Workspace } from './core';

/** Workspaces (and their staged changesets) live on this device. */
const KEY = 'trychat.workspaces';
let list: Workspace[] = [];
const listeners = new Set<() => void>();

export const workspacesReady: Promise<void> = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) list = JSON.parse(raw);
  })
  .catch(() => undefined)
  .then(() => listeners.forEach((l) => l()));

function commit(next: Workspace[]) {
  list = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => undefined);
}

export const getWorkspaces = () => list;
export const getWorkspace = (id?: string) => (id ? list.find((w) => w.id === id) : undefined);

export function addWorkspace(w: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt' | 'changes'>): Workspace {
  const now = Date.now();
  const ws: Workspace = { ...w, id: uid(), changes: {}, createdAt: now, updatedAt: now };
  commit([ws, ...list]);
  return ws;
}

export function patchWorkspace(id: string, patch: Partial<Workspace>): Workspace {
  let out: Workspace | undefined;
  commit(list.map((w) => (w.id === id ? (out = { ...w, ...patch, updatedAt: Date.now() }) : w)));
  if (!out) throw new Error('That workspace was removed.');
  return out;
}

export const removeWorkspace = (id: string) => commit(list.filter((w) => w.id !== id));

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useWorkspaces(): Workspace[] {
  return useSyncExternalStore(subscribe, getWorkspaces, getWorkspaces);
}

export function useWorkspace(id?: string): Workspace | undefined {
  const all = useWorkspaces();
  return id ? all.find((w) => w.id === id) : undefined;
}
