/**
 * dsh-plugin-gmail — Gmail tools for DeepSeek Harness 0.2.
 *
 * A self-contained Cordis plugin: 63 model-facing tools over the Gmail and
 * People REST APIs — including the interactive `gmail_authorize` sign-in —
 * plus two polling triggers (`gmail/message-received`, `gmail/message-sent`)
 * that emit Cordis events while the plugin is mounted.
 *
 * Authentication is OAuth2: client credentials are read from literal config or
 * the harness `credentials` service, and the refresh token is either provided
 * that way or captured by the `gmail_authorize` sign-in flow and stored in the
 * credential store (see {@link auth} and {@link authorize}).
 *
 * The plugin publishes no services — it only consumes the host `tools`
 * registry, plus the optional `systemPrompt`, `credentials`, `timer`, and
 * `workingDirectory` services — so it mounts as a plain bundle row with no
 * isolate realm.
 *
 * @module dsh-plugin-gmail
 */

import { resolveConfig } from './config.js';
import { OAuthTokenManager } from './auth.js';
import { GmailClient } from './client.js';
import { registerAll } from './tools/index.js';
import { startTriggers } from './triggers.js';

/** Cordis plugin name; also the credential scope for the stored grant. */
export const name = 'gmail';

/** Hard dependency: the host tool registry. Everything else is looked up lazily. */
export const inject = ['tools'];

const PROMPT_SECTION = `You have access to the Gmail tools (gmail_*). Key conventions:

- Message IDs are hexadecimal Gmail API IDs (e.g. '19b11732c1b578fd') — never UUIDs, thread IDs, subjects, or dates. Obtain them from gmail_fetch_emails / gmail_list_threads.
- Label parameters take label IDs, never display names: system labels use their uppercase name (INBOX, UNREAD, STARRED, SPAM, TRASH, CATEGORY_UPDATES, ...); custom labels use their internal ID (Label_123, from gmail_list_labels).
- gmail_send_email sends immediately and irreversibly — confirm recipients, subject, and body before sending. Reply inside a thread with gmail_reply_to_thread (never pass a custom subject there; it starts a new thread).
- Draft IDs (r-prefixed, e.g. 'r99885592323229922') differ from message IDs; gmail_send_draft sends a draft exactly as-is and cannot add recipients.
- Attachments accept a local file path inside the working directory, a public URL, or { name, mimetype, base64 }; total message size must stay under ~25 MB after base64 encoding.
- Never attach credentials, key material, or files outside the working directory. Paths outside the allowed roots are rejected.
- Prefer gmail_move_to_trash over permanent deletes unless the user explicitly asked for irreversible removal.
- If the account is not yet authenticated (gmail_auth_status shows authorized:false), offer to run gmail_authorize: it opens the Google sign-in page in the user's browser and captures the refresh token automatically — the user only needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET set.
- Google enforces per-minute/daily quotas: apply exponential backoff (1s, 2s, 4s) when you see 429/403 errors.`;

/** Apply the Gmail plugin: register tools and start triggers. */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const tokens = new OAuthTokenManager(ctx, config);
  const client = new GmailClient(tokens, config);
  // In-flight interactive sign-in flows, keyed by flow id; servers are owned by
  // this plugin fiber and disposed on stop/unload.
  const flows = new Map();
  const deps = { ctx, client, config, tokens, flows };

  const count = registerAll(ctx, deps);
  console.log(`gmail: registered ${count} tools`);

  ctx.effect(() => () => {
    for (const flow of flows.values()) {
      if (typeof flow.dispose === 'function') flow.dispose();
    }
    flows.clear();
  });

  const systemPrompt = ctx.get('systemPrompt');
  if (systemPrompt !== undefined) {
    systemPrompt.section({ name: 'tool:gmail', order: 115, text: PROMPT_SECTION });
  }

  if (config.enableReceivedTrigger || config.enableSentTrigger) {
    ctx.effect(() => startTriggers(ctx, config, client, () => config.defaultUserId));
    console.log(
      'gmail: triggers enabled (received=' + config.enableReceivedTrigger +
      ', sent=' + config.enableSentTrigger +
      ', interval=' + config.triggerIntervalMinutes + 'm)',
    );
  }
}
