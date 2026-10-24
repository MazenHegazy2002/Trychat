import { useEffect, useState, useSyncExternalStore } from 'react';

import { getTasks, loadTasks, subscribeTasks } from './tasks';
import type { Task } from './tasks';

export function useTasks(): Task[] {
  useEffect(() => {
    loadTasks();
  }, []);
  return useSyncExternalStore(subscribeTasks, getTasks, getTasks);
}

/** Re-renders every `ms` while `active`, for live elapsed times. */
export function useTicker(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
