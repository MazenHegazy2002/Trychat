import { chat } from './api';
import type { ApiMessage } from './api';
import { formatToolCall, formatToolResult, getTools, needsApproval, parseToolCall, runTool, toolInstructions } from './tools';
import type { ToolContext } from './tools';
import { appendTask, withTask } from './tasks';

/**
 * Sub-agents: independent model runs started by the main assistant via `agents.run`.
 * Each gets its own task and may use tools that don't need the user's approval
 * (reads, code.run, skills) — never commands, writes, or further sub-agents.
 */

const MAX_STEPS = 8;

export interface SubAgentTask {
  task: string;
  model?: string;
  /** Name of a plugin agent ("plugin:agent") whose system prompt to use. */
  agent?: string;
}

async function runOne(ctx: ToolContext, defaultModel: string, { task, model, agent }: SubAgentTask): Promise<string> {
  // A plugin agent's `model` names Claude models (sonnet/opus/inherit), so it's ignored here:
  // only a model id the assistant passes explicitly overrides the chat's model.
  const profile = agent ? ctx.agentProfiles?.find((p) => p.name === agent) : undefined;
  const subCtx: ToolContext = { ...ctx, runSubAgents: undefined };
  // Only reads, code.run and MCP tools the user lets run without asking — never commands, writes, installs or more
  // sub-agents, even when the user turned confirmations off for the main chat.
  const available = getTools(subCtx);
  const safe = (name: string) => {
    const kind = available[name]?.kind;
    return (kind === 'read' || kind === 'code' || kind === 'mcp') && !needsApproval({ name, args: {}, status: 'pending' }, ctx);
  };
  const tools = toolInstructions(subCtx, (name) => safe(name));
  const messages: ApiMessage[] = [
    {
      role: 'system',
      content: [
        profile?.prompt,
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
    // Checked with the real arguments: code.run needs approval (so isn't allowed here) when the code uses the network.
    if (call.status === 'pending' && safe(call.name) && !needsApproval(call, ctx)) {
      try {
        call.result = await runTool(call, subCtx);
        call.status = 'done';
      } catch (e) {
        call.result = e instanceof Error ? e.message : String(e);
        call.status = 'error';
      }
    } else if (call.status === 'pending') {
      call.status = 'error';
      call.result =
        call.name === 'code.run'
          ? 'Sub-agents can only run code that doesn’t use the network. Finish with what you have, or say what the main assistant should do.'
          : 'Sub-agents cannot use this tool. Finish with what you have, or say what the main assistant should do.';
    }
    messages.push({ role: 'user', content: formatToolResult(call) });
  }
  messages.push({ role: 'user', content: 'Step limit reached. Give your best final answer now without tools.' });
  return (await chat({ settings, model: model || defaultModel, messages, onText: () => {} })).trim();
}

export async function runSubAgents(ctx: ToolContext, model: string, tasks: SubAgentTask[]): Promise<string> {
  const results = await Promise.allSettled(
    tasks.map((t) =>
      withTask({ kind: 'subagent', title: `Sub-agent: ${t.task.slice(0, 100)}`, conversationId: ctx.conversationId }, async (id) => {
        const answer = await runOne(ctx, model, t);
        appendTask(id, answer);
        return answer;
      }),
    ),
  );
  return results
    .map((r, i) => {
      const who = tasks[i].agent ? ` (${tasks[i].agent})` : '';
      const head = `## Sub-agent ${i + 1}${who}: ${tasks[i].task.slice(0, 120)}`;
      return r.status === 'fulfilled' ? `${head}\n${r.value}` : `${head}\nFailed: ${r.reason?.message ?? r.reason}`;
    })
    .join('\n\n');
}
