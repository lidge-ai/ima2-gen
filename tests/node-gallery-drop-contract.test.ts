import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readStoreBundle } from "./_storeBundle.mjs";

const store = readStoreBundle();
const imageNode = readFileSync("ui/src/components/ImageNode.tsx", "utf-8");

describe("gallery → node drop contract", () => {
  it("reads the internal ima2-ref payload in the node drop handler", () => {
    assert.match(imageNode, /e\.dataTransfer\.getData\("application\/ima2-ref"\)/);
    assert.match(imageNode, /addNodeReferenceFromUrl\(id, src, item\.filename\)/);
  });

  it("exposes a URL-based node reference action on the store", () => {
    assert.match(store, /addNodeReferenceFromUrl: \(clientId: ClientNodeId, src: string, filename\?: string\) => Promise<void>;/);
    assert.match(store, /export async function addNodeReferenceFromUrlImpl\(/);
  });

  it("extracts a frame for video sources and compresses image sources", () => {
    assert.match(store, /isVideoUrl\(src\) \|\| isVideoUrl\(filename\)\s*\? await extractLastFrame\(src\)\s*: await compressReferenceSource\(src, filename \|\| "node-reference\.png"\)/);
  });
});
