#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { API_VERSION, PublishingError, publicSiteUrl, runPublisher } from './instagram-publishing/core.mjs';
import { MetaClient } from './instagram-publishing/meta-client.mjs';
import { GithubStateStore, LocalReadOnlyState } from './instagram-publishing/state-store.mjs';

export async function main(args = process.argv.slice(2), env = process.env) {
  const flags = new Set(args);
  if (args.some((arg) => !['--publish', '--dry-run'].includes(arg)) || (flags.has('--publish') && flags.has('--dry-run'))) {
    throw new PublishingError('USE_DRY_RUN_OR_PUBLISH');
  }
  const publish = flags.has('--publish');
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
  const store = remoteState
    ? new GithubStateStore({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY })
    : new LocalReadOnlyState();
  const graph = publish ? new MetaClient({ accessToken: env.INSTAGRAM_ACCESS_TOKEN, userId: env.INSTAGRAM_USER_ID, version: env.INSTAGRAM_API_VERSION || API_VERSION }) : null;

  return runPublisher({ posts: feed, siteUrl: site.href, publish, graph, store,
    log: (event) => console.log(JSON.stringify(event)),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safe = error instanceof PublishingError ? error : new PublishingError('UNEXPECTED_PUBLISHING_FAILURE');
    console.error(JSON.stringify({ error: safe.code, status: safe.status, providerCode: safe.providerCode }));
    process.exitCode = 1;
  });
}
