import type { APIRoute } from 'astro';
import { posts, postUrl } from '../lib/content';

export const prerender = true;

export const GET: APIRoute = () => {
  const feed = posts.map((post) => ({
    id: post.id,
    title: post.title,
    excerpt: post.excerpt,
    category: post.category,
    kind: post.kind,
    source: post.source,
    sourceName: post.sourceName,
    sourceUrl: post.sourceUrl,
    permalink: post.permalink,
    publishedAt: post.publishedAt,
    observedAt: post.observedAt,
    contentGroupId: post.contentGroupId,
    imageUrl: post.imageUrl,
    instagramImageUrl: post.instagramImageUrl,
    mediaUrl: post.mediaUrl,
    downloadUrl: post.downloadUrl,
    url: postUrl(post.id),
    ...(post.publicationCaption ? { publicationCaption: post.publicationCaption, publicationHashtags: post.publicationHashtags, mentionProfiles: post.mentionProfiles, reviewApprovedAt: post.reviewApprovedAt } : {}),
  }));

  return new Response(JSON.stringify(feed), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
