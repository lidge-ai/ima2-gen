import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readStoreBundle } from "./_storeBundle.mjs";

const store = readStoreBundle();
const imageNode = readFileSync("ui/src/components/ImageNode.tsx", "utf-8");
const ko = readFileSync("ui/src/i18n/ko.json", "utf-8");
const en = readFileSync("ui/src/i18n/en.json", "utf-8");

describe("node regenerate action contract", () => {
  it("splits ready-node regenerate and new variation actions", () => {
    assert.match(imageNode, /generateNodeInPlace/);
    assert.match(imageNode, /generateNodeVariation/);
    assert.match(imageNode, /onRegenerateInPlace/);
    assert.match(imageNode, /onNewVariation/);
    assert.match(imageNode, /node\.newVariation/);
  });

  it("keeps regenerate in-place and variation on the sibling path", () => {
    assert.match(store, /generateNodeInPlace:\s*\(clientId:\s*ClientNodeId\)\s*=>\s*Promise<void>/);
    assert.match(store, /generateNodeVariation:\s*\(clientId:\s*ClientNodeId,\s*sizeOverride\?:\s*string\)\s*=>\s*Promise<void>/);
    assert.match(store, /await get\(\)\.runGenerateNodeInPlace\(clientId\)/);
    assert.match(store, /const targetClientId = get\(\)\.addSiblingNode\(clientId\)/);
    assert.match(store, /await get\(\)\.runGenerateNodeInPlace\(targetClientId, \{ sizeOverride \}\)/);
  });

  it("preserves custom-size continuation intent", () => {
    assert.match(store, /\| \{ kind: "node-in-place"; clientId: ClientNodeId \}/);
    assert.match(store, /\| \{ kind: "node-variation"; clientId: ClientNodeId \}/);
    assert.match(store, /pending\.continuation\.kind === "node-in-place"/);
    assert.match(store, /pending\.continuation\.kind === "node-variation"/);
    assert.match(store, /runGenerateNodeInPlace\(pending\.continuation\.clientId,\s*\{\s*sizeOverride: adjustedSize/);
    assert.match(store, /generateNodeVariation\(pending\.continuation\.clientId, adjustedSize\)/);
  });

  it("adds localized new variation labels", () => {
    assert.match(ko, /"newVariation":\s*"새 변형"/);
    assert.match(en, /"newVariation":\s*"New variant"/);
  });
});
