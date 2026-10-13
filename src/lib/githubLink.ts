/** A GitHub link taken apart (see parseGithubLink). */
export interface RepoRef {
  owner: string;
  repo: string;
  branch?: string;
  path: string;
  /** Set when the link points at one file. */
  file?: string;
  /**
   * For /tree/, /blob/ and raw links: everything after the repo ("<ref>/<path>"). A branch name can
   * contain "/", so `branch` is only the first guess; githubRefSplits lists the others.
   */
  refPath?: string;
}

/** Fragments GitHub pages add that aren't refs (#readme, ?tab=readme-ov-file#…, heading anchors). */
const PAGE_ANCHOR = /^(readme|readme-ov-file|.*-ov-file|user-content-.*|L\d+(-L\d+)?)$/i;

/**
 * Understands github.com links (repo, folder, file, with or without .git), raw links, and "owner/repo".
 * Like Claude Code's `/plugin marketplace add`, "owner/repo#ref", "owner/repo@ref" and
 * "https://github.com/owner/repo.git#ref" name a branch, tag or commit.
 */
export function parseGithubLink(input: string): RepoRef | null {
  const trimmed = input.trim();
  const hash = trimmed.indexOf('#');
  const beforeHash = hash >= 0 ? trimmed.slice(0, hash) : trimmed;
  const fragment = hash >= 0 ? trimmed.slice(hash + 1).trim() : '';
  // On a browser page link (has a query, e.g. ?tab=readme-ov-file#readme) the fragment is an anchor.
  const hashRef = fragment && !beforeHash.includes('?') && !PAGE_ANCHOR.test(fragment) ? fragment : undefined;
  const u = beforeHash.replace(/\?.*$/, '').replace(/\/+$/, '');
  const raw = u.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(([^/]+)\/(.+))$/);
  if (raw) return { owner: raw[1], repo: raw[2], branch: raw[4], path: '', file: raw[5], refPath: raw[3] };
  const m = u.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(blob|tree)\/(([^/]+)(?:\/(.*))?))?$/);
  if (m) {
    const [, owner, repo, kind, refPath, branch, path = ''] = m;
    if (kind === 'blob') return { owner, repo, branch, path: '', file: path, refPath };
    if (kind) return { owner, repo, branch, path, refPath };
    return { owner, repo, branch: hashRef, path: '' };
  }
  const short = u.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:@(\S+))?$/);
  if (short) return { owner: short[1], repo: short[2], branch: short[3] ?? hashRef, path: '' };
  return null;
}

/**
 * The ways to read a link's "<ref>/<path>", shortest ref first: "a/b/c" → ref "a" path "b/c", ref "a/b"
 * path "c", … Git can't have both "a" and "a/b" as branches, so the first ref that exists is the one.
 */
export function githubRefSplits(ref: RepoRef): RepoRef[] {
  if (!ref.refPath) return [ref];
  const parts = ref.refPath.split('/');
  const out: RepoRef[] = [];
  for (let i = 1; i <= parts.length - (ref.file !== undefined ? 1 : 0); i++) {
    const branch = parts.slice(0, i).join('/');
    const rest = parts.slice(i).join('/');
    out.push(ref.file !== undefined ? { ...ref, branch, path: '', file: rest } : { ...ref, branch, path: rest });
  }
  return out.length ? out : [ref];
}
