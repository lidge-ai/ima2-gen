import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const root = process.cwd();

function readSource(path) {
  const content = readFileSync(join(root, path), "utf8");
  const dir = dirname(path);
  let combined = content;
  const re = /(?:export|import)\s+[\s\S]*?from\s*["']\.\/([\w.\/-]+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    for (const ext of ["", ".ts", ".tsx", ".js"]) {
      try { combined += "\n" + readFileSync(join(root, dir, m[1] + ext), "utf8"); break; } catch {}
    }
  }
  const cssRe = /@import\s+["']\.\/([\w.\/-]+)["']/g;
  while ((m = cssRe.exec(content)) !== null) {
    try { combined += "\n" + readFileSync(join(root, dir, m[1]), "utf8"); } catch {}
  }
  return combined;
}

describe("prompt discovery UI contract", () => {
  it("wires discovery as a focused opt-in section separate from commit candidates", () => {
    const dialog = readSource("ui/src/components/PromptImportDialog.tsx");
    const section = readSource("ui/src/components/PromptImportDiscoverySection.tsx");

    assert.match(dialog, /PromptImportDiscoverySection/);
    assert.match(dialog, /sourcePanel/);
    assert.match(dialog, /onSourcesChanged=\{loadCuratedSources\}/);
    assert.doesNotMatch(section, /commitPromptImport/);
    assert.doesNotMatch(section, /onCandidates/);
    assert.doesNotMatch(section, /addPreviewCandidates/);
    assert.match(dialog, /commitPromptImport\(\{ candidates: picked \}\)/);
  });

  it("uses discovery API helpers without sending prompt candidate payloads", () => {
    const api = readSource("ui/src/lib/api.ts");
    const section = readSource("ui/src/components/PromptImportDiscoverySection.tsx");

    assert.match(api, /export type PromptDiscoveryCandidate/);
    assert.match(api, /export type PromptDiscoveryReviewStatus/);
    assert.match(api, /export type PromptDiscoverySearchResponse/);
    assert.match(api, /getPromptImportDiscovery/);
    assert.match(api, /searchPromptImportDiscovery/);
    assert.match(api, /reviewPromptImportDiscoveryCandidate/);
    assert.match(section, /searchPromptImportDiscovery/);
    assert.match(section, /reviewPromptImportDiscoveryCandidate/);

    const searchHelper = api.slice(
      api.indexOf("export function searchPromptImportDiscovery"),
      api.indexOf("export function reviewPromptImportDiscoveryCandidate"),
    );
    assert.doesNotMatch(searchHelper, /candidates/);
    assert.doesNotMatch(searchHelper, /commitPromptImport/);
  });

  it("adds discovery copy and bounded layout styles", () => {
    const css = readSource("ui/src/index.css");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(css, /\.prompt-import-dialog__discovery/);
    assert.match(css, /\.prompt-import-dialog__discovery-list/);
    assert.match(css, /max-height:\s*188px/);
    assert.match(css, /overflow-y:\s*auto/);
    assert.match(css, /\.prompt-import-dialog__review-actions/);
    assert.match(css, /text-overflow:\s*ellipsis/);

    for (const dict of [en, ko]) {
      assert.equal(typeof dict.promptLibrary.discovery, "string");
      assert.equal(typeof dict.promptLibrary.discoverySearch, "string");
      assert.equal(typeof dict.promptLibrary.discoverySearchPlaceholder, "string");
      assert.equal(typeof dict.promptLibrary.discoveryApprove, "string");
      assert.equal(typeof dict.promptLibrary.discoveryReject, "string");
      assert.equal(typeof dict.promptLibrary.discoveryScore, "string");
      assert.equal(typeof dict.promptLibrary.discoveryWarnings, "string");
      assert.equal(typeof dict.promptLibrary.discoveryRateLimited, "string");
      assert.equal(typeof dict.promptLibrary.discoveryNoResults, "string");
      assert.equal(typeof dict.promptLibrary.discoveryReviewQueue, "string");
      assert.equal(typeof dict.promptLibrary.discoveryRequiresPaths, "string");
    }
  });
});
