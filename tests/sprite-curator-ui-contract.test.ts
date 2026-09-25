import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

describe("sprite curator UI contract", () => {
  it("keeps playback timing in refs and only updates React at a frame boundary", () => {
    const source = read("ui/src/components/assetgen/useSpritePlayback.ts");
    assert.match(source, /timestampRef = useRef<number \| null>/);
    assert.match(source, /accumulatorRef = useRef\(0\)/);
    assert.match(source, /1000 \/ \(fps \* speed\)/);
    assert.match(source, /if \(accumulatorRef\.current >= interval\)/);
    assert.match(source, /if \(next !== current\)[\s\S]*setFrame\(next\)/);
    assert.match(source, /Math\.min\(timestamp - previous, interval \* 2\)/);
    assert.match(source, /cancelAnimationFrame\(rafRef\.current\)/);
  });

  it("draws explicit atlas rects with the shared affine matrix", () => {
    const source = read("ui/src/components/assetgen/SpriteSequencePreview.tsx");
    assert.match(source, /spriteTransformMatrix\(transform\)/);
    assert.match(source, /ctx\.setTransform\(m00, m10, m01, m11, cx, cy\)/);
    assert.match(source, /frame\.rect\.x, frame\.rect\.y, frame\.rect\.w, frame\.rect\.h/);
    assert.match(source, /imageSmoothingEnabled = false/);
  });

  it("preserves separate selected and full order semantics", () => {
    const panel = read("ui/src/components/assetgen/SpriteCuratorPanel.tsx");
    assert.match(panel, /selected, order: \[\.\.\.selected, \.\.\.candidates\], deleted/);
    assert.match(panel, /statePlan\.selected\.length > 1/);
    assert.match(panel, /dirty && !window\.confirm/);
    assert.match(panel, /await saveSpriteCuration\(target\.runId, curation\)/);
    assert.match(panel, /await bakeSpriteAtlas\(target\.runId\)/);
  });

  it("provides keyboard and pointer rail editing with accessible selection", () => {
    const rail = read("ui/src/components/assetgen/SpriteFrameRail.tsx");
    assert.match(rail, /draggable/);
    assert.match(rail, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
    assert.match(rail, /role="listbox"/);
    assert.match(rail, /role="option"/);
    assert.match(rail, /aria-selected=/);
  });

  it("only opens curation for atlas metadata and keeps target-only global state", () => {
    const lightbox = read("ui/src/components/assetgen/AssetMediaLightbox.tsx");
    const types = read("ui/src/store/storeTypes.ts");
    const store = read("ui/src/store/useAppStore.ts");
    assert.match(lightbox, /metadata\?\.spriteRunId/);
    assert.match(lightbox, /metadata\?\.manifestPath/);
    assert.match(lightbox, /getAssetById\(assetId\)/);
    assert.match(lightbox, /setCuratorTarget\(\{ runId: spriteRunId, atlasFile: item\.filename, manifestFile: manifestPath \}\)/);
    assert.match(types, /spriteCuratorTarget: SpriteCuratorTarget \| null/);
    assert.match(store, /setCuratorTarget: \(target\) => set\(\{ spriteCuratorTarget: target \}\)/);
  });
});
