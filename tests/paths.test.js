import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isInside, readablePath, writablePath, rootsFor } from '../lib/paths.js';
import { GmailError } from '../lib/util.js';

async function workspace() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gmail-root-')));
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'gmail-outside-')));
  await writeFile(path.join(root, 'inside.txt'), 'inside');
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  return { root, outside };
}

function rejectsWith(code) {
  return (error) => {
    assert.ok(error instanceof GmailError);
    assert.equal(error.code, code);
    return true;
  };
}

test('isInside compares path segments, not string prefixes', () => {
  assert.equal(isInside('/a/b/c', '/a/b'), true);
  assert.equal(isInside('/a/b', '/a/b'), true);
  assert.equal(isInside('/a/bc', '/a/b'), false);
  assert.equal(isInside('/a', '/a/b'), false);
});

test('a file inside the root is readable', async () => {
  const { root } = await workspace();
  const resolved = await readablePath(path.join(root, 'inside.txt'), [root]);
  assert.equal(resolved, path.join(root, 'inside.txt'));
});

test('a file outside every root is refused', async () => {
  const { root, outside } = await workspace();
  await assert.rejects(
    () => readablePath(path.join(outside, 'secret.txt'), [root]),
    rejectsWith('GMAIL_PATH_OUTSIDE_ROOTS'),
  );
});

test('a symlink inside the root cannot point outside it', async () => {
  const { root, outside } = await workspace();
  const link = path.join(root, 'escape.txt');
  await symlink(path.join(outside, 'secret.txt'), link);
  await assert.rejects(() => readablePath(link, [root]), rejectsWith('GMAIL_PATH_OUTSIDE_ROOTS'));
});

test('a missing file reports the path rather than passing the check', async () => {
  const { root } = await workspace();
  await assert.rejects(
    () => readablePath(path.join(root, 'nope.txt'), [root]),
    rejectsWith('GMAIL_PATH_UNREADABLE'),
  );
});

test('a destination inside the root is writable, including a new file', async () => {
  const { root } = await workspace();
  const target = await writablePath(path.join(root, 'new.txt'), [root]);
  assert.equal(target, path.join(root, 'new.txt'));
});

test('a destination outside the root is refused', async () => {
  const { root, outside } = await workspace();
  await assert.rejects(
    () => writablePath(path.join(outside, 'written.txt'), [root]),
    rejectsWith('GMAIL_PATH_OUTSIDE_ROOTS'),
  );
});

test('a directory destination and a missing parent each fail clearly', async () => {
  const { root } = await workspace();
  await mkdir(path.join(root, 'sub'));
  await assert.rejects(() => writablePath(path.join(root, 'sub'), [root]), rejectsWith('GMAIL_PATH_IS_DIRECTORY'));
  await assert.rejects(
    () => writablePath(path.join(root, 'missing', 'file.txt'), [root]),
    rejectsWith('GMAIL_PATH_NO_PARENT'),
  );
});

test('configured roots beat the session directory and are canonicalized', async () => {
  const { root } = await workspace();
  const ctx = { get: () => { throw new Error('workingDirectory must not be consulted'); } };
  const roots = await rootsFor(ctx, { allowedRoots: [root] }, {});
  assert.deepEqual(roots, [root]);
});

test('without configured roots the session directory is the root', async () => {
  const { root } = await workspace();
  const ctx = { get: (name) => name === 'workingDirectory' ? { ensure: async () => root } : undefined };
  assert.deepEqual(await rootsFor(ctx, { allowedRoots: [] }, { agent: {} }), [root]);
});

test('with no working directory service the process directory is the root', async () => {
  const ctx = { get: () => undefined };
  const roots = await rootsFor(ctx, { allowedRoots: [] }, {});
  assert.equal(roots.length, 1);
  assert.ok(path.isAbsolute(roots[0]));
});
