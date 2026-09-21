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

  it("has localized action titles and edge role copy", () => {
    assert.match(ko, /regenerateTitle/);
    assert.match(en, /regenerateTitle/);
    // Mot node nhan duoc nhieu cha, nen khong con chuoi "parentConflict"; thay
    // vao do canh mang nhan vai tro: anh goc hay tham chieu.
    assert.doesNotMatch(ko, /parentConflict/);
    assert.doesNotMatch(en, /parentConflict/);
    for (const locale of [ko, en]) {
      assert.match(locale, /roleBase/);
      assert.match(locale, /roleRef/);
    }
  });
});

