import editorial from '../data/editorial.json';
import instagram from '../data/instagram-posts.json';
import sources from '../data/sources.json';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function publicationImages(): Record<string, string> {
  try {
    const map = JSON.parse(readFileSync(resolve('public/instagram-publication-assets.json'), 'utf8'));
    return map.version === 1 && typeof map.assets === 'object' && map.assets ? map.assets : {};
  } catch {
    return {};
  }
}
const instagramImages = publicationImages();

export const topics = [
  { id: 'saude', name: 'Saúde', icon: 'heart' },
  { id: 'educacao', name: 'Educação', icon: 'book' },
  { id: 'renda', name: 'Renda e proteção social', icon: 'hand' },
  { id: 'moradia', name: 'Moradia', icon: 'home' },
  { id: 'meio-ambiente', name: 'Meio ambiente', icon: 'leaf' },
  { id: 'economia', name: 'Economia e transparência', icon: 'chart' },
];

export interface Post {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  kind: 'card' | 'image' | 'video' | 'carousel';
  source: string;
  sourceName: string;
  sourceUrl: string;
  permalink: string | null;
  publishedAt: string | null;
  observedAt: string | null;
  contentGroupId: string | null;
  imageUrl: string;
  instagramImageUrl: string | null;
  mediaUrl: string | null;
  downloadUrl: string | null;
  paragraphs: string[];
  origin: 'editorial' | 'instagram';
  publicationCaption?: string;
  publicationHashtags?: string[];
  mentionProfiles?: string[];
  reviewApprovedAt?: string;
}

export const sourceProfiles = sources;
const storiesigFiles = import.meta.glob('../data/storiesig-posts.json', { eager: true, import: 'default' });
const storiesig = (Object.values(storiesigFiles)[0] || []) as Array<Record<string, any>>;
const observedTime = (post: Record<string, any>) => {
  const timestamp = Date.parse(post.observedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
};
const imported = [...(instagram as Array<Record<string, any>>), ...storiesig]
  .sort((a, b) => observedTime(b) - observedTime(a));
export const posts: Post[] = [
  ...imported.map((post): Post => ({
    id: String(post.id),
    title: post.title || `Publicação de @${post.source}`,
    excerpt: post.excerpt || '',
    category: post.tags?.find((tag: string) => topics.some((topic) => topic.id === tag)) || 'publicacoes',
    kind: post.kind || 'image',
    source: post.source,
    sourceName: sources.find((source) => source.username === post.source)?.name || `@${post.source}`,
    sourceUrl: post.sourceUrl || post.permalink || `https://www.instagram.com/${post.source}/`,
    permalink: post.permalink || null,
    publishedAt: post.publishedAt || null,
    observedAt: post.observedAt || null,
    contentGroupId: typeof post.contentGroupId === 'string' ? post.contentGroupId : null,
    imageUrl: post.thumbnailUrl || (post.kind !== 'video' ? post.mediaUrl : '') || '/images/lula-hero.webp',
    instagramImageUrl: instagramImages[post.id] || post.instagramImageUrl || null,
    mediaUrl: post.mediaUrl || null,
    downloadUrl: post.downloadUrl || null,
    paragraphs: post.excerpt ? [post.excerpt] : [],
    origin: 'instagram',
    ...(typeof post.publicationCaption === 'string' ? { publicationCaption: post.publicationCaption, publicationHashtags: post.publicationHashtags, mentionProfiles: post.mentionProfiles, reviewApprovedAt: post.reviewApprovedAt } : {}),
  })),
  ...(editorial as Array<Record<string, any>>).map((post): Post => ({
    id: post.id,
    title: post.title,
    excerpt: post.excerpt,
    category: post.category,
    kind: 'card',
    source: 'editorial',
    sourceName: post.sourceName,
    sourceUrl: post.sourceUrl,
    permalink: '',
    publishedAt: post.publishedAt,
    observedAt: null,
    contentGroupId: null,
    imageUrl: post.imageUrl,
    instagramImageUrl: instagramImages[post.id] || null,
    mediaUrl: null,
    downloadUrl: post.downloadUrl,
    paragraphs: post.paragraphs,
    origin: 'editorial',
  })),
];

export const cards = posts.filter((post) => post.kind !== 'video');
export const videos = posts.filter((post) => post.kind === 'video');
export const editorialPosts = posts.filter((post) => post.origin === 'editorial');
export const topicName = (id: string) => topics.find((topic) => topic.id === id)?.name || 'Nas redes';
export const postUrl = (id: string) => `/conteudo/${encodeURIComponent(id)}/`;
export const formatDate = (date: string | null) => date
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'America/Sao_Paulo' }).format(new Date(date))
  : 'Conheça o programa';
