import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareVideoQuality, runMediaCommand } from './video-quality.mjs';

test('compatible video keeps its resolution and every decoded frame without another lossy encode', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lula-video-quality-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = path.join(directory, 'original.mp4');
  const output = path.join(directory, 'prepared.mp4');
  await runMediaCommand('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-t', '1.5', '-c:v', 'libx264', '-crf', '18', '-an', original]);
  const result = await prepareVideoQuality(original, output);
  assert.equal(result.copiedVideo, true);
  const probe = JSON.parse(await runMediaCommand('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', output], true));
  assert.deepEqual(probe.streams[0], { width: 720, height: 1280 });
  const hashes = async (file) => (await runMediaCommand('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'], true))
    .split('\n').filter((line) => line && !line.startsWith('#')).map((line) => line.split(',').at(-1).trim());
  assert.deepEqual(await hashes(output), await hashes(original));
});
