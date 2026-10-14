import { readFile, stat, mkdir, rename, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = new URL(process.env.PUBLIC_SITE_URL || 'https://todos-com-lula.vercel.app');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) {
  throw new Error('PUBLIC_SITE_URL deve ser um endereço HTTPS público sem credenciais.');
}
const files = new Set();
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
  try { if ((await stat(target)).size > 0) continue; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(new URL(url, origin), { signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.body) throw new Error(`Mídia ausente no deployment público: ${url}. Execute a coleta local antes de publicar.`);
  const contentType = response.headers.get('content-type') || '';
  if (!/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime))\b/.test(contentType)) throw new Error('O deployment retornou um tipo de mídia inesperado.');
  const size = Number(response.headers.get('content-length') || 0);
  if (size > 90 * 1024 * 1024) throw new Error('Arquivo excede o limite de restauração.');
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
    if ((await stat(temporary)).size > 90 * 1024 * 1024) throw new Error('Arquivo excede o limite de restauração.');
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  restored++;
}
console.log(`Mídia verificada: ${files.size} arquivos locais; ${restored} restaurados do deployment público.`);
