import { uid } from './id';
import type { Skill } from './types';

/** Reads "name:" and "description:" from SKILL.md front matter (--- … ---). */
export function parseSkillMarkdown(md: string, fallbackName: string): Omit<Skill, 'id' | 'updatedAt' | 'enabled'> {
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const meta: Record<string, string> = {};
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  const body = fm ? md.slice(fm[0].length) : md;
  const heading = body.match(/^#\s+(.+)$/m)?.[1];
  return {
    name: meta.name || heading || fallbackName,
    description: meta.description || body.replace(/^#.*$/m, '').trim().split('\n')[0].slice(0, 200),
    instructions: body.trim(),
  };
}

/** Turns a GitHub link (file, folder or repo) into candidate raw SKILL.md URLs. */
function rawCandidates(url: string): string[] {
  const u = url.trim().replace(/\/+$/, '');
  if (u.startsWith('https://raw.githubusercontent.com/')) return [u];
  const m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/(blob|tree)\/([^/]+)(?:\/(.*))?)?$/);
  if (!m) return [u]; // any other URL: fetch as-is
  const [, owner, repo, kind, branch, path = ''] = m;
  const raw = (b: string, p: string) => `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${p}`;
  if (kind === 'blob') return [raw(branch, path)];
  const file = (p: string) => (p ? `${p}/SKILL.md` : 'SKILL.md');
  if (kind === 'tree') return [raw(branch, file(path))];
  return [raw('main', 'SKILL.md'), raw('master', 'SKILL.md')];
}

export async function importSkillFromUrl(url: string, githubToken?: string): Promise<Skill> {
  let lastError = '';
  for (const candidate of rawCandidates(url)) {
    const res = await fetch(candidate, {
      headers: githubToken && candidate.includes('githubusercontent') ? { Authorization: `Bearer ${githubToken}` } : {},
    });
    if (!res.ok) {
      lastError = `${res.status} for ${candidate}`;
      continue;
    }
    const md = await res.text();
    const fallback = candidate.split('/').slice(-2, -1)[0] ?? 'Imported skill';
    return { id: uid(), ...parseSkillMarkdown(md, fallback), enabled: true, source: url.trim(), updatedAt: Date.now() };
  }
  throw new Error(`Couldn't find a SKILL.md (${lastError}). Paste a link to the file or its folder.`);
}

export const STARTER_SKILLS: Omit<Skill, 'id' | 'updatedAt'>[] = [
  {
    name: 'App builder',
    description: 'Plan and build polished single-file web apps and games that run in TryChat preview.',
    enabled: true,
    instructions: `When the user asks for an app, game, tool or site:
1. In one or two sentences, state what you'll build and the key features.
2. Return ONE complete HTML file in a single \`\`\`html block: inline CSS/JS, mobile-first layout, large touch targets, no external build steps (CDN libraries are fine).
3. Persist user data with localStorage when it makes sense.
4. Handle empty states and errors; no placeholder "TODO" code.
5. End with 2-3 short ideas for what to add next.`,
  },
  {
    name: 'Code reviewer',
    description: 'Review code or a diff for bugs, security issues and clarity, most important first.',
    enabled: true,
    instructions: `Review the code the user gives you (or read it with the GitHub/laptop tools).
- List findings most severe first: bugs, security issues, data loss, then performance, then readability.
- For each: file/line, what goes wrong in a concrete scenario, and a minimal fix (code).
- Don't nitpick style unless asked. Say clearly when the code looks good.`,
  },
  {
    name: 'Data analyst',
    description: 'Analyse numbers, CSV or JSON with Python (code.run) and explain the results plainly.',
    enabled: true,
    instructions: `For data questions, use code.run with Python (pandas/numpy are available) to compute answers instead of estimating.
Show the key numbers in a small Markdown table, explain what they mean in plain words, and mention any caveats (missing data, small samples).`,
  },
];
