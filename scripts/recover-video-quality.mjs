#!/usr/bin/env node
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { prepareVideoQuality, runMediaCommand } from './video-quality.mjs';
import { fingerprintVideo } from './storiesig-video-fingerprint.mjs';

const root = process.cwd();
const plan = JSON.parse(await readFile('.cache/storiesig/quality-recovery-plan.json', 'utf8'));
const manifestPath = 'src/data/storiesig-posts.json';
const records = JSON.parse(await readFile(manifestPath, 'utf8'));
const fingerprints = JSON.parse(await readFile('.cache/storiesig/video-fingerprints.json', 'utf8'));
const release = 'media-quality-2026-10-14';
const repaired = []; const unavailable = [];
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');

for (const record of records.filter((entry) => entry.kind === 'video')) {
  const item = plan.find((entry) => entry.id === record.id);
  if (!item?.original) { unavailable.push(record.id); continue; }
  const input = path.resolve(root, item.original.file);
  if (!input.startsWith(path.join(root, '.cache/storiesig') + path.sep)) throw new Error('Arquivo de origem não permitido.');
  const staged = path.join(root, '.cache/storiesig', `${record.id}-quality.mp4`);
  const info = await prepareVideoQuality(input, staged);
  const bytes = await readFile(staged);
  if (bytes.length > 90 * 1024 * 1024) throw new Error('Vídeo excede o limite de qualidade.');
  const stem = digest(bytes).slice(0, 12);
  const directory = path.join(root, 'public/media/instagram', record.source);
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${stem}.mp4`);
  await writeFile(filename, bytes);
  await runMediaCommand('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-i', filename, '-frames:v', '1', '-q:v', '2', '-map_metadata', '-1', path.join(directory, `${stem}.jpg`)]);
  const mediaUrl = `/media/instagram/${record.source}/${stem}.mp4`;
  const thumbnailUrl = `/media/instagram/${record.source}/${stem}.jpg`;
  record.mediaUrl = mediaUrl; record.downloadUrl = mediaUrl; record.thumbnailUrl = thumbnailUrl;
  record.media = [{ kind: 'video', url: mediaUrl, thumbnailUrl, filename: `${stem}.mp4` }];
  record.videoQuality = { width: info.width, height: info.height, preservedSource: info.copiedVideo };
  fingerprints[record.id] = { ...await fingerprintVideo(filename), basis: 'published-media' };
  repaired.push({ id: record.id, width: info.width, height: info.height, bytes: bytes.length });
}

const pinned = {}; const assets = new Map();
for (const source of await readdir('public/media/instagram')) {
  if (!/^(?!\.+$)[a-z0-9_.]{1,30}$/.test(source)) throw new Error('Fonte não permitida.');
  const directory = `public/media/instagram/${source}`;
  if (!(await stat(directory)).isDirectory()) continue;
  for (const filename of await readdir(directory)) {
    if (!/^[A-Za-z0-9_-]+\.(mp4|jpg|jpeg|png|webp)$/.test(filename)) continue;
    const file = `${directory}/${filename}`; const buffer = await readFile(file); const hash = digest(buffer);
    const assetName = hash.slice(0, 12) + path.extname(filename);
    pinned[`/media/instagram/${source}/${filename}`] = {
      url: `https://github.com/todoscomlula/site/releases/download/${release}/${assetName}`,
      sha256: hash, bytes: buffer.length,
    };
    if (!assets.has(assetName)) assets.set(assetName, { name: assetName, file, sha256: hash, bytes: buffer.length });
  }
}
await writeFile(manifestPath, JSON.stringify(records, null, 2) + '\n');
await writeFile('src/data/media-sources.json', JSON.stringify(pinned, null, 2) + '\n');
await writeFile('.cache/storiesig/video-fingerprints.json', JSON.stringify(fingerprints, null, 2) + '\n');
await writeFile('.cache/storiesig/quality-release-assets.json', JSON.stringify([...assets.values()], null, 2) + '\n');
await writeFile('.cache/storiesig/quality-recovery-result.json', JSON.stringify({ repaired, unavailable }, null, 2) + '\n');
console.log(JSON.stringify({ repaired: repaired.length, unavailable, releaseAssets: assets.size, megabytes: Math.round([...assets.values()].reduce((sum, asset) => sum + asset.bytes, 0) / 1024 ** 2) }));
