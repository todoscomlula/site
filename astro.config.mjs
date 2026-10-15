import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://todos-com-lula.vercel.app',
  output: 'static',
  adapter: vercel({ maxDuration: 60, excludeFiles: ['./public/media/**', './.cache/**', './.agents/**'] }),
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'never' },
});
