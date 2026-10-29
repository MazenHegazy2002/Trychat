import type { ApiContentPart, ApiMessage } from './api';
import { formatToolCall, toolInstructions } from './tools';
import type { ToolContext } from './tools';
import type { ChatMessage, Memory, Project } from './types';

const MEMORY_INSTRUCTIONS = `You have a long-term memory that persists across all conversations with this user.
When the user tells you something worth remembering long-term (their name, preferences, goals, projects, facts about them),
or explicitly asks you to remember something, save it by writing a line of the form:
<memory>short, self-contained fact</memory>
Only save genuinely useful, durable facts. Do not repeat facts already in memory. The tags are hidden from the user.
To forget a fact the user asks you to forget, write: <forget>exact text of the fact</forget>`;

const BUILDER_INSTRUCTIONS = `Answer in whatever form fits the request best, and keep it natural:
- A question, advice or explanation: plain conversational text. Short answers stay short.
- Steps or options: a numbered or bulleted list. Comparisons or data: a Markdown table.
- A command, snippet or file: a code block in that language (bash, python, json, csv, sql…).
- A diagram: a \`\`\`mermaid block. A simple graphic or icon: an \`\`\`svg block.
- Writing (an email, a story, a post): just the text, no code.
Only write HTML when the user wants something interactive to use or play: an app, game, website, tool or interactive chart.
Then return ONE complete, self-contained HTML file (inline CSS and JavaScript, CDN libraries allowed) in a single \`\`\`html block;
it runs right in the chat, so don't paste the code again or explain it line by line. Make UIs mobile-friendly.
Never wrap an ordinary answer in HTML.`;

/** Max characters of project files put into the prompt (keeps requests within model limits). */
const MAX_PROJECT_FILE_CHARS = 60_000;

function projectSection(project: Project): string {
  const lines = [`This chat is part of the user's project "${project.name}".`];
  if (project.description.trim()) lines.push(`About the project: ${project.description.trim()}`);
  if (project.instructions.trim()) lines.push(`Project instructions (follow these):\n${project.instructions.trim()}`);
  let budget = MAX_PROJECT_FILE_CHARS;
  const files = project.files.filter((f) => f.text);
  if (files.length) {
    lines.push('Project files (reference material the user added):');
    for (const f of files) {
      const text = f.text!.slice(0, Math.max(0, budget));
      budget -= text.length;
      lines.push(`--- ${f.name} ---\n${text}${text.length < f.text!.length ? '\n…[truncated]' : ''}`);
      if (budget <= 0) break;
    }
  }
  return lines.join('\n\n');
}

export function buildSystemPrompt(ctx: ToolContext, memories: Memory[], project?: Project): string {
  const settings = ctx.settings;
  const parts = [settings.systemPrompt.trim()];
  if (project) parts.push(projectSection(project));
  if (settings.builderMode) parts.push(BUILDER_INSTRUCTIONS);
  if (settings.memoryEnabled) {
    parts.push(MEMORY_INSTRUCTIONS);
    parts.push(
      memories.length
        ? `What you remember about the user:\n${memories.map((m) => `- ${m.text}`).join('\n')}`
        : 'You do not remember anything about the user yet.',
    );
  }
  const tools = toolInstructions(ctx);
  if (tools) parts.push(tools);
  parts.push(`Current date: ${new Date().toDateString()}.`);
  return parts.filter(Boolean).join('\n\n');
}

export function buildApiMessages(
  ctx: ToolContext,
  memories: Memory[],
  history: ChatMessage[],
  /** Content for messages with attachments (text + images), keyed by message id. */
  attachmentContent: Map<string, string | ApiContentPart[]> = new Map(),
  project?: Project,
): ApiMessage[] {
  const settings = ctx.settings;
  const recent = history
    .filter((m) => !m.error && (m.content.trim() || m.toolCall || m.attachments?.length))
    .slice(-Math.max(1, settings.contextMessages));
  return [
    { role: 'system', content: buildSystemPrompt(ctx, memories, project) },
    ...recent.map((m) => ({
      role: m.role,
      content: m.toolCall
        ? `${m.content}\n\n${formatToolCall(m.toolCall)}`.trim()
        : (attachmentContent.get(m.id) ?? m.content),
    })),
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
