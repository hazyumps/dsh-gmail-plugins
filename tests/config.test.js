import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_SCOPES, resolveConfig } from '../lib/config.js';

test('defaults cover every setting', () => {
  const config = resolveConfig({});
  assert.equal(config.defaultUserId, 'me');
  assert.equal(config.timeoutMs, 30000);
  assert.equal(config.redirectPort, 8765);
  assert.equal(config.enableReceivedTrigger, false);
  assert.deepEqual(config.allowedRoots, []);
  assert.deepEqual(config.scopes, [...DEFAULT_SCOPES]);
  assert.ok(Object.isFrozen(config));
});

test('an absent or empty config is the default config', () => {
  assert.deepEqual(resolveConfig(undefined), resolveConfig({}));
  assert.deepEqual(resolveConfig(null), resolveConfig({}));
});

test('overrides win and unknown keys are ignored', () => {
  const config = resolveConfig({
    defaultUserId: 'me@example.com',
    timeoutMs: 1000,
    enableSentTrigger: true,
    allowedRoots: ['/tmp'],
    somethingElse: 42,
  });
  assert.equal(config.defaultUserId, 'me@example.com');
  assert.equal(config.timeoutMs, 1000);
  assert.equal(config.enableSentTrigger, true);
  assert.deepEqual(config.allowedRoots, ['/tmp']);
  assert.equal('somethingElse' in config, false);
});

test('the scopes default is copied, not shared', () => {
  const first = resolveConfig({});
  first.scopes.push('https://example.invalid/scope');
  assert.deepEqual(resolveConfig({}).scopes, [...DEFAULT_SCOPES]);
});

test('wrong types fail fast with the setting named', () => {
  assert.throws(() => resolveConfig({ timeoutMs: '30000' }), /timeoutMs/);
  assert.throws(() => resolveConfig({ enableSentTrigger: 'yes' }), /enableSentTrigger/);
  assert.throws(() => resolveConfig({ scopes: 'gmail.send' }), /scopes/);
  assert.throws(() => resolveConfig({ allowedRoots: '/tmp' }), /allowedRoots/);
  assert.throws(() => resolveConfig([]), /config must be an object/);
});

test('impossible values are rejected', () => {
  assert.throws(() => resolveConfig({ redirectPort: 70000 }), /redirectPort/);
  assert.throws(() => resolveConfig({ redirectPort: 8765.5 }), /redirectPort/);
  assert.throws(() => resolveConfig({ timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => resolveConfig({ defaultUserId: '   ' }), /defaultUserId/);
  assert.throws(() => resolveConfig({ maxAttachmentBytes: -1 }), /maxAttachmentBytes/);
});
