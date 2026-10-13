/**
 * Speech-to-text through the server's OpenAI-compatible `POST /audio/transcriptions`.
 * No React Native imports here, so the request construction can be tested in Node.
 */

export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface TranscriptionTarget {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

/** Builds a multipart/form-data body by hand so it works with any fetch (file:// uris aren't portable). */
export function buildTranscriptionRequest(
  target: TranscriptionTarget,
  audio: Uint8Array,
  fileName: string,
  mimeType: string,
  boundary = `----TryChat${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
) {
  const enc = new TextEncoder();
  const field = (name: string, value: string) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const head = enc.encode(
    field('model', target.model?.trim() || DEFAULT_TRANSCRIPTION_MODEL) +
      field('response_format', 'json') +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName.replace(/"/g, '')}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + audio.length + tail.length);
  body.set(head, 0);
  body.set(audio, head.length);
  body.set(tail, head.length + audio.length);
  const headers: Record<string, string> = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    Accept: 'application/json',
  };
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;
  return { url: target.baseUrl.replace(/\/+$/, '') + '/audio/transcriptions', headers, body };
}

/** Resolves with the transcript; rejects with a short, human-readable reason. */
export async function transcribeAudio(
  target: TranscriptionTarget,
  audio: Uint8Array,
  fileName: string,
  mimeType: string,
  fetchFn: FetchLike,
  signal?: AbortSignal,
): Promise<string> {
  const req = buildTranscriptionRequest(target, audio, fileName, mimeType);
  const res = await fetchFn(req.url, { method: 'POST', headers: req.headers, body: req.body, signal });
  const raw = await res.text().catch(() => '');
  let json: { text?: string; error?: { message?: string } | string; message?: string } | undefined;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    if (res.status === 404 || res.status === 405) throw new Error(`HTTP ${res.status} (server has no /audio/transcriptions)`);
    const msg = typeof json?.error === 'string' ? json.error : (json?.error?.message ?? json?.message ?? raw);
    throw new Error(`HTTP ${res.status}${msg ? `: ${msg.slice(0, 160)}` : ''}`);
  }
  const text = (json ? json.text : raw)?.trim();
  if (!text) throw new Error('empty transcript');
  return text;
}
