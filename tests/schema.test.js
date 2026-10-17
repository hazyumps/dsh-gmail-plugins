import assert from 'node:assert/strict';
import test from 'node:test';

import { compileParameters, defineTool, validateArgs } from '../lib/tools.js';
import { GmailError } from '../lib/util.js';

test('compiles the author shorthand into JSON Schema', () => {
  const schema = compileParameters({
    query: { type: 'string', required: true, description: 'Gmail search query.' },
    max: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } },
    blob: { type: 'json' },
    visibility: { type: 'string', enum: ['show', 'hide'] },
  });
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['query']);
  assert.deepEqual(schema.properties.tags, { type: 'array', items: { type: 'string' } });
  assert.deepEqual(schema.properties.blob, {});
  assert.deepEqual(schema.properties.visibility, { type: 'string', enum: ['show', 'hide'] });
});

test('a bare parameter defaults to string, like the upstream shorthand', () => {
  const schema = compileParameters({ query: { description: 'q' } });
  assert.deepEqual(schema.properties.query, { type: 'string', description: 'q' });
});

test('unsupported shorthand fails at definition time, not call time', () => {
  assert.throws(() => compileParameters({ x: { type: 'date' } }), /unsupported type/);
  assert.throws(() => compileParameters({ x: { type: 'object' } }), /additionalProperties/);
  assert.throws(() => compileParameters({ x: { enum: [] } }), /enum/);
});

test('validateArgs reports required, type, and enum violations by path', () => {
  const schema = compileParameters({
    query: { type: 'string', required: true },
    max: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } },
    visibility: { type: 'string', enum: ['show', 'hide'] },
  });
  assert.deepEqual(validateArgs(schema, { query: 'is:unread' }), []);
  assert.deepEqual(validateArgs(schema, {}), ['args.query is required']);
  assert.deepEqual(validateArgs(schema, { query: 3 }), ['args.query must be a string']);
  assert.deepEqual(validateArgs(schema, { query: 'x', max: 1.5 }), ['args.max must be an integer']);
  assert.deepEqual(validateArgs(schema, { query: 'x', tags: ['a', 2] }), ['args.tags[1] must be a string']);
  assert.deepEqual(validateArgs(schema, { query: 'x', visibility: 'other' }), ['args.visibility must be one of "show", "hide"']);
  assert.deepEqual(validateArgs(schema, null), ['arguments must be an object']);
});

test('a defined tool validates before running and soft-skips its card on bad args', async () => {
  let ran = 0;
  const tool = defineTool({
    name: 'demo',
    description: 'demo tool',
    title: 'Demo',
    kind: 'read',
    parameters: { name: { type: 'string', required: true } },
    async execute(args) {
      ran += 1;
      return { hello: args.name };
    },
  });

  assert.deepEqual(await tool.execute({ name: 'world' }, {}), { hello: 'world' });
  await assert.rejects(() => tool.execute({}, {}), (error) => {
    assert.ok(error instanceof GmailError);
    assert.equal(error.code, 'GMAIL_INVALID_ARGS');
    assert.match(error.message, /args\.name is required/);
    return true;
  });
  assert.equal(ran, 1);
  assert.equal(tool.presentCall({}), undefined);
  assert.deepEqual(tool.presentCall({ name: 'world' }), {
    card: 'generic',
    title: 'Demo',
    kind: 'read',
    rawInput: { name: 'world' },
  });
});

test('tools without a description are rejected', () => {
  assert.throws(() => defineTool({ name: 'x', parameters: {}, execute() {} }), /description/);
});
