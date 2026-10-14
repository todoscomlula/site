#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PublishingError } from './instagram-publishing/core.mjs';

export async function prepareImages({ directory = process.cwd() } = {}) {
  // Sharp is already supplied by Astro. This conversion happens before deployment.
  const { default: sharp } = await import('sharp');
  const readManifest = async (name, optional = false) => {
    try { return JSON.parse(await readFile(resolve(directory, 'src/data', name), 'utf8')); }
    catch (error) { if (optional && error.code === 'ENOENT') return []; throw error; }
  };
  const editorial = await readManifest('editorial.json');
  const imported = [...await readManifest('instagram-posts.json', true), ...await readManifest('storiesig-posts.json', true)];
  const records = [...editorial.map((record) => ({ ...record, editorial: true })),
    ...imported.filter((record) => record.kind === 'image').map((record) => ({ ...record, editorial: false }))];
  const publicRoot = resolve(directory, 'public');
  const roots = [resolve(publicRoot, 'cards'), resolve(publicRoot, 'media/instagram')];
  const assets = {};
  let converted = 0;
  for (const record of records) {
    const source = record.downloadUrl || record.mediaUrl || record.imageUrl || record.thumbnailUrl;
    if (typeof source !== 'string' || !/^\/(cards|media\/instagram)\/[a-zA-Z0-9_/-]+\.(png|webp|jpe?g)$/.test(source)) continue;
    if (typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(record.id)) throw new PublishingError('INVALID_PUBLIC_IMAGE_ID');
    const input = resolve(publicRoot, source.slice(1));
    if (!roots.some((root) => input.startsWith(root + '/'))) throw new PublishingError('INVALID_CARD_IMAGE_PATH');
    const metadata = await sharp(input).metadata();
    const swapDimensions = [5, 6, 7, 8].includes(metadata.orientation);
    const width = swapDimensions ? metadata.height : metadata.width;
    const height = swapDimensions ? metadata.width : metadata.height;
    const ratio = width / height;
    if (!Number.isFinite(ratio) || width < 1 || height < 1) throw new PublishingError('INVALID_IMAGE_DIMENSIONS');
    const file = await stat(input);
    if (metadata.format === 'jpeg' && /\.jpe?g$/.test(input) && ratio >= 0.8 && ratio <= 1.91
      && width >= 320 && width <= 1440 && file.size <= 8 * 1024 ** 2 && (!metadata.orientation || metadata.orientation === 1)) {
      assets[record.id] = source;
      continue;
    }
    const output = /\.(png|webp)$/.test(input) ? input.replace(/\.(png|webp)$/, '.jpg') : input.replace(/\.jpe?g$/, '-instagram.jpg');
    let image = sharp(input).rotate().flatten({ background: '#FAF6EF' }).toColourspace('srgb');
    if (ratio < 0.8) {
      const canvasWidth = Math.floor(Math.min(1440, Math.max(320, height * 0.8)) / 4) * 4;
      image = image.resize({ width: canvasWidth, height: canvasWidth * 5 / 4, fit: 'contain', background: '#FAF6EF' });
    } else if (ratio > 1.91) {
      const canvasWidth = Math.round(Math.min(1440, Math.max(320, width)));
      image = image.resize({ width: canvasWidth, height: Math.ceil(canvasWidth / 1.91), fit: 'contain', background: '#FAF6EF' });
    } else {
      image = image.resize({ width: Math.round(Math.min(1440, Math.max(320, width))) });
    }
    const jpeg = await image.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    if (jpeg.length > 8 * 1024 ** 2) throw new PublishingError('CARD_JPEG_TOO_LARGE');
    await writeFile(output, jpeg);
    assets[record.id] = '/' + relative(publicRoot, output).split(sep).join('/');
    converted += 1;
  }
  await mkdir(publicRoot, { recursive: true });
  await writeFile(resolve(publicRoot, 'instagram-publication-assets.json'), JSON.stringify({ version: 1, assets }, null, 2) + '\n');
  return converted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareImages().then((count) => console.log(`${count} imagens JPEG preparadas para publicação no Instagram.`)).catch(() => {
    console.error('Não foi possível preparar as imagens JPEG. Verifique os cards e a instalação do Astro/Sharp.');
    process.exitCode = 1;
  });
}
