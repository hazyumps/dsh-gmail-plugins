import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { apply } from '../lib/index.js';
import { resolveConfig } from '../lib/config.js';
import { defineTool } from '../lib/tools.js';
import { tools as attachmentTools } from '../lib/tools/attachments.js';
import { GmailError } from '../lib/util.js';

const EXPECTED_TOOL_COUNT = 63;

function fakeContext() {
  const registered = new Map();
  return {
    registered,
    tools: {
      register(definition) {
        assert.equal(registered.has(definition.name), false, `duplicate tool ${definition.name}`);
        registered.set(definition.name, definition);
        return () => registered.delete(definition.name);
      },
    },
    get: () => undefined,
    effect(factory) {
      return factory();
    },
    emit() {},
  };
}

test('the plugin activates and registers 63 unique tools', () => {
  const ctx = fakeContext();
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    apply(ctx, {});
  } finally {
    console.log = original;
  }
  assert.equal(ctx.registered.size, EXPECTED_TOOL_COUNT);
  assert.ok(logs.some((line) => line.includes('registered 63 tools')));
});

test('every registered tool matches the DSH 0.2 definition contract', () => {
  const ctx = fakeContext();
  apply(ctx, {});
  for (const [name, definition] of ctx.registered) {
    assert.match(name, /^gmail_[a-z0-9_]+$/);
    assert.equal(typeof definition.description, 'string');
    assert.ok(definition.description.length > 20, `${name} description is too thin`);
    assert.equal(definition.parameters.type, 'object');
    assert.equal(typeof definition.execute, 'function');
    assert.equal(typeof definition.presentCall, 'function');
    assert.equal(typeof definition.output.render, 'function');
    const outputSchema = definition.output.schema;
    assert.ok(['object', 'string'].includes(outputSchema.type), `${name} output schema`);
    if (outputSchema.type === 'object') assert.equal(outputSchema.additionalProperties, true);
  }
});

test('every gmail_* tool name is unique across modules', () => {
  const ctx = fakeContext();
  apply(ctx, {});
  const names = [...ctx.registered.keys()];
  assert.equal(new Set(names).size, names.length);
  for (const required of ['gmail_send_email', 'gmail_fetch_emails', 'gmail_authorize', 'gmail_auth_status', 'gmail_get_attachment']) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
});

async function attachmentTool(overrides = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gmail-attach-')));
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'gmail-attach-out-')));
  const config = resolveConfig({ allowedRoots: [root], ...overrides });
  const client = {
    async gmail() {
      return { data: Buffer.from('attachment-body').toString('base64url'), mimeType: 'text/plain' };
    },
  };
  const spec = attachmentTools({}, { client, config }).find((entry) => entry.name === 'gmail_get_attachment');
  return { tool: defineTool(spec), root, outside, config };
}

test('gmail_get_attachment writes inside the configured root', async () => {
  const { tool, root } = await attachmentTool();
  const target = path.join(root, 'saved.bin');
  const result = await tool.execute({ message_id: 'm', attachment_id: 'a', save_path: target }, { signal: undefined });
  assert.equal(result.savedTo, target);
  assert.equal(await readFile(target, 'utf8'), 'attachment-body');
});

test('gmail_get_attachment refuses a save_path outside the root and writes nothing', async () => {
  const { tool, outside } = await attachmentTool();
  const target = path.join(outside, 'stolen.bin');
  await assert.rejects(
    () => tool.execute({ message_id: 'm', attachment_id: 'a', save_path: target }, { signal: undefined }),
    (error) => error instanceof GmailError && error.code === 'GMAIL_PATH_OUTSIDE_ROOTS',
  );
  await assert.rejects(() => readFile(target));
});

test('gmail_get_attachment returns bytes inline when no save_path is given', async () => {
  const { tool } = await attachmentTool();
  const result = await tool.execute({ message_id: 'm', attachment_id: 'a' }, { signal: undefined });
  assert.equal(result.size, Buffer.from('attachment-body').length);
  assert.equal(Buffer.from(result.contentBase64, 'base64').toString(), 'attachment-body');
});

test('gmail_get_attachment enforces the configured size ceiling', async () => {
  const { tool } = await attachmentTool({ maxAttachmentBytes: 4 });
  await assert.rejects(
    () => tool.execute({ message_id: 'm', attachment_id: 'a' }, { signal: undefined }),
    (error) => error instanceof GmailError && error.code === 'GMAIL_ATTACHMENT_TOO_LARGE',
  );
});
