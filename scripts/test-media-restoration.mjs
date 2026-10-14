import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const mediaUrl = '/media/instagram/lulaoficial/123456789abc.mp4';
const assetUrl = 'https://github.com/todoscomlula/site/releases/download/media-quality-test/123456789abc.mp4';
const bytes = Buffer.from('TEST_MEDIA_BYTES_WITHOUT_CREDENTIALS');

async function fixture(t, source, url = mediaUrl) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lula-media-restore-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts'), { recursive: true });
  await mkdir(path.join(directory, 'src/data'), { recursive: true });
  await copyFile('scripts/restore-media.mjs', path.join(directory, 'scripts/restore-media.mjs'));
  await writeFile(path.join(directory, 'src/data/storiesig-posts.json'), JSON.stringify([{ mediaUrl: url }]));
  await writeFile(path.join(directory, 'src/data/media-sources.json'), JSON.stringify({ [url]: source }));
  t.mock.method(console, 'log', () => {});
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (request) => {
    requests.push(String(request));
    return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
  });
  return { directory, requests, run: () => import(pathToFileURL(path.join(directory, 'scripts/restore-media.mjs')).href) };
}
const valid = () => ({ url: assetUrl, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });

test('clean builds restore verified public release assets instead of the compressed deployment copy', async (t) => {
  const data = await fixture(t, valid());
  await data.run();
  assert.deepEqual(data.requests, [assetUrl]);
  assert.deepEqual(await readFile(path.join(data.directory, 'public', mediaUrl.slice(1))), bytes);
});

test('a bad media checksum never installs the downloaded file or leaves a partial asset', async (t) => {
  const data = await fixture(t, { ...valid(), sha256: '0'.repeat(64) });
  await assert.rejects(data.run(), /integridade/);
  await assert.rejects(stat(path.join(data.directory, 'public', mediaUrl.slice(1))), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(data.directory, 'public', mediaUrl.slice(1) + '.tmp')), { code: 'ENOENT' });
});

test('release restoration rejects credentials, foreign repositories and path traversal before fetching', async (t) => {
  for (const [sourceUrl, fileUrl] of [
    [assetUrl + '?access_token=PLACEHOLDER', mediaUrl],
    [assetUrl.replace('todoscomlula/site', 'another/repository'), mediaUrl],
    [assetUrl, '/media/instagram/../outside.mp4'],
  ]) {
    const data = await fixture(t, { ...valid(), url: sourceUrl }, fileUrl);
    await assert.rejects(data.run(), /permitid/);
    assert.equal(data.requests.length, 0);
    t.mock.restoreAll();
  }
});
