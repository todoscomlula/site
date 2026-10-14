import test from 'node:test';
import assert from 'node:assert/strict';
import { contentKey, emptyState, makeCaption, publicationCandidate, publicSiteUrl, PublishingError, runPublisher, TARGET_ACCOUNT, validateState } from './instagram-publishing/core.mjs';
import { MetaClient } from './instagram-publishing/meta-client.mjs';
import { GithubStateStore, LocalReadOnlyState } from './instagram-publishing/state-store.mjs';
import { scanPublicState } from './instagram-publishing/secret-scan.mjs';

const siteUrl = 'https://example.com';
const site = publicSiteUrl(siteUrl);
const owner = '00000000-0000-4000-8000-000000000001';
const instant = Date.parse('2026-10-14T15:00:00.000Z');
const clone = (value) => structuredClone(value);
const post = (changes = {}) => ({ id: 'sample-card', title: 'Informação com fonte', excerpt: 'Consulte a referência original.', kind: 'card',
  source: 'editorial', sourceName: 'Fonte original', sourceUrl: 'https://example.org/source/',
  permalink: '', downloadUrl: '/cards/sample-card.png', imageUrl: '/cards/sample-card.webp', ...changes });
const mediaResponse = (url) => new Response(null, { headers: { 'Content-Type': String(url).endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', 'Content-Length': '1234' } });

function fixture({ state = emptyState(), posts = [post()], statuses = ['FINISHED'], quota = { used: 0, maximum: 50 }, failSave, publishError } = {}) {
  const saved = []; const calls = []; const logs = []; const sleeps = [];
  let remote = clone(state); let statusIndex = 0;
  const store = {
    async load() { return clone(remote); },
    async save(value) {
      if (failSave?.(value)) throw new PublishingError('TEST_DURABLE_WRITE_FAILED');
      remote = clone(validateState(value)); saved.push(clone(value));
    },
  };
  const graph = {
    async verifyAccount() { calls.push('identity'); },
    async quota() { calls.push('quota'); return quota; },
    async createContainer(candidate, caption) {
      calls.push('create'); assert.equal(remote.pending.stage, 'reserved');
      assert.equal(remote.pending.containerId, null); assert.ok(remote.lease);
      assert.match(caption, /Fonte:/); return '111111';
    },
    async containerStatus() { calls.push('status'); return statuses[Math.min(statusIndex++, statuses.length - 1)]; },
    async publishContainer() {
      calls.push('publish'); assert.equal(remote.pending.stage, 'publishing');
      assert.equal(remote.pending.containerId, '111111'); assert.ok(remote.lease);
      if (publishError) throw publishError;
      return '222222';
    },
  };
  const options = { posts, siteUrl, publish: true, graph, store, owner, now: () => instant,
    fetchImpl: async (url) => mediaResponse(url), sleep: async (ms) => sleeps.push(ms), log: (event) => logs.push(event) };
  return { options, store, graph, saved, calls, logs, sleeps, state: () => clone(remote) };
}

test('dry-run probes public JPEG without touching Meta or writing state', async () => {
  const fixtureData = fixture();
  const result = await runPublisher({ ...fixtureData.options, publish: false, graph: null });
  assert.deepEqual(result, { published: false, candidateId: 'sample-card' });
  assert.equal(fixtureData.saved.length, 0); assert.equal(fixtureData.calls.length, 0);
});

test('image publishing uses the generated public JPEG, not PNG or WebP', () => {
  const candidate = publicationCandidate(post(), site);
  assert.equal(candidate.kind, 'IMAGE'); assert.equal(candidate.mediaUrl, 'https://example.com/cards/sample-card.jpg');
});

test('complete mirrored MP4 becomes a Reel without trimming or source CDN URLs', () => {
  const candidate = publicationCandidate(post({ kind: 'video', mediaUrl: '/media/instagram/source/complete-video.mp4' }), site);
  assert.equal(candidate.kind, 'REELS'); assert.equal(candidate.mediaUrl, 'https://example.com/media/instagram/source/complete-video.mp4');
});

test('self-account content is excluded even with capitalization or @ prefix', () => {
  assert.equal(publicationCandidate(post({ source: '@BORAAALULA2026' }), site), null);
});

test('stable confirmed clip groups deduplicate different imports and original URLs', () => {
  const left = post({ id: 'first-source', contentGroupId: 'oldest-representative', permalink: 'https://www.instagram.com/reel/one/' });
  const right = post({ id: 'second-source', contentGroupId: 'oldest-representative', permalink: 'https://www.instagram.com/reel/two/' });
  assert.equal(contentKey(left), contentKey(right));
  assert.notEqual(contentKey(left), contentKey(post({ ...right, contentGroupId: 'another-distinct-video' })));
  assert.equal(contentKey(post({ contentGroupId: 'invalid group id' })), contentKey(post()));
});

test('confirmed groups already present in the target profile are excluded across sources', async () => {
  const data = fixture({ posts: [post({ id: 'own-original', source: TARGET_ACCOUNT, contentGroupId: 'existing-clip' }),
    post({ id: 'other-repost', source: 'another-profile', contentGroupId: 'existing-clip' }), post({ id: 'new-distinct-clip', contentGroupId: 'new-clip' })] });
  assert.equal((await runPublisher(data.options)).candidateId, 'new-distinct-clip');
});

test('matching captions without confirmed clip groups do not imply a duplicate', async () => {
  const data = fixture({ posts: [post({ id: 'own-original', source: TARGET_ACCOUNT }), post({ id: 'different-video' })] });
  assert.equal((await runPublisher(data.options)).candidateId, 'different-video');
});

test('expired, signed, private, offsite and carousel media are not eligible', () => {
  for (const mediaUrl of ['https://cdn.example.net/photo.jpg', '/cards/photo.jpg?access_token=placeholder', 'http://example.com/cards/photo.jpg', 'https://user:placeholder@example.com/cards/photo.jpg']) {
    assert.equal(publicationCandidate(post({ downloadUrl: mediaUrl }), site), null);
  }
  assert.equal(publicationCandidate(post({ kind: 'carousel' }), site), null);
  assert.throws(() => publicSiteUrl('https://127.0.0.1'), { code: 'INVALID_PUBLIC_SITE_URL' });
});

test('missing JPEG sibling of an imported WebP is skipped without blocking the next entry', async () => {
  const data = fixture({ posts: [post({ id: 'webp-image', kind: 'image', source: 'another-profile', downloadUrl: '/media/instagram/another/image.webp' }), post()] });
  data.options.fetchImpl = async (url) => String(url).includes('/another/') ? new Response(null, { status: 404 }) : mediaResponse(url);
  const result = await runPublisher(data.options);
  assert.equal(result.candidateId, 'sample-card');
  assert.equal(data.calls.filter((event) => event === 'publish').length, 1);
  assert.equal(data.logs[0].mode, 'media-skipped');
});

test('exactly one item is published and durable checkpoints precede both mutations', async () => {
  const data = fixture({ posts: [post(), post({ id: 'second-card' })] });
  const result = await runPublisher(data.options);
  assert.equal(result.published, true);
  assert.equal(data.calls.filter((event) => event === 'create').length, 1);
  assert.equal(data.calls.filter((event) => event === 'publish').length, 1);
  assert.equal(data.state().pending, null); assert.equal(data.state().lease, null);
  assert.equal(data.state().published.length, 1);
  assert.equal(data.state().published[0].mediaId, '222222');
});

test('oldest observed arrivals are processed first without changing publication dates', async () => {
  const data = fixture({ posts: [post({ id: 'new', observedAt: '2026-10-14T14:00:00Z', publishedAt: null }), post({ id: 'old', observedAt: '2026-10-13T14:00:00Z', publishedAt: null })] });
  assert.equal((await runPublisher(data.options)).candidateId, 'old');
  assert.equal(data.options.posts[1].publishedAt, null);
});

test('published records deduplicate changed identifiers for the same original permalink', async () => {
  const first = post({ permalink: 'https://www.instagram.com/p/example/?tracking=one' });
  const state = emptyState();
  state.published.push({ contentHash: contentKey(first), postId: first.id, mediaId: '222222', publishedAt: new Date(instant).toISOString() });
  const second = post({ id: 'different-import-id', permalink: 'https://www.instagram.com/p/example/?tracking=two' });
  const data = fixture({ state, posts: [second] });
  assert.equal((await runPublisher(data.options)).published, false);
  assert.equal(data.calls.includes('publish'), false); assert.equal(data.calls.includes('create'), false);
});

test('a active lease owned by another execution prevents creating any container', async () => {
  const state = emptyState(); state.lease = { owner: '00000000-0000-4000-8000-000000000002', expiresAt: new Date(instant + 60_000).toISOString() };
  const data = fixture({ state });
  await assert.rejects(runPublisher(data.options), { code: 'PUBLISHING_LOCK_ACTIVE' });
  assert.equal(data.saved.length, 0); assert.equal(data.calls.includes('create'), false);
});

test('the quota returned by Meta pauses the queue without reserving new content', async () => {
  const data = fixture({ quota: { used: 50, maximum: 50 } });
  assert.equal((await runPublisher(data.options)).quotaWait, true);
  assert.equal(data.state().pending, null); assert.equal(data.calls.includes('create'), false);
});

test('processing is polled at one-minute intervals before publication', async () => {
  const data = fixture({ statuses: ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'] });
  await runPublisher(data.options);
  assert.deepEqual(data.sleeps, [60_000, 60_000]);
  assert.equal(data.calls.filter((event) => event === 'publish').length, 1);
});

test('processing timeout preserves the reusable container and never publishes', async () => {
  const data = fixture({ statuses: ['IN_PROGRESS'] });
  await assert.rejects(runPublisher(data.options), { code: 'CONTAINER_PROCESSING_TIMEOUT' });
  assert.equal(data.state().pending.stage, 'processing');
  assert.equal(data.state().pending.containerId, '111111');
  assert.equal(data.calls.includes('publish'), false);
});

test('existing processing container is resumed without another creation', async () => {
  const state = emptyState(); state.pending = { contentHash: contentKey(post()), postId: 'sample-card', containerId: '111111', stage: 'processing', createdAt: new Date(instant).toISOString() };
  const data = fixture({ state });
  await runPublisher(data.options);
  assert.equal(data.calls.includes('create'), false); assert.equal(data.calls.includes('publish'), true);
});

test('expired processing container is replaced once, with a saved reservation first', async () => {
  const state = emptyState(); state.pending = { contentHash: contentKey(post()), postId: 'sample-card', containerId: '999999', stage: 'processing', createdAt: new Date(instant - 86_400_000).toISOString() };
  const data = fixture({ state, statuses: ['EXPIRED', 'FINISHED'] });
  await runPublisher(data.options);
  assert.equal(data.calls.filter((event) => event === 'create').length, 1);
  assert.equal(data.calls.filter((event) => event === 'publish').length, 1);
});

test('a replacement that expires immediately is not recreated repeatedly in one run', async () => {
  const state = emptyState(); state.pending = { contentHash: contentKey(post()), postId: 'sample-card', containerId: '999999', stage: 'processing', createdAt: new Date(instant).toISOString() };
  const data = fixture({ state, statuses: ['EXPIRED'] });
  await assert.rejects(runPublisher(data.options), { code: 'CONTAINER_EXPIRED' });
  assert.equal(data.calls.filter((event) => event === 'create').length, 1);
  assert.equal(data.calls.includes('publish'), false);
});

test('an interrupted publishing request is never sent again blindly', async () => {
  const data = fixture({ publishError: new PublishingError('META_REQUEST_INTERRUPTED') });
  await assert.rejects(runPublisher(data.options), { code: 'META_REQUEST_INTERRUPTED' });
  assert.equal(data.state().pending.stage, 'publishing');
  await assert.rejects(runPublisher(data.options), { code: 'PUBLISHING_RESULT_UNCERTAIN' });
  assert.equal(data.calls.filter((event) => event === 'publish').length, 1);
});

test('PUBLISHED status resolves an uncertain result without publishing the next item', async () => {
  const state = emptyState(); state.pending = { contentHash: contentKey(post()), postId: 'sample-card', containerId: '111111', stage: 'publishing', createdAt: new Date(instant).toISOString() };
  const data = fixture({ state, posts: [post(), post({ id: 'second-card' })], statuses: ['PUBLISHED'] });
  const result = await runPublisher(data.options);
  assert.equal(result.recovered, true); assert.equal(data.state().pending, null);
  assert.equal(data.state().published[0].mediaId, null); assert.equal(data.calls.includes('publish'), false);
});

test('failure to persist the publishing checkpoint prevents the external write', async () => {
  const data = fixture({ failSave: (state) => state.pending?.stage === 'publishing' });
  await assert.rejects(runPublisher(data.options), { code: 'TEST_DURABLE_WRITE_FAILED' });
  assert.equal(data.calls.includes('publish'), false); assert.equal(data.state().pending.stage, 'processing');
});

test('state rejects credentials and unexpected properties at any persisted level', () => {
  assert.throws(() => validateState({ ...emptyState(), access_token: 'PLACEHOLDER' }), { code: 'INVALID_PUBLIC_STATE' });
  const state = emptyState(); state.pending = { contentHash: contentKey(post()), postId: 'sample-card', containerId: null, stage: 'reserved', createdAt: new Date(instant).toISOString(), token: 'PLACEHOLDER' };
  assert.throws(() => validateState(state), { code: 'INVALID_PUBLIC_STATE' });
});

test('caption preserves attribution within 2200 code points and avoids automatic mentions', () => {
  const value = makeCaption(post({ title: 'á'.repeat(3000), excerpt: '@someone ' + '😀'.repeat(3000), sourceName: '@source' }), site);
  assert.ok(Array.from(value).length <= 2200); assert.match(value, /Fonte: ＠source/);
  assert.match(value, /https:\/\/example\.org\/source\//); assert.equal(value.includes('@someone'), false);
});

test('wrong API username fails before any state mutation or content write', async () => {
  const graph = new MetaClient({ accessToken: 'PLACEHOLDER_FOR_OFFLINE_TEST', userId: '123456', fetchImpl: async () => Response.json({ username: 'different-account' }) });
  const data = fixture();
  await assert.rejects(runPublisher({ ...data.options, graph }), { code: 'WRONG_INSTAGRAM_ACCOUNT' });
  assert.equal(data.saved.length, 0);
});

test('Meta uses Bearer headers, permanent full video URLs and no token query parameters', async () => {
  const requests = [];
  const graph = new MetaClient({ accessToken: 'PLACEHOLDER_FOR_OFFLINE_TEST', userId: '123456', fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options }); return Response.json({ id: '111111' });
  } });
  const candidate = publicationCandidate(post({ kind: 'video', mediaUrl: '/media/instagram/source/full.mp4' }), site);
  await graph.createContainer(candidate, 'Legenda com fonte');
  const request = requests[0]; const payload = JSON.parse(request.options.body);
  assert.equal(request.options.headers.Authorization, 'Bearer PLACEHOLDER_FOR_OFFLINE_TEST');
  assert.equal(request.url.includes('access_token'), false); assert.equal('access_token' in payload, false);
  assert.equal(payload.video_url, candidate.mediaUrl); assert.equal(payload.media_type, 'REELS');
  assert.equal(payload.share_to_feed, true);
});

test('provider errors cannot echo token values in exported errors', async () => {
  const placeholder = 'PLACEHOLDER_FOR_OFFLINE_TEST';
  const graph = new MetaClient({ accessToken: placeholder, userId: '123456', fetchImpl: async () => Response.json({ error: { message: `Echo ${placeholder}`, code: 190 } }, { status: 400 }) });
  let caught; try { await graph.verifyAccount(); } catch (error) { caught = error; }
  assert.equal(caught.code, 'META_REQUEST_FAILED'); assert.equal(caught.providerCode, 190);
  assert.equal(JSON.stringify(caught).includes(placeholder), false); assert.equal(caught.message.includes(placeholder), false);
});

test('GitHub state writes only whitelisted content and uses CAS on the dedicated branch', async () => {
  const requests = []; const scanned = []; const state = emptyState();
  const store = new GithubStateStore({ token: 'PLACEHOLDER_FOR_OFFLINE_TEST', scan: async (value) => scanned.push(value), fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === 'GET') return Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify(state)).toString('base64'), sha: 'initial-revision' });
    return Response.json({ content: { sha: 'next-revision' } });
  } });
  await store.load(); await store.save(state);
  const payload = JSON.parse(requests[1].options.body);
  assert.equal(payload.branch, 'instagram-publishing-state'); assert.equal(payload.sha, 'initial-revision');
  assert.deepEqual(JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8')), emptyState());
  assert.equal(scanned.length, 1); assert.equal(scanned[0].includes('PLACEHOLDER_FOR_OFFLINE_TEST'), false);
});

test('GitHub CAS conflict is surfaced safely and does not overwrite newer state', async () => {
  const store = new GithubStateStore({ token: 'PLACEHOLDER_FOR_OFFLINE_TEST', scan: async () => {}, fetchImpl: async (url, options) => options.method === 'GET'
    ? Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify(emptyState())).toString('base64'), sha: 'old-revision' })
    : Response.json({ message: 'Never expose this raw provider message' }, { status: 409 }) });
  await store.load(); await assert.rejects(store.save(emptyState()), { code: 'GITHUB_STATE_CONFLICT' });
});

test('failed state secret scan prevents GitHub commits', async () => {
  let writes = 0;
  const store = new GithubStateStore({ token: 'PLACEHOLDER_FOR_OFFLINE_TEST', scan: async () => { throw new PublishingError('PUBLIC_STATE_SECRET_SCAN_FAILED'); }, fetchImpl: async (url, options) => {
    if (options.method !== 'GET') writes += 1;
    return Response.json({ encoding: 'base64', content: Buffer.from(JSON.stringify(emptyState())).toString('base64'), sha: 'revision' });
  } });
  await store.load(); await assert.rejects(store.save(emptyState()), { code: 'PUBLIC_STATE_SECRET_SCAN_FAILED' });
  assert.equal(writes, 0);
});

test('an empty local state supports credential-free simulation and forbids publishing writes', async () => {
  const store = new LocalReadOnlyState('/path/that/does/not/exist/state.json');
  assert.deepEqual(await store.load(), emptyState());
  await assert.rejects(store.save(emptyState()), { code: 'LOCAL_STATE_IS_READ_ONLY' });
});

test('sanitized publication state passes the actual project Gitleaks check', { skip: process.env.GITHUB_ACTIONS === 'true' }, async () => {
  const state = emptyState();
  state.published.push({ contentHash: contentKey(post()), postId: 'sample-card', mediaId: '222222', publishedAt: new Date(instant).toISOString() });
  await scanPublicState(JSON.stringify(validateState(state)));
});
