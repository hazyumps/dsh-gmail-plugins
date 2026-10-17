# dsh-plugin-gmail

Gmail for **DeepSeek Harness 0.2** — 63 model-facing `gmail_*` tools and two
polling triggers over the Gmail and People REST APIs, with OAuth2 token
management.

A fork of [sakthiveltofficial/dsh-gmail-plugins](https://github.com/sakthiveltofficial/dsh-gmail-plugins)
(MIT), ported to the DSH 0.2 plugin contract and hardened for filesystem access.
The upstream plugin targets `0.1.0-rc.6` and DSH 0.2 refuses to install it;
see [What changed from upstream](#what-changed-from-upstream).

## Requirements

| | |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` or newer in the 0.2 line (`engines.dsh`) |
| Node.js | 20+ for global `fetch`; tested on 22 |
| Google Cloud | an OAuth client with the **Gmail API** and **People API** enabled |

## Install

Install by path or from GitHub; the package declares its own bundle patch, so
the row is added for you:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-gmail-plugins
# or
dsh plugin --profile web add github:hazyumps/dsh-gmail-plugins
```

Or in the Web sidebar: **Plugins → Add plugin**, give the folder, then
**Install** and **Enable now**.

The inserted row is `id: gmail`, `name: dsh-plugin-gmail`. Its `config:` lives
in the bundle patch (`cordis.yml`); edit that file, or override the row from
your profile patch, then restart the Host.

Verify:

```sh
dsh --profile web --dump-config | grep -A8 'id: gmail'
```

## Configure

### Credentials

| Setting | Environment variable | Purpose |
|---|---|---|
| `clientIdRef` | `GMAIL_CLIENT_ID` | OAuth client ID — required |
| `clientSecretRef` | `GMAIL_CLIENT_SECRET` | OAuth client secret — required |
| `refreshTokenRef` | `GMAIL_REFRESH_TOKEN` | long-lived refresh token — optional |

Each `*Ref` is a **reference**, resolved per operation through DSH's credential
service (provider store → process environment → `.env`). Literal
`clientId` / `clientSecret` / `refreshToken` values are also accepted and take
precedence, but a reference is the intended form: the value then stays out of
the config file.

When no refresh token is configured, run the `gmail_authorize` tool. It opens
Google's consent page, serves the callback on
`http://127.0.0.1:8765/oauth2callback`, exchanges the code, and stores the
refresh token in the credential store under `gmail/oauth` (plus the
`GMAIL_REFRESH_TOKEN` reference). Register exactly that redirect URI in the
OAuth client, or change `redirectPort` and keep the two in lockstep.

### Google Cloud, in five steps

1. Create or pick a project at <https://console.cloud.google.com>.
2. **APIs & Services → Library**: enable **Gmail API** and **People API**.
3. **OAuth consent screen**: External, add your account as a test user.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
5. Add `http://127.0.0.1:8765/oauth2callback` under **Authorized redirect URIs**.

Scopes requested: `gmail.modify`, `gmail.settings.basic`, `gmail.compose`,
`gmail.send`, `contacts.readonly`. Narrow `scopes` before first consent if you
do not need settings administration.

### Settings

| Setting | Default | Notes |
|---|---|---|
| `defaultUserId` | `me` | `user_id` used when a tool omits it |
| `timeoutMs` | `30000` | per-request HTTP timeout |
| `allowedRoots` | `[]` | directories attachments may read or write; empty means the session working directory |
| `maxAttachmentBytes` | `26214400` | outbound and inbound attachment ceiling |
| `redirectPort` | `8765` | OAuth loopback port |
| `flowTimeoutMs` | `300000` | how long a sign-in waits for the callback |
| `enableReceivedTrigger` | `false` | poll the inbox |
| `enableSentTrigger` | `false` | poll sent mail |
| `triggerIntervalMinutes` | `5` | poll interval |
| `receivedQuery` | `in:inbox newer_than:1d` | search backing the received trigger |
| `sentQuery` | `in:sent newer_than:1d` | search backing the sent trigger |

Settings are validated in code (`lib/config.js`), not by a schemastery
`Config` export — see the note on path installs below.

## Tools

63 tools, all prefixed `gmail_`:

| Area | Tools |
|---|---|
| Send and reply | `gmail_send_email`, `gmail_reply_to_thread`, `gmail_forward_message`, `gmail_insert_message`, `gmail_import_message` |
| Read and search | `gmail_fetch_emails`, `gmail_fetch_message_by_message_id`, `gmail_fetch_message_by_thread_id`, `gmail_list_messages`, `gmail_list_threads` |
| Organize | `gmail_add_label_to_email`, `gmail_batch_modify_messages`, `gmail_batch_delete_messages`, `gmail_delete_message`, `gmail_move_to_trash`, `gmail_untrash_message`, `gmail_modify_thread_labels`, `gmail_move_thread_to_trash`, `gmail_untrash_thread`, `gmail_delete_thread` |
| Labels | `gmail_list_labels`, `gmail_get_label`, `gmail_create_label`, `gmail_patch_label`, `gmail_update_label`, `gmail_delete_label`, `gmail_remove_label` |
| Drafts | `gmail_create_email_draft`, `gmail_get_draft`, `gmail_list_drafts`, `gmail_update_draft`, `gmail_delete_draft`, `gmail_send_draft` |
| Filters | `gmail_list_filters`, `gmail_get_filter`, `gmail_create_filter`, `gmail_delete_filter` |
| Account settings | `gmail_get_profile`, `gmail_list_history`, IMAP/POP, auto-forwarding, vacation responder, display language, send-as aliases, S/MIME, CSE identities and key pairs, `gmail_stop_watch` |
| Attachments | `gmail_get_attachment` |
| People | `gmail_get_contacts`, `gmail_get_people`, `gmail_search_people` |
| Auth | `gmail_authorize`, `gmail_auth_status` |

Permanent deletes are real deletes: `gmail_delete_message`,
`gmail_batch_delete_messages`, `gmail_delete_thread`, and `gmail_delete_label`
bypass the trash. The system prompt tells the model to prefer
`gmail_move_to_trash` unless the user asked for irreversible removal.

### Triggers

With `enableReceivedTrigger` or `enableSentTrigger` on, the plugin polls on
`triggerIntervalMinutes` and emits a Cordis event for each message it has not
seen before:

- `gmail/message-received` — `message_id`, `thread_id`, `label_ids`, `subject`,
  `sender`, `to`, `cc`, `bcc`, `recipients`, `message_text`,
  `message_timestamp`, `attachment_list`, `payload`, `preview`
- `gmail/message-sent` — the same shape for mail the account sent

The first poll only seeds the seen-set, so enabling a trigger does not replay
the mailbox. Polling stops when the plugin is stopped.

## What changed from upstream

**DSH 0.2 compatibility.** Upstream pins `@deepseek-ai/dsh-tools@0.1.0-rc.6` and
`@deepseek-ai/dsh-credentials@0.1.0-rc.6` as peers. DSH 0.2 evaluates those
ranges against its own version and refuses the install outright
(`Plugin ... is incompatible with dsh 0.2.1-rc.2`). This fork declares
`engines.dsh` instead and ships no `@deepseek-ai/*` peer dependency.

**No bare dependency imports.** DSH installs plugins by path or link, and a
path-installed plugin resolves no bare dependency at all. Upstream imports
`@deepseek-ai/schemastery`, `@deepseek-ai/dsh-tools`, and
`@deepseek-ai/dsh-credentials`; each one fails the entry at load with
`failed to import`. This fork imports only `node:` builtins and its own files:

- `lib/tools.js` carries a local `defineTool`: it compiles the same parameter
  shorthand to JSON Schema and validates model arguments before the tool body,
  matching what `@deepseek-ai/dsh-tools` did.
- `lib/config.js` validates the row's `config:` object and applies defaults.
- `credentialRef()` was only a compile-time brand, so the credential calls now
  pass the reference string directly.

**A real bundle.** `package.json` declares `dsh.bundle.patch`, so
`dsh plugin add` inserts the row and the Plugins page can toggle it. Upstream
required a hand-edited profile patch row.

**Filesystem confinement.** Upstream let an outbound attachment name any local
file and let `gmail_get_attachment` write to any path — a prompt-injected email
could exfiltrate `~/.ssh/id_ed25519` by attaching it and sending it out. Now:

- attachment reads and `save_path` writes must resolve inside `allowedRoots`,
  which defaults to the session working directory;
- symlinks are resolved before the check, so a link inside the workspace cannot
  point outside it;
- URL downloads and attachment reads are capped at `maxAttachmentBytes`.

Keep `allowedRoots: []` unless you mean it.

**No `export default`.** Cordis treats a default-exported function as a service
class: it calls `apply` with `new` and drops `inject`.

## Testing

The tests import only the plugin's own modules, so they run under plain Node
with no Harness extraction step:

```sh
npm test
```

`tests/contract.test.js` activates the plugin against a fake `ctx` and asserts
the 0.2 definition contract for all 63 tools. The remaining suites cover config
validation, the parameter compiler and argument validator, path confinement
(including symlink escapes), and MIME construction.

Activation was also verified against the real runtime: a throwaway
`DSH_HOME`, the `headless` template, and
`dsh plugin --profile hl add <repo>` boots to `gmail: registered 63 tools`.

## Security

See [SECURITY.md](SECURITY.md) for the audit: what the plugin touches, what it
sends where, and what it does not protect against.

## License

MIT. Original work Copyright (c) 2026 GoogleWorkspace plugin authors; see
[LICENSE](LICENSE).
