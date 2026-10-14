#!/usr/bin/env node
/** Collect public media through StoriesIG's visible browser interface. */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = { 'max-reels': 1, 'max-posts': 1, 'profile-delay': 5, 'max-total-mb': 85 };
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]?.replace(/^--/, '');
  if (!(name in options) && !['seed-metadata', 'source'].includes(name)) throw new Error('Argumento desconhecido.');
  options[name] = name === 'seed-metadata' || name === 'source' ? process.argv[index + 1] : Number(process.argv[index + 1]);
}
if (![options['max-reels'], options['max-posts']].every(value => Number.isInteger(value) && value >= 0 && value <= 20) || options['max-reels'] + options['max-posts'] < 1 || !(options['profile-delay'] >= 5 && options['profile-delay'] <= 60) || !(options['max-total-mb'] > 0 && options['max-total-mb'] <= 85)) throw new Error('Limites inválidos.');
const output = path.join(root, 'src/data/storiesig-posts.json');
const reportPath = path.join(root, 'data/storiesig-import-report.json');
const staging = path.join(root, '.cache/storiesig');
const mediaRoot = path.join(root, 'public/media/instagram');
await fs.mkdir(staging, { recursive: true });
const lockPath = path.join(staging, 'collector.lock');
try {
  const lock = await fs.open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
  await lock.close();
} catch (error) {
  if (error.code !== 'EEXIST') throw new Error('Não foi possível obter a trava de execução.');
  const priorPid = Number(await fs.readFile(lockPath, 'utf8'));
  let alive = false;
  if (Number.isInteger(priorPid) && priorPid > 0) { try { process.kill(priorPid, 0); alive = true; } catch {} }
  if (alive) throw new Error('Outra coleta está em execução; nenhum arquivo alterado.');
  await fs.unlink(lockPath);
  const lock = await fs.open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
  await lock.close();
}
process.on('exit', () => { try { fsSync.unlinkSync(lockPath); } catch {} });
const safeUsername = value => typeof value === 'string' && /^(?!\.+$)[a-z0-9_.]{1,30}$/.test(value);
const sleep = duration => new Promise(resolve => setTimeout(resolve, duration));
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const sources = JSON.parse(await fs.readFile(path.join(root, 'src/data/sources.json'), 'utf8')).map(source => source.username);
if (!sources.every(safeUsername)) throw new Error('Lista de fontes inválida.');
if (options.source && !sources.includes(options.source)) throw new Error('Fonte não configurada.');
const selectedSources = options.source ? [options.source] : sources;
let records = [];
try { records = JSON.parse(await fs.readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Manifesto anterior inválido; nenhuma coleta iniciada.'); }
if (!Array.isArray(records)) throw new Error('Manifesto anterior inválido.');
const report = { provider: 'storiesig-public-browser', startedAt: new Date().toISOString(), authenticated: false, maxReelsPerProfile: options['max-reels'], maxPostsPerProfile: options['max-posts'], maxTotalBytes: options['max-total-mb'] * 1024 * 1024, sources: [] };
let publishedBytes = 0;
for (const entry of records) {
  if (!safeUsername(entry.source) || !/^storiesig-[a-z0-9_.]+-[a-f0-9]{12}$/.test(entry.id)) throw new Error('Manifesto anterior inválido.');
}
try {
  for (const username of await fs.readdir(mediaRoot)) {
    if (!safeUsername(username)) continue;
    const directory = path.join(mediaRoot, username);
    if (!(await fs.stat(directory)).isDirectory()) continue;
    for (const filename of await fs.readdir(directory)) if (/\.(mp4|jpg|jpeg|png|webp)$/i.test(filename)) publishedBytes += (await fs.stat(path.join(directory, filename))).size;
  }
} catch (error) { if (error.code !== 'ENOENT') throw new Error('Não foi possível conferir os arquivos existentes.'); }
await fs.mkdir(staging, { recursive: true });

async function atomicJson(filename, data) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(temporary, filename);
}
async function persist() {
  await atomicJson(output, records);
  await atomicJson(reportPath, { ...report, finishedAt: new Date().toISOString(), recordsInFeed: records.length, publishedMediaBytes: publishedBytes });
}
async function command(binary, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'] });
    let stdout = '';
    if (capture) child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', () => reject(new Error('Ferramenta de mídia indisponível.')));
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error('Processamento de mídia falhou.')));
  });
}
async function importFile(filename, metadata) {
  const username = metadata.source;
  if (!safeUsername(username) || !sources.includes(username)) throw new Error('Fonte de arquivo inválida.');
  const extension = path.extname(filename).toLowerCase();
  if (!['.mp4', '.jpg', '.jpeg', '.png', '.webp'].includes(extension)) return 'unsupported_media';
  const originalHash = sha256(await fs.readFile(filename));
  const originalArchive = path.join(staging, 'originals', username, `${originalHash}${extension}`);
  await fs.mkdir(path.dirname(originalArchive), { recursive: true });
  try { await fs.access(originalArchive); } catch { await fs.copyFile(filename, originalArchive); }
  let prepared = filename;
  const isVideo = extension === '.mp4';
  if (isVideo) {
    const compressed = path.join(staging, `${username}-${originalHash.slice(0,12)}-web.mp4`);
    const probe = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filename], true));
    const duration = Number(probe.format?.duration);
    if (!(duration > 0)) return 'unsupported_media';
    const audioBitrate = duration > 180 ? 24000 : 32000;
    const videoBitrate = Math.max(24000, Math.min(500000, Math.floor(2.4 * 1024 * 1024 * 8 * 0.90 / duration - audioBitrate)));
    await command('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-i', filename, '-map', '0:v:0', '-map', '0:a?', '-vf', 'scale=w=\'if(gte(iw,ih),854,480)\':h=\'if(gte(iw,ih),480,854)\':force_original_aspect_ratio=decrease:force_divisible_by=2', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', String(videoBitrate), '-maxrate', String(Math.floor(videoBitrate * 1.15)), '-bufsize', String(videoBitrate * 2), '-c:a', 'aac', '-b:a', String(audioBitrate), '-map_metadata', '-1', '-movflags', '+faststart', compressed]);
    if ((await fs.stat(compressed)).size < (await fs.stat(filename)).size) prepared = compressed;
  }
  const bytes = await fs.readFile(prepared);
  const digest = sha256(bytes).slice(0, 12);
  const id = `storiesig-${username}-${digest}`;
  if (records.some(entry => entry.id === id)) return 'duplicate';
  const destination = path.join(mediaRoot, username, `${digest}${extension}`);
  let preview = null;
  let previewBytes = 0;
  if (isVideo) {
    preview = path.join(staging, `${username}-${digest}.jpg`);
    await command('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-i', prepared, '-frames:v', '1', '-q:v', '5', '-map_metadata', '-1', preview]);
    previewBytes = (await fs.stat(preview)).size;
  }
  if (publishedBytes + bytes.length + previewBytes > report.maxTotalBytes) return 'media_budget';
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  const url = `/media/instagram/${username}/${digest}${extension}`;
  const thumbnailUrl = isVideo ? `/media/instagram/${username}/${digest}.jpg` : url;
  if (preview) await fs.copyFile(preview, path.join(mediaRoot, username, `${digest}.jpg`));
  publishedBytes += bytes.length + previewBytes;
  const caption = String(metadata.caption ?? metadata.title ?? '').trim();
  const title = String(metadata.title ?? caption.split('\n').find(line => line.trim()) ?? `Publicação de @${username}`).slice(0, 120);
  let permalink = null;
  if (typeof metadata.permalink === 'string') {
    try {
      const candidate = new URL(metadata.permalink);
      if (candidate.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(candidate.hostname) && !candidate.username && /^\/(p|reel|reels)\/[A-Za-z0-9_-]+\/?$/.test(candidate.pathname)) permalink = `https://www.instagram.com${candidate.pathname}`;
    } catch {}
  }
  const kind = isVideo ? 'video' : 'image';
  records.push({ id, source: username, sourceUrl: `https://www.instagram.com/${username}/${metadata.tab === 'reels' ? 'reels/' : ''}`, permalink, title, excerpt: caption.slice(0, 280), publishedAt: null, observedAt: new Date().toISOString(), publishedLabel: metadata.publishedLabel || null, kind, mediaUrl: url, thumbnailUrl, downloadUrl: url, media: [{ kind, url, thumbnailUrl, filename: path.basename(destination) }] });
  await persist();
  return 'imported';
}

if (options['seed-metadata']) {
  const seeds = JSON.parse(await fs.readFile(options['seed-metadata'], 'utf8'));
  for (const entry of seeds) {
    if (!entry.path || !path.resolve(entry.path).startsWith('/tmp/lula-storiesig/')) throw new Error('Local de captura inválido.');
    const status = await importFile(entry.path, entry);
    console.log(`@${entry.source}: captura anterior ${status}`);
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
context.on('page', popup => { if (popup !== page) popup.close().catch(() => {}); });
let blocked = null;
page.on('response', response => {
  const hostname = new URL(response.url()).hostname;
  if ((hostname === 'storiesig.info' || hostname.endsWith('.storiesig.info')) && [401, 403, 429].includes(response.status())) blocked = response.status() === 429 ? 'rate_limited' : 'access_restricted';
});
async function checkAccess() {
  const body = await page.locator('body').innerText();
  if (/verify you are human|checking your browser|confirm you are human|confirme que você é humano|captcha required|challenge required/i.test(body)) blocked = 'challenge_required';
  if (blocked) throw new Error(blocked);
}
async function normalSearch(username) {
  await page.getByPlaceholder('@username or link').fill(username);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const direct = page.getByText('Prefiro baixar diretamente pelo navegador', { exact: false }).first();
  try { await direct.waitFor({ state: 'visible', timeout: 12000 }); await direct.click(); } catch { await checkAccess(); }
  await page.getByText(`@${username}`, { exact: true }).first().waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await checkAccess();
}
async function collectTab(username, tab, maxItems, sourceReport) {
  if (!maxItems) return;
  const priorCount = records.filter(entry => entry.source === username && entry.sourceUrl?.endsWith(tab === 'reels' ? '/reels/' : `/${username}/`)).length;
  if (priorCount >= maxItems) return;
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await sleep(2000);
  await checkAccess();
  const links = page.getByRole('link', { name: 'Baixar', exact: true });
  try { await links.first().waitFor({ state: 'visible', timeout: 15000 }); } catch { await checkAccess(); }
  const count = Math.min(await links.count(), maxItems + 2);
  sourceReport.tabs ??= {};
  sourceReport.tabs[tab] = { visibleDownloads: await links.count(), imported: 0 };
  let accepted = 0;
  for (let index = 0; index < count && accepted + priorCount < maxItems; index++) {
    const link = links.nth(index);
    if (!(await link.isVisible())) continue;
    const metadata = await link.evaluate(element => {
      let candidate = element.parentElement;
      let current = candidate;
      for (let step = 0; current && step < 8; step++, current = current.parentElement) {
        if (current.querySelectorAll('a[download]').length !== 1) break;
        candidate = current;
      }
      const text = candidate?.innerText?.trim() || '';
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
      const caption = lines.find(line => !/^baixar$/i.test(line) && !/^[\d,.]+\s*[km]?$/i.test(line) && !/\bago$/.test(line)) || '';
      const original = [...(candidate?.querySelectorAll('a[href]') || [])].find(anchor => /^https:\/\/(www\.)?instagram\.com\/(p|reels?)\//.test(anchor.href));
      const publishedLabel = lines.find(line => /\bago$/.test(line)) || null;
      return { caption, title: caption.slice(0, 120), permalink: original ? new URL(original.href).origin + new URL(original.href).pathname : null, publishedLabel };
    });
    metadata.source = username;
    metadata.tab = tab;
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      link.click(),
    ]);
    let extension = path.extname(download.suggestedFilename()).toLowerCase();
    const temporary = path.join(staging, `${username}-${tab}-${index}.download`);
    await download.saveAs(temporary);
    if (!['.mp4', '.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
      const file = await fs.open(temporary, 'r');
      const header = Buffer.alloc(32);
      await file.read(header, 0, 32, 0);
      await file.close();
      extension = header.subarray(4, 8).toString() === 'ftyp' ? '.mp4' : header[0] === 0xff && header[1] === 0xd8 ? '.jpg' : header.subarray(1, 4).toString() === 'PNG' ? '.png' : header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP' ? '.webp' : null;
    }
    if (!extension) { sourceReport.unsupported_media = (sourceReport.unsupported_media || 0) + 1; continue; }
    const saved = path.join(staging, `${username}-${tab}-${index}${extension}`);
    await fs.rename(temporary, saved);
    await checkAccess();
    const status = await importFile(saved, metadata);
    sourceReport[status] = (sourceReport[status] || 0) + 1;
    if (status === 'imported') sourceReport.tabs[tab].imported++;
    if (status === 'imported' || status === 'duplicate') accepted++;
    if (status === 'media_budget') break;
  }
}

try {
  const response = await page.goto('https://storiesig.info/pt7IJ/', { waitUntil: 'load', timeout: 45000 });
  if (response.status() >= 400) blocked = 'access_restricted';
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await checkAccess();
  for (let index = 0; index < selectedSources.length; index++) {
    const username = selectedSources[index];
    const sourceReport = { source: username, status: 'ok', imported: 0 };
    report.sources.push(sourceReport);
    try {
      const previous = records.filter(entry => entry.source === username);
      const complete = previous.filter(entry => entry.sourceUrl?.endsWith('/reels/')).length >= options['max-reels'] && previous.filter(entry => entry.sourceUrl?.endsWith(`/${username}/`)).length >= options['max-posts'];
      if (complete) sourceReport.status = 'preserved';
      else {
        await normalSearch(username);
        await collectTab(username, 'posts', options['max-posts'], sourceReport);
        await collectTab(username, 'reels', options['max-reels'], sourceReport);
      }
    } catch {
      sourceReport.status = blocked || 'public_flow_unavailable';
    }
    sourceReport.recordsInFeed = records.filter(entry => entry.source === username).length;
    if (sourceReport.media_budget) sourceReport.status = 'media_budget';
    else if (sourceReport.status === 'ok' && sourceReport.recordsInFeed === 0) sourceReport.status = 'media_unavailable';
    await persist();
    console.log(`@${username}: ${sourceReport.status}; ${sourceReport.recordsInFeed} arquivos; ${(publishedBytes / 1024 / 1024).toFixed(1)} MiB publicados`);
    if (blocked) {
      for (const remaining of selectedSources.slice(index + 1)) report.sources.push({ source: remaining, status: 'not_attempted', imported: 0 });
      break;
    }
    if (sourceReport.status !== 'preserved' && index + 1 < selectedSources.length) await sleep(options['profile-delay'] * 1000);
  }
} catch {
  report.status = blocked || 'public_flow_unavailable';
} finally {
  await persist();
  await browser.close();
}
console.log(`Coleta concluída: ${records.length} arquivos reais; ${publishedBytes} bytes públicos.`);
process.exitCode = blocked || report.status || report.sources.some(source => !['ok', 'preserved'].includes(source.status)) ? 1 : 0;
