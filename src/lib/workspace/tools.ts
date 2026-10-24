import { textPage } from '../github';
import type { Args, ToolContext, ToolDef } from '../tools';
import { commitChangeset, normPath } from './core';
import { describeWorkspace, wsDelete, wsDiffText, wsList, wsRead, wsSearch, wsWrite } from './backends';
import { getWorkspace, patchWorkspace } from './store';

/** ws.* tools for the workspace attached to the current chat. */
export function workspaceTools(ctx: ToolContext): Record<string, ToolDef> {
  const ws = getWorkspace(ctx.workspaceId);
  if (!ws) return {};
  const gh = ws.kind === 'github';
  const cur = () => {
    const w = getWorkspace(ws.id);
    if (!w) throw new Error('The attached workspace was removed.');
    return w;
  };
  const tools: Record<string, Omit<ToolDef, 'service'>> = {
    'ws.list': {
      kind: 'read',
      description: 'List a folder of the attached workspace ("" = root). Staged changes are marked.',
      params: '{"path":"optional/folder"}',
      label: (a: Args) => `Listed ${a.path || 'the workspace'}`,
      run: async (c, a) => {
        const list = await wsList(c.settings, cur(), a.path);
        return list.map((e) => `${e.path}${e.isDir ? '/' : ''}${e.status ? ` (${e.status})` : ''}`).join('\n') || '(empty folder)';
      },
    },
    'ws.read': {
      kind: 'read',
      description: 'Read a text file of the attached workspace (staged version if changed). Long files come in pages; continue with "offset" (a line number).',
      params: '{"path":"src/app.ts","offset":"optional start line"}',
      label: (a: Args) => `Read ${a.path}`,
      run: async (c, a) => {
        const text = await wsRead(c.settings, cur(), a.path);
        return textPage(normPath(a.path), text.length, text, a.offset, a.limit);
      },
    },
    'ws.search': {
      kind: 'read',
      description: 'Find files by name, and lines containing the text where possible, in the attached workspace.',
      params: '{"query":"useStore"}',
      label: (a: Args) => `Searched the workspace for “${a.query ?? ''}”`,
      run: async (c, a) => (await wsSearch(c.settings, cur(), String(a.query ?? ''))).join('\n') || 'No matches.',
    },
    'ws.write': {
      kind: 'write',
      description: gh
        ? 'Create or replace a file (full content). This STAGES the change locally; nothing reaches GitHub until ws.commit.'
        : 'Create or replace a file (full content). Saved directly.',
      params: '{"path":"src/app.ts","content":"full file text"}',
      label: (a: Args) => `${gh ? 'Stage' : 'Write'} ${a.path}`,
      run: async (c, a) => {
        if (typeof a.content !== 'string') throw new Error('"content" is required: the full new file text.');
        return wsWrite(c.settings, cur(), a.path, a.content);
      },
    },
    'ws.delete': {
      kind: 'write',
      description: gh ? 'Stage deletion of a file or folder.' : 'Delete a file or folder (directly).',
      params: '{"path":"old/file.ts"}',
      label: (a: Args) => `${gh ? 'Stage deletion of' : 'Delete'} ${a.path}`,
      run: (c, a) => wsDelete(c.settings, cur(), a.path),
    },
    'ws.diff': {
      kind: 'read',
      description: 'Show the staged changes as a unified diff (optionally for one path).',
      params: '{"path":"optional"}',
      label: () => 'Showed the staged diff',
      run: (c, a) => wsDiffText(c.settings, cur(), a.path ? normPath(a.path) : undefined),
    },
  };
  if (gh) {
    tools['ws.commit'] = {
      kind: 'write',
      description:
        'Commit ALL staged changes as one commit to the current branch, or to a new "branch" made from it; with "pr" also open a pull request into the current branch. Always asks the user.',
      params: '{"message":"Fix login bug","branch":"optional new-branch","pr":"optional {\\"title\\":\\"…\\",\\"body\\":\\"…\\"}"}',
      label: (a: Args) => `Commit “${String(a.message ?? '').split('\n')[0]}”${a.branch ? ` to ${a.branch}` : ''}${a.pr ? ' + PR' : ''}`,
      run: async (c, a) => {
        const w = cur();
        const pr = a.pr ? (typeof a.pr === 'object' ? a.pr : { title: String(a.pr) === 'true' ? '' : String(a.pr) }) : undefined;
        if (pr && !a.branch) throw new Error('A pull request needs a new "branch".');
        const r = await commitChangeset(c.settings, w, { message: String(a.message ?? ''), newBranch: a.branch, pr });
        patchWorkspace(w.id, { changes: {}, baseSha: r.baseSha, branch: r.branch, lastCommit: { sha: r.sha, url: r.url, branch: r.branch, prUrl: r.prUrl, at: Date.now() } });
        return `Committed ${r.sha.slice(0, 7)} to ${r.branch}${r.rebased ? ' (rebased onto newer commits)' : ''}: ${r.url}${r.prUrl ? `\nPull request: ${r.prUrl}` : ''}`;
      },
    };
  }
  return Object.fromEntries(Object.entries(tools).map(([n, t]) => [n, { ...t, service: 'workspace' as const }]));
}

export function workspacePrompt(ctx: ToolContext): string | null {
  const ws = getWorkspace(ctx.workspaceId);
  if (!ws) return null;
  const n = Object.keys(ws.changes).length;
  return `This chat is attached to the workspace “${ws.name}” (${describeWorkspace(ws)}). Work in it with the ws.* tools like a coding agent: explore with ws.list/ws.search, read before editing, write whole files with ws.write.${
    ws.kind === 'github'
      ? ` Writes are staged on the device (${n} staged now); review with ws.diff, then call ws.commit once with a clear message (use "branch" + "pr" for a pull request).`
      : ' Writes are saved directly to the folder.'
  }`;
}
