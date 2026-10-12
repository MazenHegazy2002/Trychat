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
}
