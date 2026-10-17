/**
 * Attachment tools: download one attachment by ID from a message.
 * @module dsh-plugin-gmail/tools/attachments
 */

import { writeFile } from 'node:fs/promises';

import { GmailError } from '../util.js';
import { rootsFor, writablePath } from '../paths.js';

export function tools(ctx, deps) {
  const { client, config } = deps;
  const uid = (args) => args.user_id ?? config.defaultUserId;
  const list = [
    {
      name: 'gmail_get_attachment',
      title: 'Get Gmail attachment',
      kind: 'read',
      description:
        "Retrieves a specific attachment by ID from a message. Requires valid message and attachment IDs. The attachment ID (a system-generated token like 'ANGjdJ8s...') comes from the attachmentList/attachments field of gmail_fetch_emails or gmail_fetch_message_by_message_id with format='full' — lightweight fetch modes may omit it. Do NOT pass the filename (e.g. 'report.pdf'). Attachments exceeding ~25 MB may be exposed as Google Drive links instead.",
      parameters: {
        message_id: { type: 'string', required: true, description: "Immutable ID of the message containing the attachment (from gmail_fetch_emails / gmail_list_threads)." },
        attachment_id: { type: 'string', required: true, description: "The internal Gmail attachment ID (NOT the filename). Obtain it from the 'attachments' field of a full-format message fetch." },
        file_name: { type: 'string', description: 'Desired filename for the downloaded attachment (used when saving to disk).' },
        save_path: { type: 'string', description: 'Optional file path to write the attachment to. Must resolve inside the working directory (or a configured allowedRoot). When omitted, the attachment bytes are returned base64-encoded in the result.' },
        user_id: { type: 'string', description: "User's email address ('me' for the authenticated user)." },
      },
      async execute(args, exec) {
        const userId = uid(args);
        const result = await client.gmail('GET', `/users/${userId}/messages/${args.message_id}/attachments/${args.attachment_id}`, { signal: exec.signal });
        const data = result.data ?? '';
        const bytes = Buffer.from(data, 'base64url');
        if (bytes.length > config.maxAttachmentBytes) {
          throw new GmailError(
            `attachment is ${bytes.length} bytes, over the ${config.maxAttachmentBytes}-byte limit; raise maxAttachmentBytes to allow it`,
            'GMAIL_ATTACHMENT_TOO_LARGE',
          );
        }
        const filename = args.file_name ?? 'attachment';
        if (args.save_path) {
          const roots = await rootsFor(ctx, config, exec);
          const target = await writablePath(args.save_path, roots);
          await writeFile(target, bytes);
          return { messageId: args.message_id, attachmentId: args.attachment_id, filename, size: bytes.length, savedTo: target };
        }
        return {
          messageId: args.message_id,
          attachmentId: args.attachment_id,
          filename,
          size: bytes.length,
          sizeBytes: bytes.length,
          contentType: result.mimeType,
          contentBase64: bytes.toString('base64'),
          data,
        };
      },
    },
  ];
  return list;
}
