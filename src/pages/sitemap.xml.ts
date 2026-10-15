import type { APIRoute } from 'astro';
import { posts, postUrl } from '../lib/content';

export const prerender = true;

const escapedCharacters: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => escapedCharacters[character]!);

export const GET: APIRoute = ({ site }) => {
  const base = site || import.meta.env.PUBLIC_SITE_URL || 'https://todos-com-lula.vercel.app';
  const routes = ['/', '/cards/', '/videos/', '/desmantelando/', '/fontes/', '/sobre/', '/privacidade/', '/creditos/'];
  const paths = [...new Set([...routes, ...posts.map((post) => postUrl(post.id))])];
  const urls = paths.map((path) => `<url><loc>${escapeXml(new URL(path, base).href)}</loc></url>`).join('');

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
