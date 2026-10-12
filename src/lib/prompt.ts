import type { ApiMessage } from './api';
import type { ChatMessage, Memory, Settings } from './types';

const MEMORY_INSTRUCTIONS = `You have a long-term memory that persists across all conversations with this user.
When the user tells you something worth remembering long-term (their name, preferences, goals, projects, facts about them),
or explicitly asks you to remember something, save it by writing a line of the form:
<memory>short, self-contained fact</memory>
Only save genuinely useful, durable facts. Do not repeat facts already in memory. The tags are hidden from the user.
To forget a fact the user asks you to forget, write: <forget>exact text of the fact</forget>`;

const BUILDER_INSTRUCTIONS = `You can build anything the user asks for: apps, games, websites, tools, scripts.
When building something that runs in a browser, return ONE complete, self-contained HTML file
(inline CSS and JavaScript, CDN libraries allowed) in a single \`\`\`html code block, so the user can tap "Preview" to run it on their phone.
Make UIs mobile-friendly. For other languages, return complete, runnable code with brief instructions.`;

export function buildSystemPrompt(settings: Settings, memories: Memory[]): string {
  const parts = [settings.systemPrompt.trim()];
  if (settings.builderMode) parts.push(BUILDER_INSTRUCTIONS);
  if (settings.memoryEnabled) {
    parts.push(MEMORY_INSTRUCTIONS);
    parts.push(
      memories.length
        ? `What you remember about the user:\n${memories.map((m) => `- ${m.text}`).join('\n')}`
        : 'You do not remember anything about the user yet.',
    );
  }
  parts.push(`Current date: ${new Date().toDateString()}.`);
  return parts.filter(Boolean).join('\n\n');
}

export function buildApiMessages(
  settings: Settings,
  memories: Memory[],
  history: ChatMessage[],
): ApiMessage[] {
  const recent = history
    .filter((m) => !m.error && m.content.trim())
    .slice(-Math.max(1, settings.contextMessages));
  return [
    { role: 'system', content: buildSystemPrompt(settings, memories) },
    ...recent.map((m) => ({ role: m.role, content: m.content })),
  ];
}

const MEMORY_RE = /<memory>([\s\S]*?)<\/memory>/gi;
const FORGET_RE = /<forget>([\s\S]*?)<\/forget>/gi;

/** Removes memory tags (including an unfinished one still streaming) from text shown to the user. */
export function stripMemoryTags(text: string): string {
  return text
    .replace(MEMORY_RE, '')
    .replace(FORGET_RE, '')
    .replace(/<(memory|forget)>[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractMemoryOps(text: string): { remember: string[]; forget: string[] } {
  const grab = (re: RegExp) =>
    [...text.matchAll(re)].map((m) => m[1].trim()).filter(Boolean);
  return { remember: grab(MEMORY_RE), forget: grab(FORGET_RE) };
}
