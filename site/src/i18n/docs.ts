// Developer-docs navigation model + UI strings.
// Kept separate from strings.ts (marketing copy) so each file stays focused and
// well under the 500-line limit. Page prose lives inline in each .astro page;
// this module only describes the sidebar structure and shell chrome.

import type { Lang } from './strings';

export type { Lang };

export interface DocsNavLink {
  /** Internal docs page slug relative to the docs root. '' = Overview. */
  slug?: string;
  /** Site-internal non-docs path relative to the language base (e.g. 'faq'). */
  site?: string;
  /** Fully-qualified external URL (opens in a new tab). */
  external?: string;
  en: string;
  ko: string;
}

export interface DocsNavSection {
  en: string;
  ko: string;
  links: DocsNavLink[];
}

export const DOCS_NAV: DocsNavSection[] = [
  {
    en: 'Getting Started',
    ko: '시작하기',
    links: [
      { slug: '', en: 'Overview', ko: '개요' },
      { slug: 'quickstart', en: 'Quickstart', ko: '빠른 시작' },
      { slug: 'desktop', en: 'Desktop App', ko: '데스크톱 앱' },
    ],
  },
  {
    en: 'Concepts',
    ko: '핵심 개념',
    links: [
      { slug: 'concepts/architecture', en: 'Architecture', ko: '아키텍처' },
      { slug: 'concepts/modes', en: 'Generation Modes', ko: '생성 모드' },
      { slug: 'concepts/providers', en: 'Providers & Models', ko: '프로바이더 & 모델' },
    ],
  },
  {
    en: 'Reference',
    ko: '레퍼런스',
    links: [
      { slug: 'reference/cli', en: 'CLI Commands', ko: 'CLI 명령어' },
      { slug: 'reference/config', en: 'Configuration', ko: '설정' },
      { slug: 'reference/api', en: 'Server API', ko: '서버 API' },
    ],
  },
  {
    en: 'Resources',
    ko: '리소스',
    links: [
      {
        external: 'https://github.com/lidge-ai/ima2-gen/blob/main/docs/API.md',
        en: 'Full API Contract',
        ko: '전체 API 계약',
      },
      {
        external: 'https://github.com/lidge-ai/ima2-gen/blob/main/docs/CLI.md',
        en: 'Full CLI Contract',
        ko: '전체 CLI 계약',
      },
      {
        external: 'https://github.com/lidge-ai/ima2-gen/blob/main/docs/PROMPT_STUDIO.md',
        en: 'Prompt Studio Manual',
        ko: 'Prompt Studio 매뉴얼',
      },
      { site: 'faq', en: 'FAQ', ko: 'FAQ' },
      { external: 'https://github.com/lidge-ai/ima2-gen/releases', en: 'Releases', ko: '릴리스' },
    ],
  },
];

const DOCS_UI: Record<Lang, Record<string, string>> = {
  en: {
    'brand.tag': 'docs',
    'search.placeholder': 'Search docs…',
    'search.empty': 'No matching pages',
    'nav.github': 'GitHub ↗',
    'nav.home': '← Back to site',
    'nav.toggle': 'Toggle navigation',
    'nav.aria': 'Documentation navigation',
    'meta.suffix': 'ima2-gen Docs',
  },
  ko: {
    'brand.tag': '문서',
    'search.placeholder': '문서 검색…',
    'search.empty': '일치하는 페이지가 없어요',
    'nav.github': 'GitHub ↗',
    'nav.home': '← 사이트로 돌아가기',
    'nav.toggle': '내비게이션 열기/닫기',
    'nav.aria': '문서 내비게이션',
    'meta.suffix': 'ima2-gen 문서',
  },
};

export function docsT(lang: Lang, key: string): string {
  return DOCS_UI[lang]?.[key] ?? DOCS_UI.en[key] ?? key;
}

/** Build an internal docs URL from a page slug. '' resolves to the docs root. */
export function docsPath(baseUrl: string, lang: Lang, slug: string): string {
  const base = baseUrl.replace(/\/$/, '');
  const root = lang === 'ko' ? `${base}/ko/docs` : `${base}/docs`;
  return slug ? `${root}/${slug}` : root;
}
