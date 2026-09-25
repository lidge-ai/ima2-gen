import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readStoreBundle } from "./_storeBundle.mjs";

const root = process.cwd();

function readSource(path) {
  if (path === "ui/src/store/useAppStore.ts") return readStoreBundle();
  return readFileSync(join(root, path), "utf8");
}

describe("style feature removal contract", () => {
  it("removes the style controls from classic and node UI", () => {
    const composer = readSource("ui/src/components/PromptComposer.tsx");
    const sidebar = readSource("ui/src/components/Sidebar.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    const api = readSource("ui/src/lib/api.ts");
    const css = readSource("ui/src/index.css");

    assert.doesNotMatch(composer, /StyleSheetDialog/);
    assert.doesNotMatch(composer, /styleOpen/);
    assert.doesNotMatch(composer, /prompt\.style/);
    assert.doesNotMatch(composer, /styleTitle/);

    assert.doesNotMatch(sidebar, /NodeStyleButton/);
    assert.doesNotMatch(sidebar, /styleSheetEnabled/);
    assert.doesNotMatch(sidebar, /styleSheetActive/);

    assert.doesNotMatch(store, /styleSheetEnabled/);
    assert.doesNotMatch(store, /extractStyleSheet/);
    assert.doesNotMatch(store, /saveStyleSheet/);
    assert.doesNotMatch(api, /StyleSheetResponse/);
    assert.doesNotMatch(api, /getSessionStyleSheet/);
    assert.doesNotMatch(api, /saveSessionStyleSheet/);
    assert.doesNotMatch(api, /setSessionStyleSheetEnabled/);
    assert.doesNotMatch(api, /extractSessionStyleSheet/);

    assert.doesNotMatch(css, /\.style-sheet-/);
    assert.doesNotMatch(css, /\.node-mode-style-badge/);
  });

  it("does not mutate prompts with a style sheet in generation routes", () => {
    for (const path of ["routes/generate.ts", "routes/edit.ts", "routes/nodes.ts"]) {
      const source = readSource(path);

      assert.doesNotMatch(source, /getStyleSheet/);
      assert.doesNotMatch(source, /renderStyleSheetPrefix/);
      assert.doesNotMatch(source, /effectivePrompt/);
      assert.doesNotMatch(source, /styleSheetApplied/);
    }
  });

  it("removes style copy from active translations", () => {
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    for (const dict of [en, ko]) {
      assert.equal(dict.styleSheet, undefined);
      assert.equal(dict.prompt.style, undefined);
      assert.equal(dict.prompt.styleTitle, undefined);
      assert.equal(dict.node.styleSheetActive, undefined);
    }
  });
});
