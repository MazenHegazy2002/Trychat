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
  messages: ChatMessage[];
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
  enabled: boolean;
  /** Ask before every tool call on this server. */
  confirm: boolean;
  updatedAt: number;
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
  /** When synced preferences last changed (drives last-write-wins across devices). */
  prefsUpdatedAt?: number;
}
