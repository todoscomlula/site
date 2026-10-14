import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { prepareImages } from './prepare-instagram-assets.mjs';

async function temporarySite(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'lula-instagram-assets-'));
  try {
    await mkdir(join(directory, 'src/data'), { recursive: true });
    await mkdir(join(directory, 'public/media/instagram/sample'), { recursive: true });
    await writeFile(join(directory, 'src/data/editorial.json'), '[]');
    await writeFile(join(directory, 'src/data/instagram-posts.json'), '[]');
    return await callback(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('StoriesIG WebP gets a real public JPEG and publication mapping', async () => temporarySite(async (directory) => {
  const source = '/media/instagram/sample/image.webp';
  await sharp({ create: { width: 400, height: 400, channels: 3, background: '#d51d38' } }).webp().toFile(join(directory, 'public', source));
  await writeFile(join(directory, 'src/data/storiesig-posts.json'), JSON.stringify([{ id: 'storiesig-image', kind: 'image', mediaUrl: source }]));
  assert.equal(await prepareImages({ directory }), 1);
  const mapping = JSON.parse(await readFile(join(directory, 'public/instagram-publication-assets.json'), 'utf8'));
  assert.equal(mapping.assets['storiesig-image'], '/media/instagram/sample/image.jpg');
  assert.equal((await sharp(join(directory, 'public', mapping.assets['storiesig-image'])).metadata()).format, 'jpeg');
}));

test('tall JPEG keeps the complete frame and adds padding without overwriting the original', async () => temporarySite(async (directory) => {
  const source = '/media/instagram/sample/tall.jpg';
  const file = join(directory, 'public', source);
  await sharp({ create: { width: 400, height: 800, channels: 3, background: '#167a4f' } }).jpeg().toFile(file);
  const before = await readFile(file);
  await writeFile(join(directory, 'src/data/storiesig-posts.json'), JSON.stringify([{ id: 'tall-image', kind: 'image', downloadUrl: source }]));
  assert.equal(await prepareImages({ directory }), 1);
  assert.deepEqual(await readFile(file), before);
  const mapping = JSON.parse(await readFile(join(directory, 'public/instagram-publication-assets.json'), 'utf8'));
  assert.equal(mapping.assets['tall-image'], '/media/instagram/sample/tall-instagram.jpg');
  const padded = sharp(join(directory, 'public', mapping.assets['tall-image']));
  const { width, height } = await padded.metadata();
  assert.equal(width / height, 0.8); assert.equal(height, 800);
  const { data, info } = await padded.raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
  const left = pixel(3, 400); const center = pixel(Math.floor(width / 2), 400);
  assert.ok(left[0] > 230 && left[1] > 230 && left[2] > 230);
  assert.ok(center[1] > center[0] + 40 && center[1] > center[2] + 30);
}));

test('valid JPEG keeps its permanent original URL and bytes', async () => temporarySite(async (directory) => {
  const source = '/media/instagram/sample/already-valid.jpg';
  const file = join(directory, 'public', source);
  await sharp({ create: { width: 400, height: 400, channels: 3, background: '#f4ce47' } }).jpeg().toFile(file);
  const before = await readFile(file);
  await writeFile(join(directory, 'src/data/storiesig-posts.json'), JSON.stringify([{ id: 'valid-image', kind: 'image', mediaUrl: source }]));
  assert.equal(await prepareImages({ directory }), 0);
  assert.deepEqual(await readFile(file), before);
  const mapping = JSON.parse(await readFile(join(directory, 'public/instagram-publication-assets.json'), 'utf8'));
  assert.equal(mapping.assets['valid-image'], source);
}));
