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

/** A skill file found in a repo, before it's imported. */
export interface SkillCandidate {
  name: string;
  /** Path inside the repo, e.g. "skills/pdf/SKILL.md". */
  path: string;
  rawUrl: string;
  /** True for real SKILL.md files; false for other Markdown we offered as a fallback. */
  isSkillFile: boolean;
}

interface RepoRef {
  owner: string;
  repo: string;
  branch?: string;
  path: string;
  /** Set when the link points at one file. */
  file?: string;
}

const IGNORED_MD = /^(readme|license|licence|contributing|changelog|code_of_conduct|security|support|history|authors)(\.[\w-]+)?\.md$/i;

/** Understands github.com links (repo, folder, file, with or without .git), raw links, and "owner/repo". */
export function parseGithubLink(input: string): RepoRef | null {
  const u = input.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  const raw = u.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (raw) return { owner: raw[1], repo: raw[2], branch: raw[3], path: '', file: raw[4] };
  const m = u.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(blob|tree)\/([^/]+)(?:\/(.*))?)?$/);
  if (m) {
    const [, owner, repo, kind, branch, path = ''] = m;
    if (kind === 'blob') return { owner, repo, branch, path: '', file: path };
    return { owner, repo, branch, path };
  }
  const short = u.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (short) return { owner: short[1], repo: short[2], path: '' };
  return null;
}

async function gh(path: string, token?: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const json = await res.json().catch(() => null);
  if (res.status === 404) throw new Error('Repository not found. Check the link (private repos need a GitHub token in Connections).');
  if (res.status === 403 && /rate limit/i.test(json?.message ?? '')) {
    throw new Error('GitHub’s limit for anonymous requests was reached. Add a GitHub token in Settings → Connections, or try again later.');
  }
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${json?.message ?? res.statusText}`);
  return json;
}

const rawUrl = (r: RepoRef, branch: string, path: string) =>
  `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`;

function nameFromPath(path: string): string {
  const parts = path.split('/');
  const file = parts[parts.length - 1];
  const base = /^skill\.md$/i.test(file) && parts.length > 1 ? parts[parts.length - 2] : file.replace(/\.md$/i, '');
  return base.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Finds skills in a GitHub link: every SKILL.md in the repo (or the linked folder). If there are none,
 * other Markdown files are offered instead, and finally the README.
 */
export async function findSkills(link: string, githubToken?: string): Promise<SkillCandidate[]> {
  const ref = parseGithubLink(link);
  if (!ref) throw new Error('Paste a GitHub link, e.g. https://github.com/owner/repo or a link to a SKILL.md.');
  const branch = ref.branch ?? (await gh(`/repos/${ref.owner}/${ref.repo}`, githubToken)).default_branch;

  if (ref.file) {
    return [{ name: nameFromPath(ref.file), path: ref.file, rawUrl: rawUrl(ref, branch, ref.file), isSkillFile: /skill\.md$/i.test(ref.file) }];
  }

  const tree = await gh(`/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, githubToken);
  const prefix = ref.path ? `${ref.path}/` : '';
  const files: string[] = (tree.tree ?? [])
    .filter((t: { type: string; path: string }) => t.type === 'blob' && t.path.startsWith(prefix))
    .map((t: { path: string }) => t.path);
  const toCandidate = (path: string, isSkillFile: boolean): SkillCandidate => ({
    name: nameFromPath(path),
    path,
    rawUrl: rawUrl(ref, branch, path),
    isSkillFile,
  });

  const skillFiles = files.filter((f) => /(^|\/)skill\.md$/i.test(f));
  if (skillFiles.length) return skillFiles.slice(0, 300).map((f) => toCandidate(f, true));

  const markdown = files.filter((f) => /\.md$/i.test(f) && !IGNORED_MD.test(f.split('/').pop()!) && !f.startsWith('.github/'));
  if (markdown.length) return markdown.slice(0, 300).map((f) => toCandidate(f, false));

  const readme = files.find((f) => f.slice(prefix.length).toLowerCase() === 'readme.md');
  if (readme) return [toCandidate(readme, false)];
  throw new Error('No SKILL.md or Markdown files found there.');
}

/** Downloads one candidate and turns it into a skill. */
export async function importSkill(candidate: SkillCandidate, source: string, githubToken?: string): Promise<Skill> {
  const res = await fetch(candidate.rawUrl, { headers: githubToken ? { Authorization: `Bearer ${githubToken}` } : {} });
  if (!res.ok) throw new Error(`Couldn’t download ${candidate.path} (${res.status}).`);
  const md = await res.text();
  return {
    id: uid(),
    ...parseSkillMarkdown(md, candidate.name),
    enabled: true,
    source: `${source.trim().replace(/\.git$/, '').replace(/\/+$/, '')} · ${candidate.path}`,
    updatedAt: Date.now(),
  };
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
