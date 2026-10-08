import { defineConfig } from 'astro/config';

// Served from the custom domain ima2gen.com (GitHub Pages CNAME), so the base is the root.
export default defineConfig({
  site: 'https://ima2gen.com',
  base: '/',
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
