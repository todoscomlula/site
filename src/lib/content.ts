import editorial from '../data/editorial.json';
import instagram from '../data/instagram-posts.json';
import sources from '../data/sources.json';

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
  imageUrl: string;
  mediaUrl: string | null;
  downloadUrl: string | null;
  paragraphs: string[];
  origin: 'editorial' | 'instagram';
}

export const sourceProfiles = sources;
const storiesigFiles = import.meta.glob('../data/storiesig-posts.json', { eager: true, import: 'default' });
const storiesig = (Object.values(storiesigFiles)[0] || []) as Array<Record<string, any>>;
const imported = [...(instagram as Array<Record<string, any>>), ...storiesig];
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
    imageUrl: post.thumbnailUrl || (post.kind !== 'video' ? post.mediaUrl : '') || '/images/lula-hero.webp',
    mediaUrl: post.mediaUrl || null,
    downloadUrl: post.downloadUrl || null,
    paragraphs: post.excerpt ? [post.excerpt] : [],
    origin: 'instagram',
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
    imageUrl: post.imageUrl,
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
