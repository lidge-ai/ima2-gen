# 010 wp2 — README header, structure, screenshots, translations

## Outcome

GitHub shows, in order: a full-width monochrome banner, an h3 tagline, one line of centered badges, a two-line install block, Mac download badge, a two-column showcase (copy left, screenshot right), a centered language bar and a four-sentence intro. Reference material follows in collapsed sections. No generated table appears above the banner.

## Diff-level plan

### Banner (new)

- `assets/brand/banner.png` 2560x800, rendered from `devlog/_plan/260925_readme_release/scripts/banner.html` with headless Chromium at DPR 2 (1280x400 CSS). Background near-black (#0b0b0c) with a faint radial highlight and 1px grain-free vignette; left: `assets/brand/mark-chrome.png` at ~300px; right: wordmark "ima2" in Clash Display 700 with a vertical chrome gradient (#f5f5f7 → #8e8e93), subline "Local image & video studio for people and coding agents" in Satoshi 500, and a mono caption "GPT · Grok · Gemini · NovelAI · ComfyUI — on your machine". PNG quantized through sharp (palette off, compressionLevel 9) under 600 KB.
- Script: `scripts/render-banner.mjs` in the unit folder, uses the repo's Playwright/Chromium already used for UI e2e (`ui/node_modules/playwright` or `npx playwright`), fonts loaded via file URLs from `ui/public/fonts`.

### Screenshots (new, replace README references)

Isolated demo runtime so the user's gallery and sessions are untouched:

```
IMA2_CONFIG_DIR=/tmp/ima2-readme-demo IMA2_PORT=3401 IMA2_OAUTH_PROXY_PORT=10591 node bin/ima2.js serve
```

Demo content: 8-10 GPT OAuth images with neutral, product-grade prompts (chrome still life, architectural interior, ceramic product shot, landscape, fictional portrait, poster typography with Korean text, transparent-background object). No real people, brands or jokes. Captures at 1440x900 CSS, DPR 2, dark theme, saved as `assets/screenshots/readme-*.png`:

| File | Screen |
|---|---|
| readme-home.png | Home with recent work grid |
| readme-classic.png | Classic workspace with a finished result and history rail |
| readme-node.png | Node graph with a root and 2-3 branches |
| readme-canvas.png | Canvas Mode on a transparent result with checkerboard |
| readme-providers.png | Settings > Providers lane list |

Each PNG quantized under 450 KB. Old screenshots stay on disk (site and translations may reference them); the README stops referencing the retired ones.

### README.md structure

1. Banner `<p align=center><img src="assets/brand/banner.png" width="100%">`.
2. `<h3 align=center>` tagline + one-sentence subline.
3. Badges (centered, flat, monochrome palette): npm version, npm downloads, node engine, license, GitHub stars, X follow @claudeebum is OpenCodex-only — skip.
4. Install block: `npm install -g ima2-gen` / `ima2 serve`.
5. Download badge row: "macOS · Apple Silicon .dmg" → desktop releases query; "One-line installer" → Quick Start anchor.
6. Showcase `<table>` 4 rows: Classic, Node, Canvas, Agent-ready CLI/skills (row 4 uses readme-providers or a terminal snippet).
7. Centered language bar + docs site link.
8. Intro paragraph (what it is, providers, local-first).
9. `## Quick start`: Mac app, npm, first image from CLI; Docker / one-click installers / setup / updating inside `<details>`.
10. `## What you can do`: feature list tightened (one line each), agent skills.
11. `## Providers and models`: compact lane table (lane, auth, image, video, notes); long per-provider notes inside `<details>`.
12. `## CLI`, `## Configuration` (env table inside `<details>`), `## Troubleshooting` (each Q as `<details>`), `## Development` with a `### Requirements` subsection that now holds the runtime-install generated block, desktop build notes in `<details>`.
13. Contributors, License.

Every string asserted by tests must survive; B greps these before and after: prompt-studio-docs-contract, studio-surface-docs-contract, model-default-projection-contract, prompt-discovery-contract, cli-feature-parity-contract, runtime-install-projection, package-smoke, comfyui-custom-node-contract, prompt-import-folder-contract.

### Translations

`docs/README.{ko,ja,zh-CN,zh-TW}.md`: same header (banner path `../assets/brand/banner.png`, localized tagline), same section order, generated block moved to the Requirements subsection, retired screenshots swapped for the new ones. Body text keeps the existing translated facts, reorganized into the same collapsed sections.

## Verification

- `node --import tsx --test` on the README-reading tests above; `npm run docs:runtime:check`; `npm run typecheck`; `node devlog/_plan/260925_brand_refresh/scripts/check-readme-links.mjs` over all five READMEs.
- GFM render: render README.md through GitHub's markdown API (`gh api markdown -f mode=gfm`) into an HTML page with GitHub CSS, screenshot top 2 viewports light and dark, read back.
- DeepSeek diff review at C.
- PR to dev with screenshot evidence uploaded to `pr-assets`; PR fast gate green; merge with `--match-head-commit`; dev CI green at merged head.

## P amendments (decided while prototyping, disclosed before audit)

Prototyping ran ahead of the A gate inside P; nothing was committed before the audit below.

- Screenshots ship as WebP (2160 px wide, quality 86): readme-create 129 KB, readme-home 113 KB, readme-node 118 KB, readme-canvas 230 KB. PNG at the same size was 1.2-3 MB each.
- Screens actually captured: Create (replaces "Classic"), Home, Node graph, Canvas Mode. The Providers settings capture was dropped; the showcase has four rows.
- Demo content: 10 GPT OAuth images (chrome sculpture, concrete interior, ceramic cup, alpine lake, fictional portrait, Korean type poster, isometric greenhouse, unbranded rangefinder cutout, rainy alley, sneaker) plus 3 real i2i branches of the sculpture (gold, marble, forest) made against the demo server. The first camera came back with a real brand logo and was regenerated with an explicit no-logo prompt.
- Node graph content was saved through `PUT /api/sessions/:id/graph` with the three real i2i results as children (`source-right` → `target-left` handles).
- Scripts kept in this unit: `scripts/capture-readme.mjs` (screens), `scripts/banner.html` + `scripts/render-banner.mjs` (banner, transparent rounded corners), `scripts/render-readme.mjs` (GFM render through `gh api markdown` with GitHub CSS, light and dark).
- Translations: header, showcase, quick start, features, provider table, configuration intro, troubleshooting, docs list and development prose are freshly translated from the new English README. The CLI tables, environment table, logging modes, provider details and desktop build notes are shared verbatim in English inside collapsed sections labelled "(English)", so the four languages can never drift from the English facts. Language-specific doc links follow the files that exist (ko: FAQ, Prompt Studio; zh-CN/zh-TW: API, CLI, Docker, FAQ, npx, Prompt Studio, recover old images; ja: English docs).
- Provider table facts come from `ima2 models` on the demo server: AtlasCloud and MiniMax are image-only; `agy` serves `nano-banana-2` and `nano-banana-pro`.

## Findings outside scope (reported, not fixed here)

- `ima2 gen --no-save` still saved the image into `~/.ima2/generated` on the server and ignored `-o`, printing a data URL instead. The eleven stray files were moved out of the user's gallery into `/tmp/ima2-readme-demo`.
- `ima2 gen --server <other>` writes a CLI copy into `~/.ima2/generated/ima2-<timestamp>.png`; two jobs finishing in the same second got the same name and one overwrote the other.
