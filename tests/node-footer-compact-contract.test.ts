import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSourceTree } from "./_readTree.mjs";

const imageNode = readFileSync("ui/src/components/ImageNode.tsx", "utf-8");
const css = readSourceTree("ui/src/index.css");
const ko = readFileSync("ui/src/i18n/ko.json", "utf-8");
const en = readFileSync("ui/src/i18n/en.json", "utf-8");

describe("node compact footer contract", () => {
  it("keeps ready node actions in a compact action group with accessible labels", () => {
    assert.match(imageNode, /className="image-node__footer nodrag"/);
    assert.match(imageNode, /aria-label=\{t\("node\.regenerateTitle"\)\}/);
    assert.match(imageNode, /aria-label=\{t\("node\.newVariationTitle"\)\}/);
    assert.match(imageNode, /aria-label=\{t\("node\.deleteTitle"\)\}/);
  });

  it("uses a one-line flex footer instead of a multi-row action grid", () => {
    assert.match(css, /\.image-node__footer \{\s*display: flex/);
    assert.match(css, /\.image-node__actions \{\s*flex: 0 1 auto;\s*display: flex/);
    assert.match(css, /\.image-node__actions \{[^}]*flex-wrap:\s*wrap/);
    assert.doesNotMatch(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 0\.9fr\)/);
  });

  it("has localized action titles and multiple-parent edge roles", () => {
    assert.match(ko, /regenerateTitle/);
    assert.match(ko, /"roleBase":\s*"원본"/);
    assert.match(ko, /"roleRef":\s*"참조"/);
    assert.match(en, /regenerateTitle/);
    assert.match(en, /"roleBase":\s*"base"/);
    assert.match(en, /"roleRef":\s*"ref"/);
  });
});
