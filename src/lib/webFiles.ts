import * as FileSystem from 'expo-file-system';

/**
 * Hooks into the web / desktop file-system stand-in (src/shims/expo-file-system.web.ts). On iOS and
 * Android these are no-ops.
 */
const shim = FileSystem as unknown as { webReady?: Promise<void>; webObjectUrl?: (uri: string) => string };

/** Resolves once stored files are loaded (immediately on phones). */
export const filesReady: Promise<void> = shim.webReady ?? Promise.resolve();

/** A URI an <Image> can show for a stored file. */
export const displayUri = (uri: string): string => shim.webObjectUrl?.(uri) ?? uri;
