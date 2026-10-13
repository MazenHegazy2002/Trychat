/**
 * The bridge the Mac desktop app (desktop/preload.js) exposes to the web build. Undefined on phones
 * and in a plain browser.
 */
export interface DesktopBridge {
  platform: string;
  /** Renders HTML to a PDF with Chromium's printer. Sizes in inches. */
  htmlToPdf(html: string, options: { width: number; height: number; margin: number }): Promise<Uint8Array>;
  /** Writes a temporary copy and opens it with the default app (Preview, Numbers…). */
  openFile(name: string, bytes: Uint8Array): Promise<void>;
  /** Shows the file in a "Save as" dialog. Resolves to the saved path, or null if cancelled. */
  saveFile(name: string, bytes: Uint8Array): Promise<string | null>;
}

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
