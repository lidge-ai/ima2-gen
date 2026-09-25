import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

describe("Asset Gen media lightbox contract", () => {
  it("keeps preview state local and limits opening to the media button", () => {
    const workspace = read("ui/src/components/assetgen/AssetGenWorkspace.tsx");

    assert.match(workspace, /useState<GenerateItem \| null>\(null\)/);
    assert.match(workspace, /className="assetgen-tile__media"/);
    assert.match(workspace, /aria-label=\{mediaLabel\}/);
    assert.match(workspace, /onClick=\{\(\) => setPreviewItem\(item\)\}/);
    assert.match(workspace, /className="assetgen-tile__key" onClick=\{\(\) => setKeyingTarget\(item\)\}/);
    assert.match(workspace, /className="assetgen-tile__retry"[\s\S]*retrySave\(item\.requestId!\)/);
    assert.match(workspace, /previewItem \? <AssetMediaLightbox item=\{previewItem\} onClose=\{closePreview\} \/>/);
  });

  it("reuses the lightbox from the Assets library without stealing detail or delete clicks", () => {
    const workspace = read("ui/src/components/assets/AssetsWorkspace.tsx");
    const grid = read("ui/src/components/assets/AssetsGrid.tsx");
    const assetPreview = read("ui/src/lib/assetPreview.ts");

    assert.match(workspace, /useState<GenerateItem \| null>\(null\)/);
    assert.match(workspace, /onPreviewAsset=\{\(asset\) => setPreviewItem\(assetToPreviewItem\(asset\)\)\}/);
    assert.match(workspace, /previewItem \? <AssetMediaLightbox item=\{previewItem\} onClose=\{closePreview\} \/>/);
    assert.match(
      assetPreview,
      /\(derivedKind\.startsWith\("keyed-"\) \|\| derivedKind === "vector-svg"\) \? "edit" : "imported"/,
    );
    assert.match(grid, /className="assets-tile__preview" aria-label=\{previewLabel\}/);
    assert.match(grid, /event\.stopPropagation\(\); onSelect\?\.\(item\.id\); onPreview\?\.\(item\)/);
    assert.match(grid, /className=\{`assets-tile__delete[\s\S]*event\.stopPropagation\(\); void remove\(\)/);
  });

  it("uses an accessible focus-managed modal with complete cleanup", () => {
    const lightbox = read("ui/src/components/assetgen/AssetMediaLightbox.tsx");

    assert.match(lightbox, /useAgentDialogFocus\(true, close\)/);
    assert.match(lightbox, /role="dialog"/);
    assert.match(lightbox, /aria-modal="true"/);
    assert.match(lightbox, /aria-labelledby=\{titleId\}/);
    assert.match(lightbox, /className="assetgen-lightbox__backdrop"[\s\S]*onClick=\{close\}/);
    assert.match(lightbox, /className="assetgen-lightbox__control"[\s\S]*onClick=\{close\}/);
    assert.match(lightbox, /document\.body\.style\.overflow = "hidden"/);
    assert.match(lightbox, /document\.documentElement\.style\.overflow = "hidden"/);
    assert.match(lightbox, /document\.body\.style\.overflow = bodyOverflow/);
    assert.match(lightbox, /document\.documentElement\.style\.overflow = rootOverflow/);
  });

  it("supports fit and 2x image zoom while preserving transparent keyed media", () => {
    const lightbox = read("ui/src/components/assetgen/AssetMediaLightbox.tsx");
    const css = read("ui/src/styles/assetgen-workspace.css");

    assert.match(lightbox, /const \[zoomed, setZoomed\] = useState\(false\)/);
    assert.match(lightbox, /aria-pressed=\{zoomed\}/);
    assert.match(lightbox, /setZoomed\(\(current\) => !current\)/);
    assert.match(lightbox, /item\.kind === "edit" \? "is-keyed" : ""/);
    assert.match(css, /\.assetgen-lightbox__stage\s*\{[^}]*overflow:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*touch-action:\s*pan-x pan-y/s);
    assert.match(css, /\.assetgen-lightbox__stage:not\(\.is-zoomed\) img, \.assetgen-lightbox__stage video\s*\{[^}]*position:\s*absolute;[^}]*width:\s*100%;[^}]*height:\s*100%/s);
    assert.match(css, /\.assetgen-lightbox__stage\.is-zoomed img\s*\{[^}]*width:\s*200%;[^}]*max-width:\s*none/s);
    assert.match(css, /\.assetgen-lightbox__stage\.is-keyed\s*\{[^}]*repeating-conic-gradient/s);
  });

  it("moves video playback into the popup with a native manual fallback", () => {
    const workspace = read("ui/src/components/assetgen/AssetGenWorkspace.tsx");
    const lightbox = read("ui/src/components/assetgen/AssetMediaLightbox.tsx");

    assert.match(workspace, /<video[\s\S]*muted[\s\S]*playsInline[\s\S]*preload="metadata"[\s\S]*aria-hidden="true"/);
    assert.doesNotMatch(workspace, /<video[\s\S]{0,240}\bcontrols\b/);
    assert.match(lightbox, /item\.mediaType === "video"/);
    assert.match(lightbox, /<video[\s\S]*controls[\s\S]*autoPlay[\s\S]*muted[\s\S]*playsInline[\s\S]*preload="metadata"/);
    assert.match(lightbox, /poster=\{item\.thumb \|\| undefined\}/);
  });

  it("keeps the overlay responsive, focused, and reduced-motion safe", () => {
    const css = read("ui/src/styles/assetgen-workspace.css");

    assert.match(css, /\.assetgen-lightbox\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*260/s);
    assert.match(css, /\.assetgen-lightbox__control, \.assetgen-lightbox__zoom\s*\{[^}]*min-inline-size:\s*44px;[^}]*min-block-size:\s*44px/s);
    assert.match(css, /\.assetgen-lightbox__control:focus-visible/);
    assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.assetgen-lightbox__panel\s*\{[^}]*height:\s*100%/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /@media \(max-width: 800px\)[\s\S]*\.assetgen-tile__open-hint\s*\{\s*opacity:\s*1/);
  });

  it("carries preview names and actions in both locales", () => {
    const keys = [
      "previewImage",
      "previewVideo",
      "previewDialogTitle",
      "closePreview",
      "zoomIn",
      "zoomOut",
      "openHintImage",
      "openHintVideo",
      "imageFallback",
      "videoFallback",
    ];
    for (const localeName of ["en", "ko"]) {
      const locale = JSON.parse(read(`ui/src/i18n/${localeName}.json`));
      for (const key of keys) assert.equal(typeof locale.assetGen[key], "string", `${localeName}.${key}`);
    }
  });
});
