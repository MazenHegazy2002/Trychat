import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import { runSubAgents } from './agents';
import { chat } from './api';
import { uid } from './id';
import { buildApiMessages, extractMemoryOps, stripMemoryTags } from './prompt';
import * as storage from './storage';
import { listMcpTools } from './mcp';
import * as sync from './sync';
import { formatToolResult, needsApproval, parseToolCall, runTool, stripToolTags } from './tools';
import type { ToolContext } from './tools';
import type { Account, ChatMessage, Conversation, McpServer, McpTool, Memory, Settings, Skill } from './types';

export type SyncStatus = { state: 'idle' | 'syncing' | 'error'; error?: string };

interface Store {
  ready: boolean;
  settings: Settings;
  conversations: Conversation[];
  memories: Memory[];
  skills: Skill[];
  mcpServers: McpServer[];
  /** Tools discovered on each MCP server (by server id) and connection errors. */
  mcpTools: Record<string, McpTool[]>;
  mcpErrors: Record<string, string>;
  account: Account | null;
  syncStatus: SyncStatus;
  /** Conversation ids with a request in flight. */
  busy: Record<string, boolean>;
  saveSkill: (skill: Skill) => void;
  deleteSkill: (id: string) => void;
  saveMcpServer: (server: McpServer) => void;
  deleteMcpServer: (id: string) => void;
  refreshMcpTools: (serverId?: string) => Promise<void>;
  signIn: (serverUrl: string, mode: 'signin' | 'signup', form: { email: string; password: string; name?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  createConversation: () => Conversation;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setConversationModel: (id: string, model: string) => void;
  clearConversations: () => void;
  send: (conversationId: string, text: string) => Promise<void>;
  regenerate: (conversationId: string) => Promise<void>;
  stop: (conversationId: string) => void;
  approveTool: (conversationId: string, messageId: string) => Promise<void>;
  denyTool: (conversationId: string, messageId: string) => Promise<void>;
  addMemory: (text: string) => void;
  updateMemory: (id: string, text: string) => void;
  deleteMemory: (id: string) => void;
  clearMemories: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}

/** After this many tool steps in a row, ask the user before continuing even for auto-approved tools. */
const MAX_AUTO_TOOL_STEPS = 12;

const display = (text: string) => stripToolTags(stripMemoryTags(text));

function toolStepsSinceUser(history: ChatMessage[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'user' && !m.toolResult) break;
    if (m.toolResult) n++;
  }
  return n;
}

function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0];
  return line.length > 48 ? line.slice(0, 45) + '…' : line || 'New chat';
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(storage.DEFAULT_SETTINGS);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpTools, setMcpTools] = useState<Record<string, McpTool[]>>({});
  const [mcpErrors, setMcpErrors] = useState<Record<string, string>>({});
  const [account, setAccount] = useState<Account | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'idle' });

  // Refs mirror state so async request code always sees the latest values.
  const convRef = useRef(conversations);
  const memRef = useRef(memories);
  const settingsRef = useRef(settings);
  const controllers = useRef<Record<string, AbortController>>({});
  const skillsRef = useRef(skills);
  const mcpRef = useRef(mcpServers);
  const mcpToolsRef = useRef(mcpTools);
  const accountRef = useRef(account);
  const busyRef = useRef(busy);
  convRef.current = conversations;
  memRef.current = memories;
  settingsRef.current = settings;
  skillsRef.current = skills;
  mcpRef.current = mcpServers;
  mcpToolsRef.current = mcpTools;
  accountRef.current = account;
  busyRef.current = busy;

  useEffect(() => {
    Promise.all([
      storage.loadSettings(),
      storage.loadConversations(),
      storage.loadMemories(),
      storage.loadSkills(),
      storage.loadMcpServers(),
      storage.loadAccount(),
    ]).then(([s, c, m, k, servers, acct]) => {
      setSettings(s);
      setConversations(c);
      setMemories(m);
      setSkills(k);
      setMcpServers(servers);
      setAccount(acct);
      setReady(true);
    });
  }, []);

  /** Everything tools need, using the latest state. */
  const toolCtx = useCallback((model: string): ToolContext => {
    const base: ToolContext = {
      settings: settingsRef.current,
      skills: skillsRef.current,
      mcpServers: mcpRef.current,
      mcpTools: mcpToolsRef.current,
    };
    return { ...base, runSubAgents: (tasks) => runSubAgents(base, model, tasks) };
  }, []);

  // Persist with a short debounce so streaming updates don't hammer storage.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => storage.saveConversations(conversations), 400);
    return () => clearTimeout(t);
  }, [conversations, ready]);

  useEffect(() => {
    if (ready) storage.saveMemories(memories);
  }, [memories, ready]);

  useEffect(() => {
    if (ready) storage.saveSkills(skills);
  }, [skills, ready]);

  useEffect(() => {
    if (ready) storage.saveMcpServers(mcpServers);
  }, [mcpServers, ready]);

  // ---------- MCP ----------

  const refreshMcpTools = useCallback(async (serverId?: string) => {
    const targets = mcpRef.current.filter((x) => x.enabled && (!serverId || x.id === serverId));
    await Promise.all(
      targets.map(async (server) => {
        try {
          const tools = await listMcpTools(server);
          setMcpTools((t) => ({ ...t, [server.id]: tools }));
          setMcpErrors(({ [server.id]: _, ...rest }) => rest);
        } catch (e) {
          setMcpTools(({ [server.id]: _, ...rest }) => rest);
          setMcpErrors((errs) => ({ ...errs, [server.id]: e instanceof Error ? e.message : String(e) }));
        }
      }),
    );
  }, []);

  // Discover MCP tools whenever the server list changes.
  const mcpKey = mcpServers.map((x) => `${x.id}:${x.url}:${x.enabled}:${x.token ?? ''}`).join('|');
  useEffect(() => {
    if (ready) refreshMcpTools();
  }, [ready, mcpKey, refreshMcpTools]);

  const saveMcpServer = useCallback((server: McpServer) => {
    const next = { ...server, updatedAt: Date.now() };
    setMcpServers((list) => (list.some((x) => x.id === server.id) ? list.map((x) => (x.id === server.id ? next : x)) : [...list, next]));
  }, []);

  const deleteMcpServer = useCallback((id: string) => {
    setMcpServers((list) => list.filter((x) => x.id !== id));
  }, []);

  // ---------- Skills ----------

  const saveSkill = useCallback((skill: Skill) => {
    const next = { ...skill, updatedAt: Date.now() };
    setSkills((list) => (list.some((x) => x.id === skill.id) ? list.map((x) => (x.id === skill.id ? next : x)) : [...list, next]));
  }, []);

  const deleteSkill = useCallback((id: string) => {
    setSkills((list) => list.filter((x) => x.id !== id));
  }, []);

  // ---------- Account & sync ----------

  const syncing = useRef(false);

  const syncNow = useCallback(async () => {
    const acct = accountRef.current;
    if (!acct || syncing.current) return;
    syncing.current = true;
    setSyncStatus({ state: 'syncing' });
    try {
      const snapshot = await storage.loadSyncSnapshot();
      const state: sync.SyncState = {
        memories: memRef.current,
        conversations: convRef.current.filter((c) => !busyRef.current[c.id]), // don't upload half-streamed replies
        skills: skillsRef.current,
        mcpServers: mcpRef.current,
        settings: settingsRef.current,
      };
      const busyKeys = new Set(Object.keys(busyRef.current).map((id) => `conversations/${id}`));
      const changes = sync.pendingChanges(state, snapshot).filter((c) => !busyKeys.has(`${c.collection}/${c.id}`));
      const { cursor, items } = await sync.pushPull(acct, changes);

      setMemories((list) => sync.mergeList(list, items, 'memories', (m) => m.updatedAt ?? m.createdAt));
      setConversations((list) => {
        const merged = sync.mergeList(list, items, 'conversations', (c) => c.updatedAt);
        return merged === list ? list : merged.sort((x, y) => y.updatedAt - x.updatedAt); // same array = no re-sync
      });
      setSkills((list) => sync.mergeList(list, items, 'skills', (k) => k.updatedAt));
      setMcpServers((list) =>
        sync.mergeList(list, items, 'mcpServers', (x) => x.updatedAt, (data, local) => ({ ...data, token: local?.token })),
      );
      const merged = sync.mergePrefs(settingsRef.current, items);
      if (merged !== settingsRef.current) {
        setSettings(merged);
        await storage.saveSettings(merged);
      }

      await storage.saveSyncSnapshot(sync.nextSnapshot(snapshot, changes, items));
      const next = { ...acct, cursor, lastSyncAt: Date.now() };
      setAccount(next);
      await storage.saveAccount(next);
      setSyncStatus({ state: 'idle' });
    } catch (e: any) {
      if (e?.status === 401) {
        setAccount(null);
        await storage.saveAccount(null);
      }
      setSyncStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      syncing.current = false;
    }
  }, []);

  const signIn = useCallback(
    async (serverUrl: string, mode: 'signin' | 'signup', form: { email: string; password: string; name?: string }) => {
      const acct = await sync.signIn(serverUrl, mode, form);
      // A different account starts from a clean sync state; this device's data is merged into it.
      await storage.saveSyncSnapshot({});
      setAccount(acct);
      accountRef.current = acct;
      await storage.saveAccount(acct);
      await syncNow();
    },
    [syncNow],
  );

  const signOut = useCallback(async () => {
    const acct = accountRef.current;
    if (acct) await syncNow();
    if (acct) await sync.signOut(acct);
    setAccount(null);
    accountRef.current = null;
    await storage.saveAccount(null);
    await storage.saveSyncSnapshot({});
  }, [syncNow]);

  // Sync shortly after any change, every minute, and when the app comes back to the foreground.
  useEffect(() => {
    if (!ready || !account || Object.keys(busy).length) return;
    const t = setTimeout(syncNow, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, account?.token, memories, conversations, skills, mcpServers, settings, busy]);

  useEffect(() => {
    if (!ready || !account) return;
    const interval = setInterval(syncNow, 60_000);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && syncNow());
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [ready, account?.token, syncNow]);

  const patchConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((list) => list.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const touchesPrefs = Object.keys(patch).some((k) => (sync.SYNCED_PREFS as readonly string[]).includes(k));
    const next = { ...settingsRef.current, ...patch, ...(touchesPrefs ? { prefsUpdatedAt: Date.now() } : {}) };
    setSettings(next);
    await storage.saveSettings(next);
  }, []);

  const createConversation = useCallback(() => {
    const now = Date.now();
    const conv: Conversation = {
      id: uid(),
      title: 'New chat',
      model: settingsRef.current.model,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations((list) => [conv, ...list]);
    return conv;
  }, []);

  const deleteConversation = useCallback((id: string) => {
    controllers.current[id]?.abort();
    setConversations((list) => list.filter((c) => c.id !== id));
  }, []);

  const renameConversation = useCallback(
    (id: string, title: string) => patchConversation(id, (c) => ({ ...c, title, updatedAt: Date.now() })),
    [patchConversation],
  );

  const setConversationModel = useCallback(
    (id: string, model: string) => patchConversation(id, (c) => ({ ...c, model, updatedAt: Date.now() })),
    [patchConversation],
  );

  const clearConversations = useCallback(() => {
    Object.values(controllers.current).forEach((c) => c.abort());
    setConversations([]);
  }, []);

  const applyMemoryOps = useCallback((raw: string) => {
    const { remember, forget } = extractMemoryOps(raw);
    if (!remember.length && !forget.length) return;
    setMemories((list) => {
      const lower = (s: string) => s.toLowerCase().trim();
      let next = list.filter(
        (m) => !forget.some((f) => lower(m.text) === lower(f) || lower(m.text).includes(lower(f))),
      );
      for (const text of remember) {
        if (!next.some((m) => lower(m.text) === lower(text))) {
          next = [...next, { id: uid(), text, createdAt: Date.now() }];
        }
      }
      return next;
    });
  }, []);

  const endBusy = useCallback((conversationId: string) => {
    delete controllers.current[conversationId];
    setBusy((b) => {
      const { [conversationId]: _, ...rest } = b;
      return rest;
    });
  }, []);

  /** Runs a completion for the conversation's current history and fills in a new assistant message. */
  const respond = useCallback(
    async (conversationId: string, history: ChatMessage[]) => {
      const conv = convRef.current.find((c) => c.id === conversationId);
      const s = settingsRef.current;
      const model = conv?.model || s.model;
      const assistant: ChatMessage = { id: uid(), role: 'assistant', content: '', createdAt: Date.now() };

      const setAssistant = (patch: Partial<ChatMessage>) =>
        patchConversation(conversationId, (c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) => (m.id === assistant.id ? { ...m, ...patch } : m)),
        }));

      patchConversation(conversationId, (c) => ({
        ...c,
        messages: [...history, assistant],
        updatedAt: Date.now(),
      }));

      if (!model) {
        setAssistant({ error: 'No model selected. Choose one in Settings.' });
        return;
      }

      setBusy((b) => ({ ...b, [conversationId]: true }));
      const controller = new AbortController();
      controllers.current[conversationId] = controller;
      let raw = '';
      try {
        raw = await chat({
          settings: s,
          model,
          messages: buildApiMessages(toolCtx(model), memRef.current, history),
          signal: controller.signal,
          onText: (text) => {
            raw = text;
            setAssistant({ content: display(text) });
          },
        });
      } catch (e) {
        if (!controller.signal.aborted) {
          setAssistant({ content: display(raw), error: e instanceof Error ? e.message : String(e) });
          endBusy(conversationId);
          return;
        }
      }
      delete controllers.current[conversationId];
      if (s.memoryEnabled) applyMemoryOps(raw);

      const { call, before } = controller.signal.aborted ? { call: null, before: raw } : parseToolCall(raw, toolCtx(model));
      if (!call) {
        setAssistant({ content: display(raw) });
        endBusy(conversationId);
        return;
      }

      if (call.status === 'pending' && toolStepsSinceUser(history) < MAX_AUTO_TOOL_STEPS && !needsApproval(call, toolCtx(model))) {
        call.status = 'running';
      }
      const finished: ChatMessage = { ...assistant, content: display(before), toolCall: call };
      setAssistant({ content: finished.content, toolCall: call });
      if (call.status === 'pending') {
        endBusy(conversationId); // wait for the user to approve or deny
        return;
      }
      await continueAfterTool(conversationId, [...history, finished], finished.id);
    },
    [patchConversation, applyMemoryOps, toolCtx],
  );

  /** Runs (or skips, if denied/invalid) the tool on a message, then sends the result back to the model. */
  const continueAfterTool = async (conversationId: string, messages: ChatMessage[], messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg?.toolCall) return;
    let call = msg.toolCall;
    const setCall = (c: typeof call) =>
      patchConversation(conversationId, (conv) => ({
        ...conv,
        messages: conv.messages.map((m) => (m.id === messageId ? { ...m, toolCall: c } : m)),
      }));

    if (call.status === 'pending' || call.status === 'running') {
      call = { ...call, status: 'running' };
      setCall(call);
      setBusy((b) => ({ ...b, [conversationId]: true }));
      // Stop can't cancel a running tool, but it does stop the model from continuing afterwards.
      const controller = new AbortController();
      controllers.current[conversationId] = controller;
      try {
        const model = convRef.current.find((c) => c.id === conversationId)?.model || settingsRef.current.model;
        call = { ...call, status: 'done', result: await runTool(call, toolCtx(model)) };
      } catch (e) {
        call = { ...call, status: 'error', result: e instanceof Error ? e.message : String(e) };
      }
      setCall(call);
      if (controller.signal.aborted) {
        endBusy(conversationId);
        return;
      }
    }

    const resultMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: formatToolResult(call),
      toolResult: true,
      createdAt: Date.now(),
    };
    const next = messages.map((m) => (m.id === messageId ? { ...m, toolCall: call } : m));
    await respondRef.current(conversationId, [...next, resultMsg]);
  };

  const respondRef = useRef(respond);
  respondRef.current = respond;

  const approveTool = useCallback(async (conversationId: string, messageId: string) => {
    const conv = convRef.current.find((c) => c.id === conversationId);
    if (conv) await continueAfterTool(conversationId, conv.messages, messageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const denyTool = useCallback(async (conversationId: string, messageId: string) => {
    const conv = convRef.current.find((c) => c.id === conversationId);
    if (!conv) return;
    const messages = conv.messages.map((m) =>
      m.id === messageId && m.toolCall ? { ...m, toolCall: { ...m.toolCall, status: 'denied' as const } } : m,
    );
    patchConversation(conversationId, (c) => ({ ...c, messages }));
    await continueAfterTool(conversationId, messages, messageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(
    async (conversationId: string, text: string) => {
      const conv = convRef.current.find((c) => c.id === conversationId);
      if (!conv || !text.trim()) return;
      const userMsg: ChatMessage = { id: uid(), role: 'user', content: text.trim(), createdAt: Date.now() };
      if (conv.messages.length === 0) renameConversation(conversationId, titleFrom(text));
      await respond(conversationId, [...conv.messages, userMsg]);
    },
    [respond, renameConversation],
  );

  const regenerate = useCallback(
    async (conversationId: string) => {
      const conv = convRef.current.find((c) => c.id === conversationId);
      if (!conv) return;
      const history = [...conv.messages];
      while (history.length && history[history.length - 1].role === 'assistant') history.pop();
      if (history.length) await respond(conversationId, history);
    },
    [respond],
  );

  const stop = useCallback((conversationId: string) => {
    controllers.current[conversationId]?.abort();
  }, []);

  const addMemory = useCallback((text: string) => {
    if (!text.trim()) return;
    const now = Date.now();
    setMemories((list) => [...list, { id: uid(), text: text.trim(), createdAt: now, updatedAt: now }]);
  }, []);

  const updateMemory = useCallback((id: string, text: string) => {
    setMemories((list) => list.map((m) => (m.id === id ? { ...m, text, updatedAt: Date.now() } : m)));
  }, []);

  const deleteMemory = useCallback((id: string) => {
    setMemories((list) => list.filter((m) => m.id !== id));
  }, []);

  const clearMemories = useCallback(() => setMemories([]), []);

  return (
    <StoreContext.Provider
      value={{
        ready,
        settings,
        conversations,
        memories,
        skills,
        mcpServers,
        mcpTools,
        mcpErrors,
        account,
        syncStatus,
        busy,
        saveSkill,
        deleteSkill,
        saveMcpServer,
        deleteMcpServer,
        refreshMcpTools,
        signIn,
        signOut,
        syncNow,
        updateSettings,
        createConversation,
        deleteConversation,
        renameConversation,
        setConversationModel,
        clearConversations,
        send,
        regenerate,
        stop,
        approveTool,
        denyTool,
        addMemory,
        updateMemory,
        deleteMemory,
        clearMemories,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
