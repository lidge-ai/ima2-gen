import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readStoreBundle } from "./_storeBundle.mjs";

const store = readStoreBundle();
const api = readFileSync("ui/src/lib/nodeApi.ts", "utf-8");
const refs = readFileSync("ui/src/lib/nodeRefStorage.ts", "utf-8");

describe("node child reference payload contract", () => {
  it("sends node references even when parentNodeId is present", () => {
    assert.match(store, /parentNodeId: effectiveParentServerNodeId/);
    assert.match(store, /\.\.\(nodeRefs\.length\s*\?\s*\{ references: nodeRefs\.map\(stripDataUrlPrefix\) \}/);
    assert.doesNotMatch(store, /nodeRefs\.length && !effectiveParentServerNodeId/);
  });

  it("declares explicit node context and search policy on node requests", () => {
    assert.match(api, /contextMode\?: "parent-plus-refs" \| "parent-only" \| "ancestry"/);
    assert.match(api, /searchMode\?: "off" \| "auto" \| "on"/);
    assert.match(api, /webSearchEnabled\?: boolean/);
    assert.match(store, /contextMode: "parent-plus-refs"/);
    assert.match(store, /searchMode: s\.webSearchEnabled \? "on" : "off"/);
    assert.match(store, /webSearchEnabled: s\.webSearchEnabled/);
  });

  it("persists node-local refs outside sanitized graph payload", () => {
    // Anh dinh van nam NGOAI payload graph - do la diem giu data URL ra khoi
    // co so du lieu. Cai doi la NOI luu: truoc o localStorage, gio o may chu,
    // vi mot khuon chay o may chu khong he thay localStorage cua trinh duyet.
    assert.match(refs, /\/node-refs/);
    assert.match(store, /loadNodeRefs\(session\.id, n\.id\)/);
    assert.match(store, /saveNodeRefs\(sessionId, clientId, refs\)/);
    assert.match(store, /delete safe\.referenceImages/);
  });

  it("keeps the legacy local key so attachments made before the move are not lost", () => {
    // Nguoi dung da dinh anh truoc khi co bang nay. Bo khoa cu di la mat cong
    // ho da bo ra, ma khong co gi bao.
    assert.match(refs, /KHOA_CU = "ima2\.nodeRefs\.v1"/);
    assert.match(refs, /napRefCuaPhien/);
  });

  it("compresses generated-image references before reusing them for i2i", () => {
    assert.match(store, /async function compressReferenceSource\(src: string,\s*filename = "reference\.png"\)/);
    assert.match(store, /new File\(\[blob\], filename, \{ type: blob\.type \|\| "image\/png" \}\)/);
    assert.match(store, /compressToBase64\(file,\s*\{[\s\S]*preserveTransparency:\s*false/);
    assert.match(store, /dataUrl = await compressReferenceSource\(\s*resolveModelReferenceSrc\(cur\),\s*cur\.canvasSourceFilename \|\| cur\.filename \|\| "current-reference\.png",?\s*\)/);
    assert.match(store, /const dataUrl = await compressReferenceSource\(sourceUrl,\s*"node-reference\.png"\)/);
    assert.doesNotMatch(store, /useCurrentAsReference:[\s\S]*?readAsDataURL\(blob\);[\s\S]*?addedCurrentAsRef/);
  });
});
