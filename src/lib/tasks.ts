/**
 * Task registry: every unit of work (a reply, a tool call, a laptop command, code, a sub-agent…)
 * is a Task with an append-only, capped log. The Tasks/Terminal screens subscribe to it.
 * Finished tasks (the last MAX_HISTORY) are kept on this device only.
 */

export type TaskKind = 'reply' | 'tool' | 'command' | 'code' | 'subagent' | 'install' | 'sync';
export type TaskStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  conversationId?: string;
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  output: string;
  exitCode?: number | null;
  /** True while a cancel handler is registered (the UI shows Stop). */
  cancellable?: boolean;
}

export const MAX_OUTPUT_CHARS = 200_000;
export const MAX_HISTORY = 200;
const STORAGE_KEY = 'trychat.tasks';

const tasks = new Map<string, Task>();
const cancels = new Map<string, () => void>();
const listeners = new Set<() => void>();
let snapshot: Task[] = [];
let seq = 0;

interface KV {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}
let kv: KV | null | undefined;
function storage(): KV | null {
  if (kv !== undefined) return kv;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage');
    kv = (mod.default ?? mod) as KV;
  } catch {
    kv = null;
  }
  return kv;
}
/** For tests: replace (or disable with null) persistence. */
export function setTaskStorage(s: KV | null) {
  kv = s;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const finished = [...tasks.values()].filter((t) => t.status !== 'running').map(({ cancellable, ...t }) => t);
    storage()?.setItem(STORAGE_KEY, JSON.stringify(finished)).catch(() => {});
  }, 500);
}

let emitQueued = false;
function emit() {
  // Coalesce bursts of output into one update per tick.
  if (emitQueued) return;
  emitQueued = true;
  setTimeout(() => {
    emitQueued = false;
    snapshot = [...tasks.values()].sort((a, b) => b.startedAt - a.startedAt);
    listeners.forEach((l) => l());
  }, 0);
}

function prune() {
  const finished = [...tasks.values()].filter((t) => t.status !== 'running').sort((a, b) => b.startedAt - a.startedAt);
  for (const t of finished.slice(MAX_HISTORY)) tasks.delete(t.id);
}

let loaded = false;
/** Loads saved history once (safe to call repeatedly). */
export async function loadTasks(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await storage()?.getItem(STORAGE_KEY);
    const saved: Task[] = raw ? JSON.parse(raw) : [];
    for (const t of saved) if (!tasks.has(t.id)) tasks.set(t.id, t);
    prune();
    emit();
  } catch {
    // ignore unreadable history
  }
}

export function startTask(init: { kind: TaskKind; title: string; conversationId?: string; cancel?: () => void }): string {
  const id = `t${Date.now().toString(36)}${(seq++).toString(36)}`;
  tasks.set(id, {
    id,
    kind: init.kind,
    title: init.title.slice(0, 300),
    conversationId: init.conversationId,
    status: 'running',
    startedAt: Date.now(),
    output: '',
    cancellable: !!init.cancel,
  });
  if (init.cancel) cancels.set(id, init.cancel);
  emit();
  return id;
}

export function appendTask(id: string | undefined, text: string) {
  const t = id ? tasks.get(id) : undefined;
  if (!t || !text) return;
  let out = t.output + text;
  if (out.length > MAX_OUTPUT_CHARS) {
    const cut = out.length - MAX_OUTPUT_CHARS;
    out = '…[earlier output trimmed]…\n' + out.slice(out.indexOf('\n', cut) + 1 || cut);
  }
  tasks.set(t.id, { ...t, output: out });
  emit();
}

/** Registers (or clears) how to stop a running task. */
export function setTaskCancel(id: string | undefined, cancel: (() => void) | null) {
  const t = id ? tasks.get(id) : undefined;
  if (!t || t.status !== 'running') return;
  if (cancel) cancels.set(t.id, cancel);
  else cancels.delete(t.id);
  tasks.set(t.id, { ...t, cancellable: !!cancel });
  emit();
}

export function endTask(id: string | undefined, status: Exclude<TaskStatus, 'running'>, extra?: { exitCode?: number | null; output?: string }) {
  const t = id ? tasks.get(id) : undefined;
  if (!t || t.status !== 'running') return;
  if (extra?.output) appendTask(t.id, extra.output);
  const cur = tasks.get(t.id)!;
  cancels.delete(t.id);
  tasks.set(t.id, {
    ...cur,
    status,
    endedAt: Date.now(),
    cancellable: false,
    ...(extra && 'exitCode' in extra ? { exitCode: extra.exitCode } : {}),
  });
  prune();
  emit();
  scheduleSave();
}

/** Records a command's exit code (shown in the terminal view). */
export function setTaskExit(id: string | undefined, exitCode: number | null) {
  const t = id ? tasks.get(id) : undefined;
  if (t) tasks.set(t.id, { ...t, exitCode });
}

/** Asks a running task to stop; it is marked cancelled right away. */
export function cancelTask(id: string) {
  const fn = cancels.get(id);
  if (!fn) return false;
  try {
    fn();
  } finally {
    endTask(id, 'cancelled');
  }
  return true;
}

/** Wraps work in a task: done on success, failed on error (or cancelled if cancelTask ran). */
export async function withTask<T>(
  init: { kind: TaskKind; title: string; conversationId?: string; cancel?: () => void },
  work: (taskId: string) => Promise<T>,
): Promise<T> {
  const id = startTask(init);
  try {
    const value = await work(id);
    endTask(id, 'done');
    return value;
  } catch (e) {
    endTask(id, 'failed', { output: `\n${e instanceof Error ? e.message : String(e)}\n` });
    throw e;
  }
}

export const getTasks = () => snapshot;
export const getTask = (id: string) => tasks.get(id);
export function subscribeTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function clearTaskHistory() {
  for (const t of [...tasks.values()]) if (t.status !== 'running') tasks.delete(t.id);
  emit();
  scheduleSave();
}
