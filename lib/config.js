/**
 * Configuration for the Gmail plugin.
 *
 * There is deliberately no schemastery `Config` export. DSH installs plugins by
 * absolute path or by link, and a path-installed plugin resolves no bare
 * dependencies at all — `@deepseek-ai/schemastery` fails the entry at load with
 * "failed to import". The row's `config:` object is therefore validated here,
 * with defaults applied in code.
 *
 * @module dsh-plugin-gmail/config
 */

/** OAuth scopes requested at consent time; the granted token is what matters. */
export const DEFAULT_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/contacts.readonly',
]);

/** Attachment ceiling, both for outbound files and inbound downloads. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Every setting, with the value used when the row omits it. */
export const DEFAULT_CONFIG = Object.freeze({
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  clientIdRef: 'GMAIL_CLIENT_ID',
  clientSecretRef: 'GMAIL_CLIENT_SECRET',
  refreshTokenRef: 'GMAIL_REFRESH_TOKEN',
  scopes: DEFAULT_SCOPES,
  defaultUserId: 'me',
  timeoutMs: 30000,
  triggerIntervalMinutes: 5,
  enableReceivedTrigger: false,
  enableSentTrigger: false,
  receivedQuery: 'in:inbox newer_than:1d',
  sentQuery: 'in:sent newer_than:1d',
  flowTimeoutMs: 300000,
  redirectPort: 8765,
  /** Extra filesystem roots attachments may read or write. Empty: the session cwd. */
  allowedRoots: Object.freeze([]),
  maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
});

function fail(key, expected, value) {
  const got = value === null ? 'null' : typeof value;
  throw new Error(`gmail: config "${key}" must be ${expected} (got ${got})`);
}

function stringField(raw, key, fallback) {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') fail(key, 'a string', value);
  return value;
}

function booleanField(raw, key, fallback) {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(key, 'a boolean', value);
  return value;
}

function numberField(raw, key, fallback, { min, max, integer = false } = {}) {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(key, 'a finite number', value);
  if (integer && !Number.isInteger(value)) fail(key, 'an integer', value);
  if (min !== undefined && value < min) throw new Error(`gmail: config "${key}" must be >= ${min} (got ${value})`);
  if (max !== undefined && value > max) throw new Error(`gmail: config "${key}" must be <= ${max} (got ${value})`);
  return value;
}

/**
 * Validate a row's config and apply defaults.
 * @param raw - the `config:` object from the loader row, if any.
 * @returns a frozen, fully populated config.
 * @throws when a value has the wrong type or an impossible range.
 */
export function resolveConfig(raw) {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('gmail: config must be an object');
  }

  const scopes = raw.scopes === undefined
    ? [...DEFAULT_SCOPES]
    : Array.isArray(raw.scopes) && raw.scopes.every((s) => typeof s === 'string')
      ? [...raw.scopes]
      : fail('scopes', 'an array of strings', raw.scopes);

  const roots = raw.allowedRoots === undefined
    ? []
    : Array.isArray(raw.allowedRoots) && raw.allowedRoots.every((s) => typeof s === 'string')
      ? [...raw.allowedRoots]
      : fail('allowedRoots', 'an array of strings', raw.allowedRoots);

  const config = {
    clientId: stringField(raw, 'clientId', DEFAULT_CONFIG.clientId),
    clientSecret: stringField(raw, 'clientSecret', DEFAULT_CONFIG.clientSecret),
    refreshToken: stringField(raw, 'refreshToken', DEFAULT_CONFIG.refreshToken),
    clientIdRef: stringField(raw, 'clientIdRef', DEFAULT_CONFIG.clientIdRef),
    clientSecretRef: stringField(raw, 'clientSecretRef', DEFAULT_CONFIG.clientSecretRef),
    refreshTokenRef: stringField(raw, 'refreshTokenRef', DEFAULT_CONFIG.refreshTokenRef),
    scopes,
    defaultUserId: stringField(raw, 'defaultUserId', DEFAULT_CONFIG.defaultUserId),
    timeoutMs: numberField(raw, 'timeoutMs', DEFAULT_CONFIG.timeoutMs, { min: 1 }),
    triggerIntervalMinutes: numberField(raw, 'triggerIntervalMinutes', DEFAULT_CONFIG.triggerIntervalMinutes, { min: 1 }),
    enableReceivedTrigger: booleanField(raw, 'enableReceivedTrigger', DEFAULT_CONFIG.enableReceivedTrigger),
    enableSentTrigger: booleanField(raw, 'enableSentTrigger', DEFAULT_CONFIG.enableSentTrigger),
    receivedQuery: stringField(raw, 'receivedQuery', DEFAULT_CONFIG.receivedQuery),
    sentQuery: stringField(raw, 'sentQuery', DEFAULT_CONFIG.sentQuery),
    flowTimeoutMs: numberField(raw, 'flowTimeoutMs', DEFAULT_CONFIG.flowTimeoutMs, { min: 1000 }),
    redirectPort: numberField(raw, 'redirectPort', DEFAULT_CONFIG.redirectPort, { min: 1, max: 65535, integer: true }),
    allowedRoots: roots,
    maxAttachmentBytes: numberField(raw, 'maxAttachmentBytes', DEFAULT_CONFIG.maxAttachmentBytes, { min: 1 }),
  };

  if (config.defaultUserId.trim() === '') throw new Error('gmail: config "defaultUserId" must not be blank');
  return Object.freeze(config);
}
