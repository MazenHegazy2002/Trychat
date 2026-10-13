import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import { runSubAgents } from './agents';
import { deleteAttachmentFiles, messageContent } from './attachments';
import { chat } from './api';
import { uid } from './id';
import { carryOverSettings } from './pluginInstaller';
import { buildApiMessages, extractMemoryOps, stripMemoryTags } from './prompt';
import * as storage from './storage';
import { listMcpTools } from './mcp';
import { pluginAgents, pluginMcpServers, pluginSkills, slashCommands } from './plugins';
import type { SlashCommand } from './plugins';
import * as sync from './sync';
import { formatToolResult, needsApproval, parseToolCall, runToolCall, stripToolTags } from './tools';
import type { ToolContext } from './tools';
import type { Account, Attachment, ChatMessage, Conversation, InstallItem, McpServer, McpTool, Memory, Plugin, Project, Settings, Skill } from './types';

export type SyncStatus = { state: 'idle' | 'syncing' | 'error'; error?: string };

interface Store {
  ready: boolean;
  settings: Settings;
  conversations: Conversation[];
  memories: Memory[];
  skills: Skill[];
  projects: Project[];
  mcpServers: McpServer[];
  plugins: Plugin[];
  /** MCP servers from enabled plugins (shown read-only; their tools load like any server's). */
  pluginServers: McpServer[];
  /** Slash commands from enabled plugins. */
  commands: SlashCommand[];
  /** Adds a plugin, or replaces one with the same id (keeping the user's enabled/config/secrets). */
  installPlugin: (plugin: Plugin) => void;
  /** Saves changes to an installed plugin (enabled switch, settings). */
  updatePlugin: (plugin: Plugin) => void;
  uninstallPlugin: (id: string) => void;
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
  /** Pass a function to build the patch from the latest settings (safe across awaits). */
  updateSettings: (patch: Partial<Settings> | ((prev: Settings) => Partial<Settings>)) => Promise<void>;
  createConversation: (projectId?: string) => Conversation;
  /** Creates or updates a project. */
  saveProject: (project: Project) => void;
  /** Deletes a project; its chats move out of it (they are kept). */
  deleteProject: (id: string) => void;
  moveConversation: (conversationId: string, projectId: string | undefined) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setConversationModel: (id: string, model: string) => void;
  clearConversations: () => void;
  /** `displayText` is shown in the bubble instead of `text` (used for expanded slash commands). */
  send: (conversationId: string, text: string, attachments?: Attachment[], displayText?: string) => Promise<void>;
  regenerate: (conversationId: string) => Promise<void>;
  stop: (conversationId: string) => void;
  /**
   * Runs a pending tool. `extra.args` are merged into the call (kept in the chat); `extra.secrets`
   * (e.g. API keys typed into an install card) are only passed to this run.
   */
  approveTool: (conversationId: string, messageId: string, extra?: ToolApproval) => Promise<void>;
  denyTool: (conversationId: string, messageId: string) => Promise<void>;
  addMemory: (text: string) => void;
  updateMemory: (id: string, text: string) => void;
  deleteMemory: (id: string) => void;
  clearMemories: () => void;
}

export interface ToolApproval {
  args?: Record<string, unknown>;
  secrets?: Record<string, string>;
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
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
  const projectsRef = useRef(projects);
  const pluginsRef = useRef(plugins);
  const mcpRef = useRef(mcpServers);
  const mcpToolsRef = useRef(mcpTools);
  const accountRef = useRef(account);
  const busyRef = useRef(busy);
  convRef.current = conversations;
  memRef.current = memories;
  settingsRef.current = settings;
  skillsRef.current = skills;
  projectsRef.current = projects;
  pluginsRef.current = plugins;
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
      storage.loadProjects(),
      storage.loadPlugins(),
    ]).then(([s, c, m, k, servers, acct, p, pl]) => {
      setProjects(p);
      setPlugins(pl);
      setSettings(s);
      setConversations(c);
      setMemories(m);
      setSkills(k);
      setMcpServers(servers);
      setAccount(acct);
      setReady(true);
    });
  }, []);

  /** User MCP servers plus those from enabled plugins. */
  const allMcpServers = useCallback(() => [...mcpRef.current, ...pluginMcpServers(pluginsRef.current)], []);

  // Set further down (it needs installPlugin, saveSkill and saveMcpServer); used by store.install.
  const installRef = useRef<(item: InstallItem) => Promise<string>>(async () => 'Not ready');

  /** Everything tools need, using the latest state. Plugin skills, servers and agents are merged in. */
  const toolCtx = useCallback(
    (model: string): ToolContext => {
      const base: ToolContext = {
        settings: settingsRef.current,
        skills: [...skillsRef.current, ...pluginSkills(pluginsRef.current)],
        mcpServers: allMcpServers(),
        mcpTools: mcpToolsRef.current,
        agentProfiles: pluginAgents(pluginsRef.current),
        account: accountRef.current,
        install: (item) => installRef.current(item),
        plugins: pluginsRef.current,
      };
      return { ...base, runSubAgents: (tasks) => runSubAgents(base, model, tasks) };
    },
    [allMcpServers],
  );

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
    if (ready) storage.saveProjects(projects);
  }, [projects, ready]);

  useEffect(() => {
    if (ready) storage.savePlugins(plugins);
  }, [plugins, ready]);

  useEffect(() => {
    if (ready) storage.saveMcpServers(mcpServers);
  }, [mcpServers, ready]);

  // ---------- MCP ----------

  const refreshMcpTools = useCallback(async (serverId?: string) => {
    const targets = allMcpServers().filter((x) => x.enabled && (!serverId || x.id === serverId));
    await Promise.all(
      targets.map(async (server) => {
        try {
          const tools = await listMcpTools(server);
          // The ref too, so a reply that is already running sees the tools (store.install waits for this).
          mcpToolsRef.current = { ...mcpToolsRef.current, [server.id]: tools };
          setMcpTools((t) => ({ ...t, [server.id]: tools }));
          setMcpErrors(({ [server.id]: _, ...rest }) => rest);
        } catch (e) {
          setMcpTools(({ [server.id]: _, ...rest }) => rest);
          setMcpErrors((errs) => ({ ...errs, [server.id]: e instanceof Error ? e.message : String(e) }));
        }
      }),
    );
  }, [allMcpServers]);

  // Discover MCP tools whenever the server list (including plugin servers) changes.
  const pluginServers = pluginMcpServers(plugins);
  const mcpKey = [...mcpServers, ...pluginServers]
    .map((x) => `${x.id}:${x.url}:${x.transport ?? ''}:${x.enabled}:${x.token ?? ''}:${JSON.stringify(x.headers ?? {})}:${JSON.stringify(x.urlSecrets ?? {})}`)
    .join('|');
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
        projects: projectsRef.current,
        plugins: pluginsRef.current,
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
      setProjects((list) => sync.mergeList(list, items, 'projects', (p) => p.updatedAt));
      setPlugins((list) => sync.mergeList(list, items, 'plugins', (p) => p.updatedAt, sync.syncedPlugin));
      setMcpServers((list) => sync.mergeList(list, items, 'mcpServers', (x) => x.updatedAt, sync.syncedMcpServer));
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
  }, [ready, account?.token, memories, conversations, skills, projects, plugins, mcpServers, settings, busy]);

  const accountToken = account?.token;
  useEffect(() => {
    if (!ready || !accountToken) return;
    const interval = setInterval(syncNow, 60_000);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && syncNow());
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [ready, accountToken, syncNow]);

  const patchConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((list) => list.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const updateSettings = useCallback(async (input: Partial<Settings> | ((prev: Settings) => Partial<Settings>)) => {
    const patch = typeof input === 'function' ? input(settingsRef.current) : input;
    const touchesPrefs = Object.keys(patch).some((k) => (sync.SYNCED_PREFS as readonly string[]).includes(k));
    const next = { ...settingsRef.current, ...patch, ...(touchesPrefs ? { prefsUpdatedAt: Date.now() } : {}) };
    settingsRef.current = next;
    setSettings(next);
    await storage.saveSettings(next);
  }, []);

  const createConversation = useCallback((projectId?: string) => {
    const now = Date.now();
    const conv: Conversation = {
      id: uid(),
      title: 'New chat',
      model: settingsRef.current.model,
      ...(projectId ? { projectId } : {}),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations((list) => [conv, ...list]);
    return conv;
  }, []);

  const installPlugin = useCallback((plugin: Plugin) => {
    const now = Date.now();
    setPlugins((list) => {
      const old = list.find((p) => p.id === plugin.id);
      const next: Plugin = old
        ? {
            ...plugin,
            enabled: old.enabled,
            ...carryOverSettings(old, plugin),
            installedAt: old.installedAt,
            updatedAt: now,
          }
        : { ...plugin, updatedAt: now };
      return old ? list.map((p) => (p.id === plugin.id ? next : p)) : [next, ...list];
    });
  }, []);

  const updatePlugin = useCallback((plugin: Plugin) => {
    setPlugins((list) => list.map((p) => (p.id === plugin.id ? { ...plugin, updatedAt: Date.now() } : p)));
  }, []);

  const uninstallPlugin = useCallback((id: string) => {
    setPlugins((list) => list.filter((p) => p.id !== id));
  }, []);

  /** Lists an MCP server's tools now, so the reply that installed it can use them in its next step. */
  const discoverTools = async (server: McpServer): Promise<string> => {
    try {
      const tools = await listMcpTools(server);
      mcpToolsRef.current = { ...mcpToolsRef.current, [server.id]: tools };
      setMcpTools((t) => ({ ...t, [server.id]: tools }));
      setMcpErrors(({ [server.id]: _, ...rest }) => rest);
      return `${server.name}: ${tools.length} tool${tools.length === 1 ? '' : 's'} (${tools.map((t) => t.name).join(', ')})`;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setMcpErrors((errs) => ({ ...errs, [server.id]: message }));
      return `${server.name}: couldn’t connect yet (${message})`;
    }
  };

  // store.install: saves what the user approved. Refs are updated right away so the very next model step
  // (which runs before React re-renders) already sees the new skills, commands and tools.
  installRef.current = async (item: InstallItem): Promise<string> => {
    if (item.kind === 'skill') {
      const skill = { ...item.skill, updatedAt: Date.now() };
      saveSkill(skill);
      skillsRef.current = [...skillsRef.current.filter((k) => k.id !== skill.id), skill];
      return `Installed the skill "${skill.name}". Load it with skills.read.`;
    }
    if (item.kind === 'mcp') {
      const server = { ...item.server, updatedAt: Date.now() };
      saveMcpServer(server);
      mcpRef.current = [...mcpRef.current.filter((x) => x.id !== server.id), server];
      return `Added the MCP server. ${await discoverTools(server)}`;
    }
    const plugin = item.plugin;
    installPlugin(plugin);
    pluginsRef.current = [{ ...plugin, updatedAt: Date.now() }, ...pluginsRef.current.filter((p) => p.id !== plugin.id)];
    const servers = pluginMcpServers([plugin]);
    const found = await Promise.all(servers.map(discoverTools));
    const parts = [
      plugin.skills.length && `${plugin.skills.length} skill(s)`,
      plugin.commands.length && `${plugin.commands.length} command(s)`,
      plugin.agents.length && `${plugin.agents.length} agent(s)`,
      servers.length && `${servers.length} MCP server(s)`,
    ].filter(Boolean);
    return [`Installed the plugin "${plugin.displayName ?? plugin.name}"${parts.length ? ` with ${parts.join(', ')}` : ''}.`, ...found].join('\n');
  };

  const saveProject = useCallback((project: Project) => {
    const next = { ...project, updatedAt: Date.now() };
    setProjects((list) => (list.some((p) => p.id === project.id) ? list.map((p) => (p.id === project.id ? next : p)) : [next, ...list]));
  }, []);

  const deleteProject = useCallback((id: string) => {
    deleteAttachmentFiles(projectsRef.current.find((p) => p.id === id)?.files);
    setProjects((list) => list.filter((p) => p.id !== id));
    const now = Date.now();
    setConversations((list) =>
      list.map((c) => (c.projectId === id ? { ...c, projectId: undefined, updatedAt: now } : c)),
    );
  }, []);

  const moveConversation = useCallback(
    (conversationId: string, projectId: string | undefined) =>
      patchConversation(conversationId, (c) => ({ ...c, projectId, updatedAt: Date.now() })),
    [patchConversation],
  );

  const deleteConversation = useCallback((id: string) => {
    controllers.current[id]?.abort();
    deleteAttachmentFiles(convRef.current.find((c) => c.id === id)?.messages.flatMap((m) => m.attachments ?? []));
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

  // respond() and continueAfterTool() call each other; the ref breaks the cycle for useCallback.
  const continueAfterToolRef = useRef<
    (conversationId: string, messages: ChatMessage[], messageId: string, extra?: ToolApproval) => Promise<void>
  >(async () => {});

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
          messages: buildApiMessages(
            toolCtx(model),
            memRef.current,
            history,
            await messageContent(history),
            projectsRef.current.find((p) => p.id === conv?.projectId),
          ),
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
      await continueAfterToolRef.current(conversationId, [...history, finished], finished.id);
    },
    [patchConversation, applyMemoryOps, toolCtx, endBusy],
  );

  /** Runs (or skips, if denied/invalid) the tool on a message, then sends the result back to the model. */
  const continueAfterTool = async (conversationId: string, messages: ChatMessage[], messageId: string, extra?: ToolApproval) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg?.toolCall) return;
    let call = msg.toolCall;
    if (extra?.args && call.status === 'pending') call = { ...call, args: { ...call.args, ...extra.args } };
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
        const { result, files } = await runToolCall(call, { ...toolCtx(model), approval: { secrets: extra?.secrets } });
        call = { ...call, status: 'done', result, ...(files ? { files } : {}) };
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
  continueAfterToolRef.current = continueAfterTool;

  const approveTool = useCallback(async (conversationId: string, messageId: string, extra?: ToolApproval) => {
    const conv = convRef.current.find((c) => c.id === conversationId);
    if (conv) await continueAfterToolRef.current(conversationId, conv.messages, messageId, extra);
  }, []);

  const denyTool = useCallback(async (conversationId: string, messageId: string) => {
    const conv = convRef.current.find((c) => c.id === conversationId);
    if (!conv) return;
    const messages = conv.messages.map((m) =>
      m.id === messageId && m.toolCall ? { ...m, toolCall: { ...m.toolCall, status: 'denied' as const } } : m,
    );
    patchConversation(conversationId, (c) => ({ ...c, messages }));
    await continueAfterToolRef.current(conversationId, messages, messageId);
  }, [patchConversation]);

  const send = useCallback(
    async (conversationId: string, text: string, attachments: Attachment[] = [], displayText?: string) => {
      const conv = convRef.current.find((c) => c.id === conversationId);
      if (!conv || (!text.trim() && !attachments.length)) return;
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: text.trim(),
        createdAt: Date.now(),
        ...(attachments.length ? { attachments } : {}),
        ...(displayText ? { displayText } : {}),
      };
      if (conv.messages.length === 0) renameConversation(conversationId, titleFrom(displayText || text || attachments[0].name));
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
        projects,
        mcpServers,
        plugins,
        pluginServers,
        commands: slashCommands(plugins),
        installPlugin,
        updatePlugin,
        uninstallPlugin,
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
        saveProject,
        deleteProject,
        moveConversation,
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
