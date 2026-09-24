# 010 Phase 1 — Brand assets and icon pipeline

Source kit (approved in this session, git-excluded scratch): `.concepts/logo-r2/kit/{mark.svg,favicon.svg,icon-1024.png,mark-chrome.png}`.

## File change map

| Path | Action | Change |
|---|---|---|
| assets/brand/mark.svg | NEW | kit mark.svg — viewBox `1170 1128 1386 1506`, `fill="currentColor"`, one path |
| assets/brand/favicon.svg | NEW | kit favicon.svg — 512 tile #1c1d21, rim #3a3c41, glyph #f2f3f5 |
| assets/brand/icon-1024.png | NEW | kit icon-1024.png recompressed (sharp png compressionLevel 9, alpha kept) |
| assets/brand/mark-chrome.png | NEW | kit mark-chrome.png resized to height 512 |
| assets/logo.png | MODIFY (binary) | content = assets/brand/icon-1024.png (README + make-icons consumer keep the path) |
| desktop/scripts/make-icons.mjs | MODIFY | remove white knockout (new icon already has alpha; the 240 cutoff would punch holes in the white chrome highlights); tray template from assets/brand/mark.svg |
| desktop/electron-builder.yml | MODIFY | files[] adds `assets/brand/mark.svg` next to the existing make-icons inputs (packaged self-heal in desktop/lib/icons.mjs runs make-icons at boot) |
| desktop/pages/brand-mark.png | NEW | copy of assets/brand/mark-chrome.png at height 256 for the file:// loading page |
| ui/public/favicon.svg | NEW | copy of assets/brand/favicon.svg |
| ui/public/brand-mark.svg | NEW | copy of assets/brand/mark.svg |
| ui/index.html | MODIFY | inline data-URL favicon (lines 24-28) becomes `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` |
| ui/src/styles/sidebar.css | MODIFY | `.logo-mark` (line 120) draws the mark with CSS mask; delete `.logo-mark::after` (line 385) |
| site/public/favicon.svg | MODIFY | content = assets/brand/favicon.svg |
| DESIGN.md | MODIFY | new "Brand mark" section: files, monochrome rule, where each asset is used |

## make-icons.mjs (after)

```js
import { mkdirSync, readFileSync } from "node:fs";
...
const logo = join(rootDir, "assets", "logo.png");
const mark = join(rootDir, "assets", "brand", "mark.svg");
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// macOS template images must be black + alpha; the OS tints them per menubar appearance.
function markSvg(color) {
  return Buffer.from(readFileSync(mark, "utf8").replace('fill="currentColor"', `fill="${color}"`));
}

export async function generateIcons(outDir = defaultOutDir) {
  mkdirSync(outDir, { recursive: true });
  await sharp(logo).resize(1024, 1024).png().toFile(join(outDir, "icon.png"));
  await sharp(logo).resize(32, 32).png().toFile(join(outDir, "tray.png"));
  for (const [name, size] of [["trayTemplate.png", 22], ["trayTemplate@2x.png", 44]]) {
    await sharp(markSvg("#000"), { density: 300 })
      .resize(size, size, { fit: "contain", background: CLEAR })
      .png().toFile(join(outDir, name));
  }
  return outDir;
}
```

## sidebar.css (after)

```css
.logo-mark {
  width: 15px;
  height: 16px;
  flex: 0 0 auto;
  background: var(--text);
  -webkit-mask: url("/brand-mark.svg") center / contain no-repeat;
  mask: url("/brand-mark.svg") center / contain no-repeat;
}
```
(`--text` existence re-verified at B; fall back to the token the sidebar title uses.)

## Accept criteria

- `node desktop/scripts/make-icons.mjs` exit 0; the four PNGs in desktop/build read back: icon = chrome tile with transparent corners, template = black mark on alpha.
- `cd ui && npm run build` exit 0; built UI rendered headless at 1280x720 shows the mark in the sidebar.
- `cmp site/public/favicon.svg assets/brand/favicon.svg` exit 0; `cd site && npm run build` exit 0.
- `rg -n "assets/logo.png"` shows the same consumers as before (no dangling path).


## A round 1 amendments (002)

| Path | Action | Change |
|---|---|---|
| assets/brand/mark-chrome.png | NEW | use existing kit mark-chrome-512.png |
| desktop/electron-builder.yml | MODIFY | files[] adds `assets/brand/mark.svg` and `assets/brand/favicon.svg`; comment at :42 names both inputs |
| desktop/scripts/make-icons.mjs | MODIFY | tray.png (Windows/Linux) = favicon.svg tile rendered at 32px (dark tile + white glyph reads on light and dark trays) |
| ui/public/apple-touch-icon.png | NEW | 180px render of favicon.svg; `<link rel="apple-touch-icon">` in ui/index.html |
| ui/index.html | MODIFY | `<title>ima2</title>` |
| ui/src/hooks/useBrowserAttentionBadge.ts | MODIFY | badge canvas draws the /favicon.svg image instead of the old ring glyph, then the unseen dot; contract test `tests/browser-attention-badge-contract.test.js` pins stay satisfied |
| ui/src/components/BrandMark.tsx | NEW | `<span className="logo-mark" aria-hidden="true" />` shared by Sidebar, MobileAppBar, LanSignIn |
| ui/src/components/Sidebar.tsx, MobileAppBar.tsx, LanSignIn.tsx | MODIFY | use BrandMark; MobileAppBar text via new `appBar.brand` key; LanSignIn shows the mark above the brand line |
| ui/src/styles/sidebar.css | MODIFY | `.logo-title--gen` gradient → flat `var(--text-muted)`-style monochrome |
| ui/src/styles/responsive-layout.css | MODIFY | :358 keep a 13px mark instead of display:none |
| ui/src/i18n/{en,ko,zh-Hans,zh-Hant}.json | MODIFY | `appBar.brand` = "ima2" |
| DESIGN.md | MODIFY | brand section + `--chrome` row now "chrome text treatment; the mark itself is flat" |

Verifier additions: `node --import tsx --test tests/browser-attention-badge-contract.test.js tests/i18n-dictionary-contract.test.ts tests/i18n-coverage-contract.test.ts tests/ui-radius-scale-contract.test.ts` exit 0.

## A round 2 amendments

- Badge stays synchronous: `renderBadgeFavicon(count)` draws the dark rounded tile and the mark with `new Path2D(BRAND_MARK_PATH)` (the mark.svg path data, exported from a new `ui/src/lib/brandMarkPath.ts`, scaled from viewBox `1170 1128 1386 1506`), then the unseen dot. No image loading, so no async re-render and no Safari/Firefox intrinsic-size issue.
- assets/brand/favicon.svg and the copies carry `width="512" height="512"` for intrinsic size.
- Activation: `tests/browser-attention-badge-contract.test.js` pins remain; add a pin that the source references `Path2D` and `BRAND_MARK_PATH`. The drawn result is checked in a headless page at C (canvas toDataURL screenshot read back).
