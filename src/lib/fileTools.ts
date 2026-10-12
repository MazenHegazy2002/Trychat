import type { ToolContext, ToolDef } from './tools';

/** Tools that create files (images, PDFs, any type) and send them to the user in the chat, and read the Files library. */
export function fileTools(_ctx: ToolContext): Record<string, ToolDef> {
  return {};
}
