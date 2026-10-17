import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildMime, loadAttachment } from '../lib/mime.js';
import { GmailError } from '../lib/util.js';

test('a plain-text message carries the expected headers and encodes the body', async () => {
  const raw = await buildMime({ to: 'a@example.com', subject: 'Hello', body: 'Line one' });
  assert.match(raw, /^MIME-Version: 1\.0\r\n/);
  assert.match(raw, /\r\nTo: a@example\.com\r\n/);
  assert.match(raw, /\r\nSubject: Hello\r\n/);
  assert.match(raw, /Content-Transfer-Encoding: base64/);
  assert.ok(raw.includes(Buffer.from('Line one', 'utf8').toString('base64')));
});

test('an HTML body is sent as text/html, not escaped into plain text', async () => {
  const raw = await buildMime({ to: 'a@example.com', subject: 'Hi', body: '<p>Hi</p>', isHtml: true });
  assert.match(raw, /Content-Type: text\/html; charset=UTF-8/);
  assert.ok(raw.includes(Buffer.from('<p>Hi</p>', 'utf8').toString('base64')));
});

test('non-ASCII subjects use RFC 2047 encoding', async () => {
  const raw = await buildMime({ to: 'a@example.com', subject: 'Grüße', body: 'x' });
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
});

test('an inline base64 attachment appears as a multipart/mixed part', async () => {
  const raw = await buildMime({
    to: 'a@example.com',
    subject: 'With file',
    body: 'see attached',
    attachments: [{ name: 'notes.txt', mimetype: 'text/plain', base64: Buffer.from('hello').toString('base64') }],
  });
  assert.match(raw, /Content-Type: multipart\/mixed; boundary="dsh-mix-/);
  assert.match(raw, /filename="notes\.txt"/);
  assert.ok(raw.includes(Buffer.from('hello').toString('base64')));
});

test('a local attachment inside the roots is read', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gmail-mime-')));
  const file = path.join(root, 'report.csv');
  await writeFile(file, 'a,b\n1,2\n');
  const raw = await buildMime({ to: 'a@example.com', subject: 's', body: 'b', attachments: [file], attachmentRoots: [root] });
  assert.match(raw, /filename="report\.csv"/);
});

test('a local attachment outside the roots is refused', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gmail-mime-root-')));
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'gmail-mime-out-')));
  const file = path.join(outside, 'secret.txt');
  await writeFile(file, 'secret');
  await assert.rejects(
    () => buildMime({ to: 'a@example.com', subject: 's', body: 'b', attachments: [file], attachmentRoots: [root] }),
    (error) => error instanceof GmailError && error.code === 'GMAIL_PATH_OUTSIDE_ROOTS',
  );
});

test('a URL attachment over the byte cap is refused before it is buffered', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '2048' });
    response.end(Buffer.alloc(2048, 0x41));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await assert.rejects(
      () => loadAttachment(`http://127.0.0.1:${port}/big.bin`, { roots: [], maxBytes: 1024 }),
      /over the 1024-byte limit/,
    );
  } finally {
    server.close();
  }
});

test('a small URL attachment is fetched and named from the path', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const loaded = await loadAttachment(`http://127.0.0.1:${port}/note.txt`, { roots: [], maxBytes: 1024 });
    assert.equal(loaded.name, 'note.txt');
    assert.equal(Buffer.from(loaded.bytes).toString(), 'ok');
  } finally {
    server.close();
  }
});
