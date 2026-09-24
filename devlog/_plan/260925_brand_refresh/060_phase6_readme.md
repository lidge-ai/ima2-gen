# 060 Phase 6 — README polish (en, ko, ja, zh-CN, zh-TW)

## README.md outline (after)

1. Centered logo `assets/logo.png` (width 160), one-line tagline, badges (npm, Node ≥22, MIT), site/docs/language links as plain text (drop the emoji markers).
2. One short "what it is" paragraph from the current facts.
3. Existing screenshot.
4. Install — in order: Desktop app for Mac (Apple Silicon, releases link, signed and notarized), one-click install script (existing commands), npm (existing Quick Start); Docker keeps its own subsection.
5. Remaining sections kept, tightened where they run on.
6. Desktop (Electron) section: `npm run dist:mac  # dmg + zip (arm64)`; signature paragraph says arm64 only (desktop/electron-builder.yml:91).

Translated READMEs get the same structural changes (logo path `../assets/logo.png`, install options including the desktop app, arm64 correction). Other translated content stays as is unless the readme gap report shows a factual error.

## Accept criteria

- Link check script over the five READMEs (markdown links and img src that are relative paths must exist) — output captured at C.
- `rg -n "x64" README.md docs/README.*.md` shows no claim that the desktop release ships x64.
- Rendered GitHub preview is not reproducible offline; human review row.


## A round 1 amendments (002) — file change map

| Path | Change |
|---|---|
| README.md | items 1-19 of 001/readme: FAQ anchor, 14 video refs, arm64-only desktop, desktop workflow triggers (push to dev + desktop-v* tags + manual) and inputs (platform only), Grok defaults (planner grok-4.3, image grok-imagine-image-2.0, generation timeout 300000), grok-imagine-image-2.0 in picker text, skill reference counts from `ls`, zh-TW link, CLI quickstart subsection before Docker, stop parenthetical, emoji markers removed, "Install the Mac app" block, logo block |
| docs/README.ko.md | logo block, docs link, install incl. desktop app, 10 core lanes, CLI.md duplicate, Grok defaults where present |
| docs/README.ja.md | logo block, docs link, install incl. desktop app, 14 refs, 10 lanes, heading rename, CLI.md duplicate |
| docs/README.zh-CN.md | 14 refs, alt text, Grok defaults/timeouts, 多变的→变量, 满的→完整, 客户→客户端, 车道→lane, duplicate 设置 heading, self-link→zh-TW, desktop install block |
| docs/README.zh-TW.md | same class as zh-CN, 客戶→用戶端, 車道→lane, counts 21/37, 10 lanes, desktop install block |

Link checker: `node devlog/_plan/260925_brand_refresh/scripts/check-readme-links.mjs` (NEW, unit-local) — resolves every relative `](...)` and `src="..."` in the five files; exit 1 on a missing target.
Counts are recomputed at B with `ls skills/ima2-front/references | wc -l` and `ls skills/ima2-uiux/references | wc -l` rather than copied from the report.
