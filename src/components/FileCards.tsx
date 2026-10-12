import type { Attachment } from '../lib/types';
import { MessageAttachments } from './Attachments';

/**
 * Files the assistant sent in the chat (images, PDFs, any type), with open / share / save actions.
 * `conversationId` is the chat they were sent in.
 */
export function FileCards({ files }: { files: Attachment[]; conversationId?: string }) {
  return <MessageAttachments items={files} />;
}
