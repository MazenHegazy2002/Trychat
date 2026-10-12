import { chat } from './api';
import type { ApiMessage } from './api';
import { formatToolCall, formatToolResult, needsApproval, parseToolCall, runTool, toolInstructions } from './tools';
import type { ToolContext } from './tools';

/**
 * Sub-agents: independent model runs started by the main assistant via `agents.run`.
 * Each gets its own task and may use tools that don't need the user's approval
 * (reads, code.run, skills) — never commands, writes, or further sub-agents.
 */

const MAX_STEPS = 8;

export interface SubAgentTask {
  task: string;
  model?: string;
}

async function runOne(ctx: ToolContext, defaultModel: string, { task, model }: SubAgentTask): Promise<string> {
  const safe = (name: string) => name !== 'agents.run' && !needsApproval({ name, args: {}, status: 'pending' }, ctx);
  const subCtx: ToolContext = { ...ctx, runSubAgents: undefined };
  const tools = toolInstructions(subCtx, (name) => safe(name));
  const messages: ApiMessage[] = [
    {
      role: 'system',
      content: [
        'You are a focused sub-agent working for another AI assistant. Complete the task and reply with a clear, self-contained answer — it is passed back verbatim. Be concise; no greetings.',
        tools,
        `Current date: ${new Date().toDateString()}.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    { role: 'user', content: task },
  ];
  const settings = { ...ctx.settings, stream: false };

  for (let step = 0; step < MAX_STEPS; step++) {
    const text = await chat({ settings, model: model || defaultModel, messages, onText: () => {} });
    const { call, before } = parseToolCall(text, subCtx);
    if (!call) return text.trim();
    messages.push({ role: 'assistant', content: `${before}\n\n${formatToolCall(call)}`.trim() });
    if (call.status === 'pending' && safe(call.name)) {
      try {
        call.result = await runTool(call, subCtx);
        call.status = 'done';
      } catch (e) {
        call.result = e instanceof Error ? e.message : String(e);
        call.status = 'error';
      }
    } else if (call.status === 'pending') {
      call.status = 'error';
      call.result = 'Sub-agents cannot use this tool. Finish with what you have, or say what the main assistant should do.';
    }
    messages.push({ role: 'user', content: formatToolResult(call) });
  }
  messages.push({ role: 'user', content: 'Step limit reached. Give your best final answer now without tools.' });
  return (await chat({ settings, model: model || defaultModel, messages, onText: () => {} })).trim();
}

export async function runSubAgents(ctx: ToolContext, model: string, tasks: SubAgentTask[]): Promise<string> {
  const results = await Promise.allSettled(tasks.map((t) => runOne(ctx, model, t)));
  return results
    .map((r, i) => {
      const head = `## Sub-agent ${i + 1}: ${tasks[i].task.slice(0, 120)}`;
      return r.status === 'fulfilled' ? `${head}\n${r.value}` : `${head}\nFailed: ${r.reason?.message ?? r.reason}`;
    })
    .join('\n\n');
}
