export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** Set when the request for this assistant message failed. */
  error?: string;
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
}
