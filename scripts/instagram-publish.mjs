#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { API_VERSION, PublishingError, publicSiteUrl, runPublisher, runPublishingQueue } from './instagram-publishing/core.mjs';
import { MetaClient } from './instagram-publishing/meta-client.mjs';
import { GithubStateStore, LocalReadOnlyState } from './instagram-publishing/state-store.mjs';

export async function main(args = process.argv.slice(2), env = process.env) {
  const flags = new Set(args);
  if (args.some((arg) => !['--publish', '--publish-all', '--dry-run', '--check-connection'].includes(arg)) || flags.size > 1) {
    throw new PublishingError('USE_CHECK_CONNECTION_DRY_RUN_OR_PUBLISH');
  }
  if (flags.has('--check-connection')) {
    const graph = new MetaClient({ accessToken: env.INSTAGRAM_ACCESS_TOKEN, userId: env.INSTAGRAM_USER_ID, version: env.INSTAGRAM_API_VERSION || API_VERSION });
    const identity = await graph.verifyAccount();
    const quota = await graph.quota();
    if (!Number.isInteger(quota.used) || quota.used < 0 || !Number.isInteger(quota.maximum) || quota.maximum < 1) {
      throw new PublishingError('INVALID_PUBLISHING_QUOTA');
    }
    const result = { mode: 'connection-verified', account: identity.username, userId: identity.userId, quota };
    console.log(JSON.stringify(result));
    return result;
  }
  const publishAll = flags.has('--publish-all');
  const publish = flags.has('--publish') || publishAll;
  const site = publicSiteUrl(env.PUBLIC_SITE_URL);
  let feed;
  try {
    const response = await fetch(new URL('/feed.json', site), { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error();
    const text = await response.text();
    if (text.length > 10_000_000) throw new Error();
    feed = JSON.parse(text);
  } catch { throw new PublishingError('PUBLIC_FEED_UNAVAILABLE'); }

  const remoteState = env.INSTAGRAM_STATE_BACKEND === 'github';
  if (publish && !remoteState) throw new PublishingError('PUBLISH_REQUIRES_DURABLE_GITHUB_STATE');
  if (publish) {
    try {
      const { createBlobStore } = await import('../src/server/admin/blob.mjs');
      const { selectMentions } = await import('../src/server/admin/state.mjs');
      const state = await createBlobStore(env).load();
      feed = feed.map(post => typeof post.publicationCaption === 'string' ? post : {
        ...post,
        publicationMentionsRequired: true,
        mentionProfiles: selectMentions(state.sources, post),
      });
    } catch { throw new PublishingError('PUBLICATION_MENTIONS_UNAVAILABLE'); }
  }

  const store = remoteState
    ? new GithubStateStore({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY })
    : new LocalReadOnlyState();
  const graph = publish ? new MetaClient({ accessToken: env.INSTAGRAM_ACCESS_TOKEN, userId: env.INSTAGRAM_USER_ID, version: env.INSTAGRAM_API_VERSION || API_VERSION }) : null;

  const options = { posts: feed, siteUrl: site.href, publish, graph, store,
    log: (event) => console.log(JSON.stringify(event)),
  };
  return publishAll ? runPublishingQueue(options) : runPublisher(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safe = error instanceof PublishingError ? error : new PublishingError('UNEXPECTED_PUBLISHING_FAILURE');
    console.error(JSON.stringify({ error: safe.code, status: safe.status, providerCode: safe.providerCode }));
    process.exitCode = 1;
  });
}
