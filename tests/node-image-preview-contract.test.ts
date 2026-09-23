import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const preview = read("ui/src/components/node-canvas/NodeImagePreview.tsx");
const header = read("ui/src/components/node-canvas/NodeIdentityHeader.tsx");
const imageNode = read("ui/src/components/ImageNode.tsx");
const lightbox = read("ui/src/components/assetgen/AssetMediaLightbox.tsx");
const css = read("ui/src/styles/node-image-preview.css");

describe("node image preview and identity (PR 256 WP2)", () => {
  it("portals the lightbox out of the scaled canvas and keeps its events off the node", () => {
    assert.match(preview, /createPortal\(/);
    assert.match(preview, /document\.body,/);
    // React bubbles portal events through the node: clicks and graph keys stop at
    // the wrapper, while Escape and Tab still reach the dialog's document listener.
    assert.match(preview, /<div className="nokey" onClick=\{keepInsideDialog\} onKeyDown=\{keepInsideDialog\}>/);
    assert.match(preview, /new Set\(\["Escape", "Tab"\]\)/);
    assert.match(preview, /showAssetActions=\{false\}/);
  });

  it("hides asset-workspace actions only where a caller opts out", () => {
    assert.match(lightbox, /showAssetActions = true/);
    for (const action of ["canCurate", "canKey", "canVectorize"]) {
      assert.match(lightbox, new RegExp(`showAssetActions && ${action} \\? \\(`));
    }
    for (const caller of ["ui/src/components/assetgen/AssetGenWorkspace.tsx", "ui/src/components/assets/AssetsWorkspace.tsx"]) {
      assert.doesNotMatch(read(caller), /showAssetActions/, `${caller} keeps the default asset actions`);
    }
  });

  it("keeps the id text draggable and copies from its own nodrag icon", () => {
    assert.match(header, /<div className="image-node__id" title=\{nodeId\}>/);
    assert.match(header, /<span className="image-node__id-text">\{nodeId\}<\/span>/);
    assert.match(header, /className="image-node__id-copy nodrag"/);
    assert.match(header, /copyTextToClipboard\(nodeId\)/);
    assert.match(header, /t\("toast\.copyFailed"\), true/);
  });

  it("truncates long ids without shrinking short ones and shows zoom without hover", () => {
    const idText = css.slice(css.indexOf(".image-node__id-text {"), css.indexOf(".image-node__id-copy {"));
    assert.match(idText, /flex: 0 0 auto;/);
    assert.match(idText, /max-width: 58%;/);
    assert.match(idText, /text-overflow: ellipsis;/);
    assert.match(css, /@media \(hover: none\), \(pointer: coarse\) \{\s*\.image-node__zoom \{[^}]*opacity: 1;/);
    assert.match(css, /\.image-node__preview \{\s*position: relative;/);
    assert.doesNotMatch(css, /border-radius/);
  });

  it("wires both pieces into ImageNode and replaces the play triangle", () => {
    assert.match(imageNode, /<NodeIdentityHeader nodeId=\{id\} \/>/);
    assert.match(imageNode, /<NodeImagePreview imageUrl=\{d\.imageUrl\} prompt=\{d\.prompt \|\| ""\} \/>/);
    assert.doesNotMatch(imageNode, /▶/);
  });

  it("localizes the new labels in every dictionary", () => {
    for (const locale of ["en", "ko", "zh-Hans", "zh-Hant"]) {
      const node = JSON.parse(read(`ui/src/i18n/${locale}.json`)).node;
      for (const key of ["zoomImage", "copyId", "animateTitle"]) {
        assert.equal(typeof node[key], "string", `${locale} node.${key}`);
        assert.ok(node[key].length > 0);
      }
    }
  });
});
