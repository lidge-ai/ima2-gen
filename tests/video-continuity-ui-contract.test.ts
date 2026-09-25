import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";

const read = (rel) => readSourceTree(rel);

describe("video continuity UI contracts", () => {
  it("removes weak animateImage fallback and uses active prompt guidance", () => {
    const store = readSourceTree("ui/src/store/useAppStore.ts");
    assert.doesNotMatch(store, /Animate this image with subtle, natural motion/);
    assert.match(store, /ACTIVE_VIDEO_PROMPT_GUIDANCE/);
    assert.match(store, /setVideoContinuityLineage/);
  });

  it("carries video lineage through drag producers and composer consumer", () => {
    assert.match(read("ui/src/components/GalleryImageTile.tsx"), /buildVideoDragPayload/);
    assert.match(read("ui/src/components/HistoryStrip.tsx"), /buildVideoDragPayload/);
    assert.match(read("ui/src/components/history/SidebarHistoryImageCard.tsx"), /buildVideoDragPayload/);
    const composer = read("ui/src/components/PromptComposer.tsx");
    assert.match(composer, /continueFromItem/);
    const shared = read("ui/src/lib/continueFromItem.ts");
    assert.match(shared, /buildVideoContinuityFromItem/);
    assert.match(shared, /buildContinuityPromptChip/);
    assert.match(shared, /setVideoContinuityLineage/);
  });

  it("shows pending and selected continuity metadata in the right surfaces", () => {
    assert.match(read("ui/src/components/VideoControlsPanel.tsx"), /continuitySummary/);
    assert.match(read("ui/src/components/Canvas.tsx"), /continuitySummary\(currentImage\.videoContinuity\)/);
  });

  it("video generate request can include branch lineage and continueFromVideo", () => {
    const api = read("ui/src/lib/api.ts");
    assert.match(api, /continueFromVideo\?: string/);
    assert.match(api, /continuityLineage\?:/);
    const store = readSourceTree("ui/src/store/useAppStore.ts");
    assert.match(store, /continueFromVideo,/);
    assert.match(store, /continuityLineage: parentVideoContinuity/);
  });

  it("clears pending continuity when its reference or prompt chip is removed", () => {
    const store = readSourceTree("ui/src/store/useAppStore.ts");
    assert.match(store, /!prompt\.id\.startsWith\("video-continuity:"\)/);
    // Tray model (260716_composer-tray 010): clearing references routes
    // through the tray mutation helper and still resets continuity state.
    assert.match(store, /canvasReferenceImage: null,\s*videoContinuityLineage: null,\s*insertedPrompts: withoutContinuityPrompts\(state\),\s*providerUrlReference: null/);
    assert.match(store, /id\.startsWith\("video-continuity:"\)/);
    assert.match(store, /set\(\{ insertedPrompts: \[\], videoContinuityLineage: null \}\)/);
  });
});
