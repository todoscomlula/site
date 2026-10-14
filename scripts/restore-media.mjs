import { readFile, stat, mkdir, rename, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = new URL(process.env.PUBLIC_SITE_URL || 'https://todos-com-lula.vercel.app');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) {
  throw new Error('PUBLIC_SITE_URL deve ser um endereço HTTPS público sem credenciais.');
}
const files = new Set();
let pinnedSources = {};
try { pinnedSources = JSON.parse(await readFile(path.join(root, 'src/data/media-sources.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Fontes de mídia inválidas.'); }
if (!pinnedSources || typeof pinnedSources !== 'object' || Array.isArray(pinnedSources)) throw new Error('Fontes de mídia inválidas.');
for (const [url, source] of Object.entries(pinnedSources)) {
  if (!/^\/media\/instagram\/(?!\.+\/)[a-z0-9_.]{1,30}\/[A-Za-z0-9_-]+\.(mp4|mov|jpg|jpeg|png|webp)$/.test(url)
    || !source || !/^https:\/\/github\.com\/todoscomlula\/site\/releases\/download\/[a-zA-Z0-9._-]+\/[a-f0-9]{12}\.(mp4|jpg|jpeg|png|webp)$/.test(source.url || '')
    || !/^[a-f0-9]{64}$/.test(source.sha256 || '') || !Number.isInteger(source.bytes) || source.bytes < 1 || source.bytes > 90 * 1024 * 1024) {
    throw new Error('Fonte de mídia não permitida.');
  }
}
for (const url of Object.keys(pinnedSources)) files.add(url);
for (const name of ['instagram-posts.json', 'storiesig-posts.json']) {
  let entries;
  try { entries = JSON.parse(await readFile(path.join(root, 'src/data', name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') continue; throw new Error('Manifesto de mídia inválido.'); }
  if (!Array.isArray(entries)) throw new Error('Manifesto de mídia inválido.');
  for (const entry of entries) {
    for (const url of [entry.mediaUrl, entry.thumbnailUrl, entry.downloadUrl, ...(entry.media || []).flatMap(item => [item.url, item.thumbnailUrl])]) {
      if (!url) continue;
      if (typeof url !== 'string' || !/^\/media\/instagram\/(?!\.+\/)[a-z0-9_.]{1,30}\/[A-Za-z0-9_-]+\.(mp4|mov|jpg|jpeg|png|webp)$/.test(url)) {
        throw new Error('O manifesto contém um endereço de mídia não permitido.');
      }
      files.add(url);
    }
  }
}

let restored = 0;
for (const url of files) {
  const target = path.join(root, 'public', url.slice(1));
  const pinned = pinnedSources[url];
  try {
    const local = await stat(target);
    if (local.size > 0 && (!pinned || (local.size === pinned.bytes && createHash('sha256').update(await readFile(target)).digest('hex') === pinned.sha256))) continue;
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(pinned ? pinned.url : new URL(url, origin), { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error(`Mídia ausente no deployment público: ${url}. Execute a coleta local antes de publicar.`);
  const contentType = response.headers.get('content-type') || '';
  if (!/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime))\b/.test(contentType) && !(pinned && /^application\/octet-stream\b/.test(contentType))) throw new Error('O deployment retornou um tipo de mídia inesperado.');
  const size = Number(response.headers.get('content-length') || 0);
  if (size > 90 * 1024 * 1024) throw new Error('Arquivo excede o limite de restauração.');
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  try {
    let received = 0; const hash = createHash('sha256');
    const integrity = new Transform({ transform(chunk, encoding, done) {
      received += chunk.length;
      if (received > 90 * 1024 * 1024) return done(new Error('Arquivo excede o limite de restauração.'));
      hash.update(chunk); done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), integrity, createWriteStream(temporary, { flags: 'wx' }));
    if (!received || (pinned && (received !== pinned.bytes || hash.digest('hex') !== pinned.sha256))) throw new Error('A integridade da mídia não foi confirmada.');
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  restored++;
}
console.log(`Mídia verificada: ${files.size} arquivos locais; ${restored} restaurados do deployment público.`);
