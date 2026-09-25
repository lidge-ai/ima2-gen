// UI contract for the transparent background preset (260821).
// Source-text assertions: the picker must gate transparency to the GPT lane and
// the gallery must treat alpha results as un-keyable.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

describe("background preset picker exposes transparent", () => {
  const picker = read("ui/src/components/assetgen/BackgroundPresetPicker.tsx");

  it("offers a transparent preset with a checkerboard swatch, not a color chip", () => {
    assert.match(picker, /value: "transparent"/);
    assert.match(picker, /swatch: null/);
    assert.match(picker, /assetgen-bg-picker__swatch--alpha/);
  });

  it("disables transparent on the Grok lane, which has no alpha parameter", () => {
    assert.match(picker, /transparentAvailable = provider !== "grok" && provider !== "grok-api"/);
    assert.match(picker, /disabled = p\.value === "transparent" && !transparentAvailable/);
    assert.match(picker, /assetGen\.bgTransparentGptOnly/);
  });

  it("swaps the hint copy when transparent is selected", () => {
    assert.match(picker, /assetGen\.backgroundHintTransparent/);
  });
});

describe("provider switch clears a stale transparent selection", () => {
  const store = read("ui/src/store/useAppStore.ts");
  it("falls back to chroma-green when switching to Grok", () => {
    assert.match(store, /assetGenBackground === "transparent"/);
    assert.match(store, /assetGenBackground: "chroma-green"/);
  });
});

describe("alpha results render on a checkerboard and skip keying", () => {
  const workspace = read("ui/src/components/assetgen/AssetGenWorkspace.tsx");
  const css = read("ui/src/styles/assetgen-workspace.css");

  it("flags transparent generations in the gallery", () => {
    assert.match(workspace, /const isAlpha = item\.backgroundPreset === "transparent"/);
    assert.match(workspace, /isAlpha \? " is-alpha" : ""/);
  });

  it("never offers keying for an alpha asset", () => {
    assert.match(workspace, /\{!isKeyed && !isAlpha \? \(/);
  });

  it("letterboxes alpha assets instead of cover-cropping the silhouette", () => {
    assert.match(css, /\.assetgen-tile\.is-alpha \.assetgen-tile__media img \{[^}]*object-fit: contain/s);
  });

  it("carries the preset onto the generated item so the flag survives", () => {
    const impl = read("ui/src/store/storeAssetGenImpl.ts");
    assert.match(impl, /backgroundPreset: s\.assetGenBackground,\n\s*createdAt/);
  });
});

describe("i18n coverage for every shipped locale", () => {
  const locales = ["en", "ko", "zh-Hans", "zh-Hant"];
  for (const locale of locales) {
    it(`${locale} defines the transparent strings`, () => {
      const json = JSON.parse(read(`ui/src/i18n/${locale}.json`));
      assert.equal(typeof json.assetGen.bgTransparent, "string");
      assert.equal(typeof json.assetGen.backgroundHintTransparent, "string");
      assert.equal(typeof json.assetGen.bgTransparentGptOnly, "string");
    });
  }
});
