import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * JSON documents stored as files in the app's documents folder (as AsyncStorage keys on web, where
 * there is no file system). Paths are relative, e.g. "plugins.json" or "conversations/<id>.json".
 *
 * Writes are atomic even though the file system's move deletes the destination before renaming:
 * the new text goes to "<doc>.tmp", the current file becomes "<doc>.bak", then the temp file is moved
 * into place. Reads try the file, then the temp file (a finished write that wasn't moved yet), then
 * the backup (e.g. a file left empty by a power cut), so a crash at any point leaves the old or the
 * new version, never a broken one. A temp file that doesn't parse is a write that never finished; it
 * doesn't make a document unreadable.
 */

export type ReadResult<T> =
  | { status: 'ok'; value: T; text: string }
  /** Nothing stored. */
  | { status: 'missing' }
  /** Something is stored but couldn't be read or parsed: it must not be overwritten. */
  | { status: 'unreadable'; error: unknown };

export interface DocStore {
  /** `check` throws if a parsed value isn't valid; that counts as unreadable. */
  read<T>(path: string, check?: (value: any) => void): Promise<ReadResult<T>>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** File names of the documents in a folder ([] if it doesn't exist). Throws if it can't be listed. */
  list(dir: string): Promise<string[]>;
  /** Moves a document (or folder) to "recovery/" so it's kept but no longer used. */
  setAside(path: string): Promise<void>;
}

const SUFFIXES = ['', '.tmp', '.bak'] as const;
const RECOVERY = 'recovery';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function fileStore(): DocStore {
  const root = () => new Directory(Paths.document, 'trychat');
  const fileAt = (path: string) => new File(root(), ...path.split('/'));
  const dirAt = (path: string) => (path ? new Directory(root(), ...path.split('/')) : root());
  const ensureDir = (path: string) => {
    const dir = dirAt(path);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  };
  const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');

  async function write(path: string, text: string) {
    ensureDir(parentOf(path));
    fileAt(path + '.tmp').write(text);
    const current = fileAt(path);
    if (current.exists) await current.move(fileAt(path + '.bak'), { overwrite: true });
    await fileAt(path + '.tmp').move(fileAt(path), { overwrite: true });
  }

  async function setAside(path: string) {
    ensureDir(RECOVERY);
    const name = `${stamp()}-${path.replace(/\//g, '_')}`;
    const dir = dirAt(path);
    if (dir.exists) {
      await dir.move(new Directory(root(), RECOVERY, name));
      return;
    }
    for (const suffix of SUFFIXES) {
      const file = fileAt(path + suffix);
      if (file.exists) await file.move(fileAt(`${RECOVERY}/${name}${suffix}`), { overwrite: true });
    }
  }

  return {
    async read<T>(path: string, check?: (value: any) => void): Promise<ReadResult<T>> {
      let failed = false;
      let error: unknown;
      for (const suffix of SUFFIXES) {
        const file = fileAt(path + suffix);
        if (!file.exists) continue;
        try {
          const text = await file.text();
          const value = JSON.parse(text);
          check?.(value);
          if (suffix) {
            // Put the recovered version back in place; a broken main file is kept in recovery/.
            console.warn(`[storage] ${path}: recovered from ${suffix}`);
            try {
              if (fileAt(path).exists) {
                ensureDir(RECOVERY);
                await fileAt(path).move(fileAt(`${RECOVERY}/${stamp()}-${path.replace(/\//g, '_')}`), { overwrite: true });
              }
              await write(path, text);
            } catch {
              // Still readable the same way next time.
            }
          }
          return { status: 'ok', value, text };
        } catch (e) {
          if (suffix === '.tmp') continue;
          if (!failed) error = e;
          failed = true;
        }
      }
      return failed ? { status: 'unreadable', error } : { status: 'missing' };
    },

    write,

    async remove(path: string) {
      // The main file goes last: if this is interrupted, the document is still there (not an old backup).
      for (const suffix of ['.tmp', '.bak', ''] as const) {
        const file = fileAt(path + suffix);
        if (file.exists) file.delete();
      }
    },

    async list(dir: string) {
      const folder = dirAt(dir);
      if (!folder.exists) return [];
      const names = new Set<string>();
      for (const entry of folder.list()) {
        const name = entry.name.replace(/\.(tmp|bak)$/, '');
        if (name.endsWith('.json')) names.add(name);
      }
      return [...names];
    },

    setAside,
  };
}

/** Web: one AsyncStorage (localStorage) key per document; setItem replaces a value atomically. */
function keyStore(): DocStore {
  const PREFIX = 'trychat.docs/';
  return {
    async read<T>(path: string, check?: (value: any) => void): Promise<ReadResult<T>> {
      try {
        const text = await AsyncStorage.getItem(PREFIX + path);
        if (text === null) return { status: 'missing' };
        const value = JSON.parse(text);
        check?.(value);
        return { status: 'ok', value, text };
      } catch (error) {
        return { status: 'unreadable', error };
      }
    },
    write: (path, text) => AsyncStorage.setItem(PREFIX + path, text),
    remove: (path) => AsyncStorage.removeItem(PREFIX + path),
    async list(dir: string) {
      const prefix = `${PREFIX}${dir}/`;
      return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },
    async setAside(path: string) {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k === PREFIX + path || k.startsWith(`${PREFIX}${path}/`));
      const target = `trychat.${RECOVERY}/${stamp()}-`;
      for (const key of keys) {
        const text = await AsyncStorage.getItem(key); // throws if it can't be read: then it stays where it is
        if (text !== null) await AsyncStorage.setItem(target + key.slice(PREFIX.length), text);
        await AsyncStorage.removeItem(key);
      }
    },
  };
}

export const docStore: DocStore = Platform.OS === 'web' ? keyStore() : fileStore();
