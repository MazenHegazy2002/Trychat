/**
 * The bridge the Mac and Windows desktop app (desktop/preload.js) exposes to the web build. Undefined
 * on phones and in a plain browser.
 */
export interface DesktopBridge {
  platform: string;
  /** Renders HTML to a PDF with Chromium's printer. Sizes in inches. */
  htmlToPdf(html: string, options: { width: number; height: number; margin: number }): Promise<Uint8Array>;
  /** Writes a temporary copy and opens it with the default app (Preview, Numbers…). */
  openFile(name: string, bytes: Uint8Array): Promise<void>;
  /** Shows the file in a "Save as" dialog. Resolves to the saved path, or null if cancelled. */
  saveFile(name: string, bytes: Uint8Array): Promise<string | null>;
  /**
   * Folders on this computer the user opened in TryChat (Windows and Mac app). Paths are relative to
   * the folder's absolute `root`; the app refuses any folder the user didn't pick. Missing in older
   * desktop builds.
   */
  fs?: DesktopFs;
}

export interface DesktopFs {
  /** Shows the "Open a folder" dialog; null if cancelled. */
  pickFolder(): Promise<{ path: string; name: string } | null>;
  forget(root: string): Promise<void>;
  list(root: string, rel: string): Promise<{ name: string; isDir: boolean; size?: number }[]>;
  read(root: string, rel: string): Promise<{ content?: string; binary?: boolean; tooBig?: boolean; size: number }>;
  write(root: string, rel: string, content: string): Promise<{ bytes: number }>;
  remove(root: string, rel: string): Promise<void>;
  rename(root: string, from: string, to: string): Promise<void>;
  mkdir(root: string, rel: string): Promise<void>;
  /** Name matches ("dir/") and content matches ("path:line: text"). */
  search(root: string, query: string): Promise<string[]>;
  /** Shows the item in Explorer or Finder. */
  reveal(root: string, rel: string): Promise<void>;
}

/** The desktop app's folder access, when this build has it. */
export const desktopFs: DesktopFs | undefined = (typeof window !== 'undefined'
  ? (window as unknown as { trychatDesktop?: DesktopBridge }).trychatDesktop?.fs
  : undefined);

export const desktop: DesktopBridge | undefined =
  typeof window !== 'undefined' ? (window as unknown as { trychatDesktop?: DesktopBridge }).trychatDesktop : undefined;

/** Web only: starts a browser download of `bytes`. */
export function downloadBytes(name: string, bytes: Uint8Array, mimeType = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
