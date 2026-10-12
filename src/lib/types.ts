export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** Set when the request for this assistant message failed. */
  error?: string;
  /** A tool the assistant asked to use (GitHub / laptop). */
  toolCall?: ToolCall;
  /** Marks a user-role message that carries a tool result back to the model. */
  toolResult?: boolean;
  /** Photos and files the user attached. */
  attachments?: Attachment[];
  /** What the user typed when `content` is an expanded slash command (shown instead of content). */
  displayText?: string;
}

export interface Attachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  /** Local copy on this device (file://…). */
  uri: string;
  size: number;
  /** Contents of a text/code file, sent to the model. */
  text?: string;
}

export type ToolStatus = 'pending' | 'running' | 'done' | 'denied' | 'error';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  /** The project (folder) this chat belongs to. */
  projectId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** A folder of chats with shared instructions and reference files (like Claude Projects). */
export interface Project {
  id: string;
  name: string;
  description: string;
  /** Added to the system prompt of every chat in the project. */
  instructions: string;
  /** Reference files; their text is shared with every chat in the project. */
  files: Attachment[];
  createdAt: number;
  updatedAt: number;
}

export interface Memory {
  id: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
}

/** Reusable instructions the model can load when a task matches (like Claude skills). */
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  /** Where it was imported from, e.g. a GitHub URL. */
  source?: string;
  updatedAt: number;
}

/** A remote MCP server (Streamable HTTP transport). */
export interface McpServer {
  id: string;
  name: string;
  url: string;
  /** Sent as `Authorization: Bearer <token>`; kept on this device only. */
  token?: string;
  /** Extra HTTP headers (used by plugin-provided servers). */
  headers?: Record<string, string>;
  /** Secret values for {name} placeholders left in `url` (e.g. an API key); kept on this device only. */
  urlSecrets?: Record<string, string>;
  enabled: boolean;
  /** Ask before every tool call on this server. */
  confirm: boolean;
  updatedAt: number;
  /** Set for servers that come from a plugin (read-only in the MCP screen). */
  pluginId?: string;
  /** Registry id (e.g. "com.notion/mcp") when added from the Store. */
  registryName?: string;
}

/**
 * A plugin in the Claude Code plugin format (.claude-plugin/plugin.json + skills/, commands/,
 * agents/, .mcp.json). Components a phone can't run (hooks, local MCP servers, LSP, bin/…) are
 * listed in `unsupported` instead.
 */
export interface Plugin {
  /** `${name}@${marketplace}` for marketplace installs, `${name}@${owner}/${repo}` otherwise. */
  id: string;
  name: string;
  displayName?: string;
  version?: string;
  description: string;
  author?: string;
  homepage?: string;
  /** The GitHub link it was installed from (repo, folder or marketplace). */
  source: string;
  /** Marketplace name, when installed from one. */
  marketplace?: string;
  enabled: boolean;
  skills: PluginSkill[];
  commands: PluginCommand[];
  agents: PluginAgent[];
  mcpServers: PluginMcpServer[];
  /** Settings the plugin asks the user for (plugin.json `userConfig`). */
  userConfig: PluginConfigField[];
  /** Values for the non-sensitive userConfig fields (synced). */
  config: Record<string, string | number | boolean>;
  /** Values for sensitive userConfig fields — kept on this device only, never synced. */
  secrets?: Record<string, string>;
  /** Human-readable notes on parts that can't run on a phone, e.g. "Hooks", "2 local MCP servers". */
  unsupported: string[];
  installedAt: number;
  updatedAt: number;
}

export interface PluginSkill {
  name: string;
  description: string;
  instructions: string;
}

/** A slash command: `/name args` expands to `content` ($ARGUMENTS, $1…$9 substituted). */
export interface PluginCommand {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
}

/** A custom agent the main assistant can delegate to through agents.run. */
export interface PluginAgent {
  name: string;
  description: string;
  /** System prompt (the agent file's Markdown body). */
  prompt: string;
  model?: string;
}

/** A remote MCP server from a plugin. May reference ${user_config.KEY}. */
export interface PluginMcpServer {
  name: string;
  url: string;
  transport: 'http' | 'sse';
  headers?: Record<string, string>;
}

export interface PluginConfigField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'directory' | 'file';
  title: string;
  description: string;
  required?: boolean;
  default?: string | number | boolean | string[];
  sensitive?: boolean;
  options?: string[];
  multiple?: boolean;
  min?: number;
  max?: number;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface Account {
  serverUrl: string;
  token: string;
  user: { id: string; email: string; name: string };
  /** Sync cursor (server sequence number) and when we last synced. */
  cursor: number;
  lastSyncAt?: number;
}

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  /** Adds instructions so the model returns complete, runnable single-file apps. */
  builderMode: boolean;
  /** Lets the model save long-term memories with <memory> tags. */
  memoryEnabled: boolean;
  stream: boolean;
  temperature: number;
  /** How many of the most recent messages are sent with each request. */
  contextMessages: number;
  /** GitHub personal access token (secure storage). */
  githubToken: string;
  /** Address of the laptop bridge, e.g. http://192.168.1.24:8765 */
  bridgeUrl: string;
  /** Pairing code printed by the laptop bridge (secure storage). */
  bridgeToken: string;
  /** Ask before laptop commands. */
  confirmCommands: boolean;
  /** Ask before writing files on the laptop or GitHub and creating issues. */
  confirmWrites: boolean;
  /** Ask before reading files / listing repos. */
  confirmReads: boolean;
  /** GitHub repos ("owner/name") the model should know about and work in. */
  repos: string[];
  /** Let the model start sub-agents for parallel work. */
  subAgents: boolean;
  /** Let the model run JavaScript / Python on the phone. */
  codeExecution: boolean;
  /** Plugin marketplaces the user added to the Store ("owner/repo"). */
  marketplaces: string[];
  /** When synced preferences last changed (drives last-write-wins across devices). */
  prefsUpdatedAt?: number;
}
