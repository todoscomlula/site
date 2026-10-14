/** Compare video content across different encodings without changing the media. */
import { spawn } from 'node:child_process';

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', () => reject(new Error('Ferramenta de mídia indisponível.')));
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Não foi possível comparar o vídeo.')));
  });
}

export function differenceHash(pixels) {
  if (pixels.length !== 72) throw new Error('Quadro de comparação inválido.');
  let bits = 0n;
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      bits = (bits << 1n) | BigInt(pixels[row * 9 + column] < pixels[row * 9 + column + 1]);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hammingDistance(first, second) {
  let difference = BigInt(`0x${first}`) ^ BigInt(`0x${second}`);
  let count = 0;
  while (difference) { difference &= difference - 1n; count++; }
  return count;
}

export async function fingerprintVideo(filename) {
  const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filename])).toString());
  const durationSeconds = Number(probe.format?.duration);
  if (!(durationSeconds > 0)) throw new Error('Duração de vídeo inválida.');
  const frames = [];
  for (const fraction of [0.15, 0.4, 0.7, 0.9]) {
    const frame = await run('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String(durationSeconds * fraction), '-i', filename, '-frames:v', '1', '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', 'pipe:1']);
    frames.push(differenceHash(frame));
  }
  return { version: 1, durationSeconds, frames };
}

function captionKey(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);
}

export function sameVideo(first, second, firstCaption = '', secondCaption = '') {
  if (!first || !second || first.version !== 1 || second.version !== 1 || first.frames.length !== 4 || second.frames.length !== 4) return false;
  if (Math.abs(first.durationSeconds - second.durationSeconds) > 0.6) return false;
  const distances = first.frames.map((frame, index) => hammingDistance(frame, second.frames[index]));
  const average = distances.reduce((sum, distance) => sum + distance, 0) / 4;
  if (average <= 3.5 && Math.max(...distances) <= 6) return true;
  const firstKey = captionKey(firstCaption);
  return firstKey.length >= 30 && firstKey === captionKey(secondCaption) && average <= 8 && Math.max(...distances) <= 12;
}

export function assignContentGroups(records, fingerprints) {
  const groups = [];
  const representativeById = new Map();
  const observedTime = record => Number.isFinite(Date.parse(record.observedAt)) ? Date.parse(record.observedAt) : Infinity;
  const ordered = records.filter(record => record.kind === 'video').toSorted((first, second) => observedTime(first) - observedTime(second) || first.id.localeCompare(second.id));
  for (const record of ordered) {
    // Every pair must match visually; weaker caption matches and transitive links do not group clips.
    let group = groups.find(members => members.every(member => sameVideo(fingerprints[record.id], fingerprints[member.id])));
    if (!group) { group = []; groups.push(group); }
    group.push(record);
    representativeById.set(record.id, group[0].id);
  }
  return records.map(record => record.kind === 'video' ? { ...record, contentGroupId: representativeById.get(record.id) } : record);
}

export function relativeAgeDays(label) {
  const match = String(label ?? '').match(/(\d+)\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago/i);
  if (!match) return null;
  const factors = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
  return Number(match[1]) * factors[match[2].toLowerCase().replace(/s$/, '')];
}
