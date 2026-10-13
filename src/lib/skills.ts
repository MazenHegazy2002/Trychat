import { parseGithubLink } from './githubLink';
import { uid } from './id';
import { listGithubLink, parseFrontmatter } from './pluginInstaller';
import type { FrontmatterValue } from './pluginInstaller';
import type { Skill } from './types';

export { parseGithubLink };

const fmText = (v: FrontmatterValue | undefined) => (Array.isArray(v) ? v.join(', ') : (v ?? '')).trim();

/** Reads "name:" and "description:" from SKILL.md front matter (--- … ---), with the plugin installer's YAML subset. */
export function parseSkillMarkdown(md: string, fallbackName: string): Omit<Skill, 'id' | 'updatedAt' | 'enabled'> {
  const { data, body } = parseFrontmatter(md);
  const heading = body.match(/^#\s+(.+)$/m)?.[1];
  return {
    name: fmText(data.name) || heading || fallbackName,
    description: fmText(data.description) || body.replace(/^#.*$/m, '').trim().split('\n')[0].slice(0, 200),
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

const IGNORED_MD = /^(readme|license|licence|contributing|changelog|code_of_conduct|security|support|history|authors)(\.[\w-]+)?\.md$/i;

const rawUrl = (owner: string, repo: string, branch: string, path: string) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`;

function nameFromPath(path: string): string {
  const parts = path.split('/');
  const file = parts[parts.length - 1];
  const base = /^skill\.md$/i.test(file) && parts.length > 1 ? parts[parts.length - 2] : file.replace(/\.md$/i, '');
  return base.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** GitHub links in a README ("https://github.com/owner/repo[/tree/…]") that look like skills or plugins. */
function linkedSkillRepos(readme: string, self: string): string[] {
  const out = new Map<string, string>();
  for (const m of readme.matchAll(/https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)((?:\/(?:tree|blob)\/[^\s)"'<>\]]*)?)/gi)) {
    const full = `${m[1]}/${m[2].replace(/\.git$/i, '')}`;
    if (full.toLowerCase() === self.toLowerCase() || /^(user-attachments|orgs|sponsors|topics|apps|features|marketplace)$/i.test(m[1])) continue;
    const url = `https://github.com/${full}${m[3].replace(/[.,;:]+$/, '')}`;
    if (/skill|plugin|claude|marketplace/i.test(url) && !out.has(full.toLowerCase())) out.set(full.toLowerCase(), url);
  }
  return [...out.values()].slice(0, 20);
}

/** Links findSkills suggests when a repo has no skills (empty for other errors). */
export const skillSuggestions = (e: unknown): string[] => {
  const s = e instanceof Error ? (e as Error & { suggestions?: unknown }).suggestions : undefined;
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : [];
};

/**
 * Finds skills in a GitHub link: every SKILL.md in the repo (or the linked folder). If there are none,
 * other Markdown files are offered instead, and finally a README that has skill front matter. A README
 * without it (an "awesome list") isn't a skill: the error carries the skill/plugin repos it links to
 * (see skillSuggestions).
 */
export async function findSkills(link: string, githubToken?: string): Promise<SkillCandidate[]> {
  if (!parseGithubLink(link)) throw new Error('Paste a GitHub link, e.g. https://github.com/owner/repo or a link to a SKILL.md.');
  const { owner, repo, ref: branch, path, file, files: all } = await listGithubLink(link, githubToken);
  const toCandidate = (p: string, isSkillFile: boolean): SkillCandidate => ({
    name: nameFromPath(p),
    path: p,
    rawUrl: rawUrl(owner, repo, branch, p),
    isSkillFile,
  });
  if (file) return [toCandidate(file, /skill\.md$/i.test(file))];

  const prefix = path ? `${path}/` : '';
  const files = all.filter((f) => f.startsWith(prefix)).sort();
  const skillFiles = files.filter((f) => /(^|\/)skill\.md$/i.test(f));
  if (skillFiles.length) return skillFiles.slice(0, 300).map((f) => toCandidate(f, true));

  const markdown = files.filter((f) => /\.md$/i.test(f) && !IGNORED_MD.test(f.split('/').pop()!) && !f.startsWith('.github/'));
  if (markdown.length) return markdown.slice(0, 300).map((f) => toCandidate(f, false));

  const readme = files.find((f) => f.slice(prefix.length).toLowerCase() === 'readme.md');
  if (!readme) throw new Error('No SKILL.md or Markdown files found there.');
  const candidate = toCandidate(readme, false);
  const res = await fetch(candidate.rawUrl, { headers: githubToken ? { Authorization: `Bearer ${githubToken}` } : {} });
  const text = res.ok ? await res.text() : '';
  const { data } = parseFrontmatter(text);
  if (fmText(data.name) || fmText(data.description)) return [candidate];
  const suggestions = linkedSkillRepos(text, `${owner}/${repo}`);
  throw Object.assign(
    new Error(
      `${owner}/${repo} has no skills: no SKILL.md files, and its README is a page of links, not a skill.${
        suggestions.length ? ` It links to ${suggestions.length === 1 ? 'a repo that looks' : `${suggestions.length} repos that look`} like skills or plugins:` : ''
      }`,
    ),
    { suggestions },
  );
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
