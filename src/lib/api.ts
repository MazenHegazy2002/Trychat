import { fetch } from 'expo/fetch';

import type { Role, Settings } from './types';

/** Client for an OpenAI-compatible server (`/models`, `/chat/completions`). */

export type ApiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ApiMessage {
  role: Role;
  /** Plain text, or text + images in the OpenAI vision format. */
  content: string | ApiContentPart[];
}

function endpoint(settings: Settings, path: string): string {
  return settings.baseUrl.replace(/\/+$/, '') + path;
}

function headers(settings: Settings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) h.Authorization = `Bearer ${settings.apiKey}`;
  return h;
}

async function errorFrom(res: { status: number; text(): Promise<string> }): Promise<Error> {
  const body = await res.text().catch(() => '');
  let message = body;
  try {
    const json = JSON.parse(body);
    message = json?.error?.message ?? json?.message ?? body;
  } catch {
    // not JSON; keep raw body
  }
  return new Error(`HTTP ${res.status}${message ? `: ${message.slice(0, 500)}` : ''}`);
}

export async function listModels(settings: Settings): Promise<string[]> {
  const res = await fetch(endpoint(settings, '/models'), { headers: headers(settings) });
  if (!res.ok) throw await errorFrom(res);
  const json = await res.json();
  const items: { id: string }[] = Array.isArray(json) ? json : (json.data ?? json.models ?? []);
  return items.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean).sort();
}

export interface ChatOptions {
  settings: Settings;
  model: string;
  messages: ApiMessage[];
  signal?: AbortSignal;
  /** Called with the full text accumulated so far. */
  onText: (text: string) => void;
}

/** Sends a chat completion, streaming tokens when enabled. Resolves with the final text. */
export async function chat({ settings, model, messages, signal, onText }: ChatOptions): Promise<string> {
  const res = await fetch(endpoint(settings, '/chat/completions'), {
    method: 'POST',
    headers: headers(settings),
    body: JSON.stringify({
      model,
      messages,
      temperature: settings.temperature,
      stream: settings.stream,
    }),
    signal,
  });
  if (!res.ok) throw await errorFrom(res);

  const contentType = res.headers.get('content-type') ?? '';
  const isStream = settings.stream && res.body && !contentType.includes('application/json');

  if (!isStream) {
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? '';
    onText(text);
    return text;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const json = JSON.parse(data);
      if (json.error) throw new Error(json.error.message ?? String(json.error));
      const delta: string | undefined =
        json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content;
      if (delta) {
        text += delta;
        onText(text);
      }
    } catch (e) {
      if (e instanceof SyntaxError) return; // partial or non-JSON keep-alive line
      throw e;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handleLine);
  }
  if (buffer) handleLine(buffer);
  return text;
}
