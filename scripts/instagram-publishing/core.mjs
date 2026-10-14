import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const TARGET_ACCOUNT = 'boraaalula2026';
export const STATE_BRANCH = 'instagram-publishing-state';
export const STATE_REPOSITORY = 'todoscomlula/site';
export const API_VERSION = 'v26.0';
export const LEASE_MS = 20 * 60 * 1000;

export class PublishingError extends Error {
  constructor(code, status = null, providerCode = null) {
    super(code);
    this.name = 'PublishingError';
    this.code = code;
    this.status = Number.isInteger(status) ? status : null;
    this.providerCode = Number.isInteger(providerCode) ? providerCode : null;
  }
}

export function emptyState() {
  return { version: 1, account: TARGET_ACCOUNT, published: [], pending: null, lease: null };
}

const hasExactKeys = (object, keys) => object && typeof object === 'object'
  && !Array.isArray(object) && Object.keys(object).sort().join(',') === [...keys].sort().join(',');
const validPostId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id);
const validKey = (key) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
const validMediaId = (id) => id === null || (typeof id === 'string' && /^\d{1,40}$/.test(id));
const validDate = (date) => typeof date === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date));

/** Only these public fields may reach the state branch; never persist API responses. */
export function validateState(state) {
  const valid = hasExactKeys(state, ['version', 'account', 'published', 'pending', 'lease'])
    && state.version === 1 && state.account === TARGET_ACCOUNT
    && Array.isArray(state.published) && state.published.length <= 50_000
    && state.published.every((item) => hasExactKeys(item, ['contentHash', 'postId', 'mediaId', 'publishedAt'])
      && validKey(item.contentHash) && validPostId(item.postId) && validMediaId(item.mediaId) && validDate(item.publishedAt))
    && (state.pending === null || (hasExactKeys(state.pending, ['contentHash', 'postId', 'containerId', 'stage', 'createdAt'])
      && validKey(state.pending.contentHash) && validPostId(state.pending.postId)
      && validMediaId(state.pending.containerId)
      && ['reserved', 'processing', 'publishing'].includes(state.pending.stage)
      && (state.pending.stage === 'reserved' || state.pending.containerId !== null)
      && validDate(state.pending.createdAt)))
    && (state.lease === null || (hasExactKeys(state.lease, ['owner', 'expiresAt'])
      && typeof state.lease.owner === 'string' && /^[a-f0-9-]{36}$/.test(state.lease.owner)
      && validDate(state.lease.expiresAt)));
  if (!valid) throw new PublishingError('INVALID_PUBLIC_STATE');
  return state;
}

export function publicSiteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new PublishingError('INVALID_PUBLIC_SITE_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || url.port || !url.hostname.includes('.')
    || /(^|\.)(localhost|local|internal)$/.test(url.hostname)
    || /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) {
    throw new PublishingError('INVALID_PUBLIC_SITE_URL');
  }
  return url;
}

function externalSource(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function permanentAsset(value, site) {
  try {
    const url = new URL(value, site);
    if (url.origin !== site.origin || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/(cards|media\/instagram)\//.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

export function contentKey(post) {
  const permalink = externalSource(post.permalink);
  const identity = validPostId(post.contentGroupId) ? `clip:${post.contentGroupId}` : (permalink || `site:${post.id}`);
  return createHash('sha256').update(`${TARGET_ACCOUNT}\0${identity}`).digest('hex');
}

function completedHashes(posts, state) {
  const completed = new Set(state.published.map((item) => item.contentHash));
  for (const post of posts) {
    if (String(post?.source || '').replace(/^@/, '').toLowerCase() === TARGET_ACCOUNT && validPostId(post.contentGroupId)) {
      completed.add(contentKey(post));
    }
  }
  return completed;
}

export function publicationCandidate(post, site) {
  if (!post || !validPostId(post.id) || !['card', 'image', 'video'].includes(post.kind)) return null;
  if (String(post.source || '').replace(/^@/, '').toLowerCase() === TARGET_ACCOUNT) return null;
  if (!externalSource(post.sourceUrl) || !post.sourceName || !post.title) return null;
  let asset;
  if (post.kind === 'video') {
    asset = permanentAsset(post.mediaUrl || post.downloadUrl, site);
    if (!asset || !/\.mp4$/i.test(asset.pathname)) return null;
  } else {
    asset = permanentAsset(post.instagramImageUrl || post.downloadUrl || post.imageUrl, site);
    if (!asset) return null;
    // Instagram image publishing requires JPEG. The preparation script creates siblings.
    asset.pathname = asset.pathname.replace(/\.(png|webp)$/i, '.jpg');
    if (!/\.jpe?g$/i.test(asset.pathname)) return null;
  }
  return { post, key: contentKey(post), kind: post.kind === 'video' ? 'REELS' : 'IMAGE', mediaUrl: asset.href };
}

export function selectCandidate(posts, state, site) {
  const published = completedHashes(posts, state);
  const candidates = posts.map((post) => publicationCandidate(post, site)).filter(Boolean);
  if (state.pending) return candidates.find((item) => item.key === state.pending.contentHash && !published.has(item.key)) || null;
  return candidates.find((item) => !published.has(item.key)) || null;
}

function queueOrder(posts) {
  // Observation time orders arrival in the acervo, never the original publication date.
  // Older arrivals and the existing editorial backlog are served before new arrivals.
  return [...posts].sort((left, right) => {
    const observed = (post) => Number.isFinite(Date.parse(post?.observedAt)) ? Date.parse(post.observedAt) : 0;
    return observed(left) - observed(right);
  });
}

const cleanText = (value) => String(value || '').replace(/\r/g, '').replace(/#[\p{L}\p{N}_]+/gu, '')
  .replace(/@(?=\w)/g, '＠').replace(/[ \t]+/g, ' ').trim();
const shorten = (value, maximum) => Array.from(value).slice(0, maximum).join('');

/** Select relevant subjects from the actual post; these are not a live trend ranking. */
export function publicationHashtags(post) {
  const text = [post.id, post.title, post.excerpt].filter(Boolean).join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const rules = [
    [/farmacia[\s-]+popular/, ['FarmaciaPopular', 'SUS']],
    [/pe[\s-]?de[\s-]?meia/, ['PeDeMeia', 'Educacao']],
    [/bolsa[\s-]+familia/, ['BolsaFamilia', 'PoliticasPublicas']],
    [/minha[\s-]+casa[\s-]+minha[\s-]+vida/, ['MinhaCasaMinhaVida', 'Moradia']],
    [/amazonia|desmatamento|meio ambiente/, ['Amazonia', 'MeioAmbiente']],
    [/\bmei\b|prospera|desenrola/, ['MEI', 'Economia']],
    [/6[\s-]?x[\s-]?1/, ['FimDaEscala6x1', 'Trabalho']],
    [/trabalh|emprego/, ['Trabalho', 'Economia']],
    [/debate/, ['Debate', 'Eleicoes2026']],
    [/eleic|reeleic|urnas?|virada|bota pra virar/, ['Eleicoes2026', 'Democracia']],
    [/\bmpb\b|cinema|artistas?|cultura|milton nascimento/, ['Cultura', 'CulturaBrasileira']],
    [/jornalismo|denunci|investigacao/, ['Jornalismo', 'Informacao']],
  ];
  const subjects = rules.filter(([pattern]) => pattern.test(text)).flatMap(([, tags]) => tags);
  const context = post.kind === 'video' ? 'ReelsBrasil' : 'Brasil';
  return [...new Set(['Lula', 'TodosComLula', ...subjects.slice(0, 2), context])].slice(0, 5).map((tag) => `#${tag}`);
}

export function makeCaption(post, site) {
  const source = externalSource(post.sourceUrl);
  if (!source) throw new PublishingError('MISSING_SOURCE_ATTRIBUTION');
  const suffix = `Siga @${TARGET_ACCOUNT} para acompanhar os próximos conteúdos.\n\nFonte: ${shorten(cleanText(post.sourceName), 120)}\n${source}\n\n${new URL(`/conteudo/${encodeURIComponent(post.id)}/`, site).href}\nTodos com Lula · projeto independente.\n\n${publicationHashtags(post).join(' ')}`;
  const available = 2_200 - Array.from(suffix).length - 2;
  if (available < 1) throw new PublishingError('SOURCE_ATTRIBUTION_TOO_LONG');
  const title = cleanText(post.title); const excerpt = cleanText(post.excerpt);
  const opening = [shorten(title, 600), excerpt.toLowerCase() !== title.toLowerCase() ? shorten(excerpt, 900) : ''].filter(Boolean).join('\n\n');
  return `${shorten(opening, available)}\n\n${suffix}`;
}

export async function probeMedia(candidate, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(candidate.mediaUrl, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  } catch { throw new PublishingError('PUBLIC_MEDIA_UNREACHABLE'); }
  if (!response.ok) throw new PublishingError('PUBLIC_MEDIA_UNREACHABLE', response.status);
  const expected = candidate.kind === 'REELS' ? 'video/mp4' : 'image/jpeg';
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== expected) {
    throw new PublishingError('UNSUPPORTED_PUBLIC_MEDIA_TYPE');
  }
  const length = Number(response.headers.get('content-length'));
  const maximum = candidate.kind === 'REELS' ? 1024 ** 3 : 8 * 1024 ** 2;
  if (length > maximum) throw new PublishingError('PUBLIC_MEDIA_TOO_LARGE');
}

async function availableCandidate(posts, state, site, fetchImpl, log) {
  if (state.pending) {
    const candidate = selectCandidate(posts, state, site);
    if (candidate && state.pending.containerId === null) await probeMedia(candidate, fetchImpl);
    return candidate;
  }
  const completed = completedHashes(posts, state);
  for (const post of queueOrder(posts)) {
    const candidate = publicationCandidate(post, site);
    if (!candidate || completed.has(candidate.key)) continue;
    try { await probeMedia(candidate, fetchImpl); return candidate; }
    catch (error) {
      if (!(error instanceof PublishingError)) throw error;
      log({ mode: 'media-skipped', account: TARGET_ACCOUNT, postId: post.id, reason: error.code });
    }
  }
  return null;
}

async function waitForContainer(graph, containerId, sleep) {
  // Meta recommends polling once per minute for at most five minutes.
  for (let attempt = 0; attempt <= 5; attempt += 1) {
    const status = await graph.containerStatus(containerId);
    if (status === 'FINISHED' || status === 'PUBLISHED') return status;
    if (status === 'ERROR' || status === 'EXPIRED') throw new PublishingError(`CONTAINER_${status}`);
    if (status !== 'IN_PROGRESS') throw new PublishingError('UNKNOWN_CONTAINER_STATUS');
    if (attempt < 5) await sleep(60_000);
  }
  throw new PublishingError('CONTAINER_PROCESSING_TIMEOUT');
}

async function ensureQuota(graph) {
  const { used, maximum } = await graph.quota();
  if (!Number.isInteger(used) || used < 0 || !Number.isInteger(maximum) || maximum < 1) {
    throw new PublishingError('INVALID_PUBLISHING_QUOTA');
  }
  return used < maximum;
}

/** Runs at most one publication; all mutation checkpoints are durably saved first. */
export async function runPublisher({ posts, siteUrl, publish = false, graph, store,
  fetchImpl = fetch, sleep = delay, now = Date.now, owner = randomUUID(), log = () => {} }) {
  if (!Array.isArray(posts) || posts.length > 20_000) throw new PublishingError('INVALID_SITE_FEED');
  const site = publicSiteUrl(siteUrl);
  let state = validateState(await store.load());
  if (!publish) {
    const candidate = await availableCandidate(posts, state, site, fetchImpl, log);
    log({ mode: 'dry-run', account: TARGET_ACCOUNT, postId: candidate?.post.id || null, kind: candidate?.kind || null });
    return { published: false, candidateId: candidate?.post.id || null };
  }
  if (!graph) throw new PublishingError('MISSING_INSTAGRAM_CONFIGURATION');
  await graph.verifyAccount();
  state = validateState(await store.load({ create: true }));
  if (state.lease && Date.parse(state.lease.expiresAt) > now() && state.lease.owner !== owner) {
    throw new PublishingError('PUBLISHING_LOCK_ACTIVE');
  }
  state.lease = { owner, expiresAt: new Date(now() + LEASE_MS).toISOString() };
  await store.save(state);

  const checkpoint = async () => {
    if (state.lease?.owner !== owner || Date.parse(state.lease.expiresAt) <= now()) throw new PublishingError('PUBLISHING_LOCK_EXPIRED');
    state.lease.expiresAt = new Date(now() + LEASE_MS).toISOString();
    await store.save(validateState(state));
  };
  const finish = async (mediaId) => {
    state.published.push({ contentHash: state.pending.contentHash, postId: state.pending.postId, mediaId, publishedAt: new Date(now()).toISOString() });
    state.pending = null;
    await checkpoint();
  };

  try {
    // A timed-out publish request may already have succeeded. Never resend it blindly.
    if (state.pending?.stage === 'publishing') {
      const status = await graph.containerStatus(state.pending.containerId);
      if (status !== 'PUBLISHED') throw new PublishingError('PUBLISHING_RESULT_UNCERTAIN');
      await finish(null);
      log({ mode: 'recovered', account: TARGET_ACCOUNT });
      return { published: false, recovered: true };
    }
    const candidate = await availableCandidate(posts, state, site, fetchImpl, log);
    if (!candidate) {
      if (state.pending) throw new PublishingError('PENDING_CONTENT_MISSING_FROM_FEED');
      log({ mode: 'empty', account: TARGET_ACCOUNT });
      return { published: false, candidateId: null };
    }
    if (!await ensureQuota(graph)) {
      log({ mode: 'quota-wait', account: TARGET_ACCOUNT });
      return { published: false, quotaWait: true };
    }
    if (!state.pending) {
      state.pending = { contentHash: candidate.key, postId: candidate.post.id, containerId: null, stage: 'reserved', createdAt: new Date(now()).toISOString() };
      await checkpoint();
    }
    if (state.pending.containerId === null) {
      const id = await graph.createContainer(candidate, makeCaption(candidate.post, site));
      if (!validMediaId(id) || id === null) throw new PublishingError('INVALID_CONTAINER_ID');
      state.pending.containerId = id;
      state.pending.stage = 'processing';
      await checkpoint();
    }
    let status;
    try { status = await waitForContainer(graph, state.pending.containerId, sleep); }
    catch (error) {
      if (!(error instanceof PublishingError) || error.code !== 'CONTAINER_EXPIRED' || state.pending.stage !== 'processing') throw error;
      // An expired, never-published container can be replaced safely, once per run.
      state.pending.containerId = null;
      state.pending.stage = 'reserved';
      await checkpoint();
      await probeMedia(candidate, fetchImpl);
      const replacement = await graph.createContainer(candidate, makeCaption(candidate.post, site));
      if (!validMediaId(replacement) || replacement === null) throw new PublishingError('INVALID_CONTAINER_ID');
      state.pending.containerId = replacement;
      state.pending.stage = 'processing';
      await checkpoint();
      status = await waitForContainer(graph, replacement, sleep);
    }
    if (status === 'PUBLISHED') {
      await finish(null);
      return { published: false, recovered: true };
    }
    if (!await ensureQuota(graph)) {
      log({ mode: 'quota-wait', account: TARGET_ACCOUNT });
      return { published: false, quotaWait: true };
    }
    await graph.verifyAccount();
    state.pending.stage = 'publishing';
    await checkpoint();
    const mediaId = await graph.publishContainer(state.pending.containerId);
    if (!validMediaId(mediaId) || mediaId === null) throw new PublishingError('INVALID_PUBLISHED_MEDIA_ID');
    await finish(mediaId);
    log({ mode: 'published', account: TARGET_ACCOUNT, postId: candidate.post.id });
    return { published: true, candidateId: candidate.post.id };
  } finally {
    state.lease = null;
    try { await store.save(validateState(state)); }
    catch { log({ mode: 'lease-release-pending', account: TARGET_ACCOUNT }); }
  }
}

/** Drain an authorized backlog with the same quota checks, lease and durable checkpoints. */
export async function runPublishingQueue(options, { maximum = 100, budgetMs = 45 * 60_000, clock = Date.now } = {}) {
  if (!options.publish || !Number.isInteger(maximum) || maximum < 1 || maximum > 100 || !Number.isFinite(budgetMs) || budgetMs < 1) {
    throw new PublishingError('INVALID_PUBLISHING_QUEUE_CONFIGURATION');
  }
  const started = clock(); let published = 0; let recovered = 0;
  const finish = (mode, reason) => {
    const result = { mode, account: TARGET_ACCOUNT, published, recovered, ...(reason && { reason }) };
    options.log?.(result);
    return result;
  };
  for (let attempt = 0; attempt < maximum; attempt += 1) {
    if (clock() - started >= budgetMs) return finish('queue-paused', 'time-budget');
    const result = await runPublisher(options);
    if (result.published) published += 1;
    else if (result.recovered) recovered += 1;
    else return finish(result.quotaWait ? 'queue-paused' : 'queue-complete', result.quotaWait ? 'quota' : null);
  }
  return finish('queue-paused', 'execution-limit');
}
