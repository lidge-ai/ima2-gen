import { defineConfig } from 'astro/config';

// GitHub Pages base path. Repo: lidge-ai/ima2-gen → /ima2-gen/
// If a custom domain (CNAME) is added, switch base to '/'.
export default defineConfig({
  site: 'https://lidge-ai.github.io',
  base: '/ima2-gen/',
  trailingSlash: 'never',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ko'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
