import type { Plugin } from './types';

/**
 * Installs Claude Code–format plugins and marketplaces from GitHub.
 *
 * CONTRACT (used by the Plugins screens) — implementation in progress.
 *
 * Supported inputs (same link forms as skill import): https://github.com/owner/repo[.git],
 * github.com/owner/repo/tree/<ref>/<path>, owner/repo.
 *
 * Plugin layout (plugin root): optional .claude-plugin/plugin.json (name, displayName, version,
 * description, author{name}, homepage, userConfig, and component keys: skills, commands, agents,
 * mcpServers, hooks, lspServers, outputStyles…); default dirs skills/<name>/SKILL.md, commands/*.md,
 * agents/*.md (subfolders become part of the agent name), .mcp.json, hooks/hooks.json, .lsp.json, bin/.
 * A plugin with SKILL.md at its root and no skills/ loads as one skill.
 *
 * Marketplace: .claude-plugin/marketplace.json { name, owner{name}, description?, metadata{pluginRoot?},
 * plugins: [{ name, source, description?, version?, displayName?, category?, strict?, + any plugin.json
 * component fields }] } where source is "./relative/path", {source:'github', repo, ref?, sha?},
 * {source:'git-subdir', url, path, ref?}, {source:'url', url, ref?} (only GitHub URLs supported here),
 * or archive/npm/command (unsupported on mobile).
 */

export interface MarketplaceEntry {
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  category?: string;
  /** False when the source type can't be installed from the phone (npm, archive, command, non-GitHub git). */
  supported: boolean;
  /** Why it isn't supported. */
  reason?: string;
  /** Opaque data the installer needs (original entry + resolved source). */
  raw: unknown;
}

export interface MarketplaceInfo {
  name: string;
  description?: string;
  owner?: string;
  /** The link the user entered. */
  source: string;
  entries: MarketplaceEntry[];
}

export type InstallTarget = { kind: 'plugin'; plugin: Plugin } | { kind: 'marketplace'; marketplace: MarketplaceInfo };

/**
 * Looks at a GitHub link: a marketplace (has .claude-plugin/marketplace.json) → its entries;
 * otherwise a single plugin (plugin.json and/or standard component folders) → the parsed plugin,
 * ready to save (enabled: true, config defaults applied, unsupported parts listed).
 */
export async function inspectGithubSource(_link: string, _githubToken?: string): Promise<InstallTarget> {
  throw new Error('Plugin installer not implemented yet');
}

/** Fetches and parses one marketplace entry into a Plugin. */
export async function installFromMarketplace(
  _marketplace: MarketplaceInfo,
  _entry: MarketplaceEntry,
  _githubToken?: string,
): Promise<Plugin> {
  throw new Error('Plugin installer not implemented yet');
}
