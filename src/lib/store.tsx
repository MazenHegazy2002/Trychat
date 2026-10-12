import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { chat } from './api';
import { uid } from './id';
import { buildApiMessages, extractMemoryOps, stripMemoryTags } from './prompt';
import * as storage from './storage';
import type { ChatMessage, Conversation, Memory, Settings } from './types';

interface Store {
  ready: boolean;
  settings: Settings;
  conversations: Conversation[];
  memories: Memory[];
  /** Conversation ids with a request in flight. */
  busy: Record<string, boolean>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  createConversation: () => Conversation;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setConversationModel: (id: string, model: string) => void;
  clearConversations: () => void;
  send: (conversationId: string, text: string) => Promise<void>;
  regenerate: (conversationId: string) => Promise<void>;
  stop: (conversationId: string) => void;
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

  // Refs mirror state so async request code always sees the latest values.
  const convRef = useRef(conversations);
  const memRef = useRef(memories);
  const settingsRef = useRef(settings);
  const controllers = useRef<Record<string, AbortController>>({});
  convRef.current = conversations;
  memRef.current = memories;
  settingsRef.current = settings;

  useEffect(() => {
    Promise.all([storage.loadSettings(), storage.loadConversations(), storage.loadMemories()]).then(
      ([s, c, m]) => {
        setSettings(s);
        setConversations(c);
        setMemories(m);
        setReady(true);
      },
    );
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

  const patchConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((list) => list.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
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
    (id: string, title: string) => patchConversation(id, (c) => ({ ...c, title })),
    [patchConversation],
  );

  const setConversationModel = useCallback(
    (id: string, model: string) => patchConversation(id, (c) => ({ ...c, model })),
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

      const controller = new AbortController();
      controllers.current[conversationId] = controller;
      setBusy((b) => ({ ...b, [conversationId]: true }));
      let raw = '';
      try {
        raw = await chat({
          settings: s,
          model,
          messages: buildApiMessages(s, memRef.current, history),
          signal: controller.signal,
          onText: (text) => {
            raw = text;
            setAssistant({ content: stripMemoryTags(text) });
          },
        });
        setAssistant({ content: stripMemoryTags(raw) });
        if (s.memoryEnabled) applyMemoryOps(raw);
      } catch (e) {
        if (controller.signal.aborted) {
          setAssistant({ content: stripMemoryTags(raw) });
        } else {
          setAssistant({ content: stripMemoryTags(raw), error: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        delete controllers.current[conversationId];
        setBusy((b) => {
          const { [conversationId]: _, ...rest } = b;
          return rest;
        });
      }
    },
    [patchConversation, applyMemoryOps],
  );

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
    setMemories((list) => [...list, { id: uid(), text: text.trim(), createdAt: Date.now() }]);
  }, []);

  const updateMemory = useCallback((id: string, text: string) => {
    setMemories((list) => list.map((m) => (m.id === id ? { ...m, text } : m)));
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
        busy,
        updateSettings,
        createConversation,
        deleteConversation,
        renameConversation,
        setConversationModel,
        clearConversations,
        send,
        regenerate,
        stop,
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
