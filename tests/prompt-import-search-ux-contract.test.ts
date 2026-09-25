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

describe("prompt import search UX contract", () => {
  it("splits search results and candidate preview into dedicated components", () => {
    const dialog = readSource("ui/src/components/PromptImportDialog.tsx");
    const results = readSource("ui/src/components/PromptImportSearchResults.tsx");
    const preview = readSource("ui/src/components/PromptImportCandidatePreview.tsx");

    assert.match(dialog, /PromptImportSearchResults/);
    assert.match(dialog, /PromptImportCandidatePreview/);
    assert.match(dialog, /activeCandidateId/);
    assert.match(dialog, /setActiveCandidateId/);
    const dialogOnly = readFileSync(join(root, "ui/src/components/PromptImportDialog.tsx"), "utf8");
    assert.doesNotMatch(dialogOnly, /candidates\.map\(\(candidate\) =>/);

    assert.match(results, /prompt-import-dialog__results/);
    assert.match(results, /prompt-import-dialog__result-card/);
    assert.match(results, /promptLibrary\.previewPrompt/);
    assert.match(results, /promptLibrary\.selectPrompt/);
    assert.match(results, /promptLibrary\.selectedPrompt/);
    assert.match(results, /promptLibrary\.importThisPrompt/);
    assert.match(results, /onSelectCandidate\(candidate\)/);
    assert.match(results, /onToggleSelected\(candidate\.id/);
    assert.match(results, /onImportOne\(candidate\)/);

    assert.match(preview, /prompt-import-dialog__candidate-preview/);
    assert.match(preview, /candidate\.text/);
    assert.match(preview, /candidate\.tags/);
    assert.match(preview, /candidate\.warnings/);
    assert.match(preview, /candidate\.source/);
    assert.match(preview, /promptLibrary\.sourceDetails/);
    assert.match(preview, /promptLibrary\.compatibilityWarnings/);
  });

  it("keeps import as an explicit user action", () => {
    const dialog = readSource("ui/src/components/PromptImportDialog.tsx");
    const results = readSource("ui/src/components/PromptImportSearchResults.tsx");

    const commitIndex = dialog.indexOf("const commitCandidates");
    const importOneIndex = dialog.indexOf("const importOneCandidate");
    assert.ok(commitIndex >= 0);
    assert.ok(importOneIndex > commitIndex);

    assert.match(dialog, /commitPromptImport\(\{\s*candidates: picked\s*\}\)/);
    assert.match(dialog, /await onImported\(\)/);
    assert.match(dialog, /showToast\(t\("promptLibrary\.imported"/);
    assert.match(dialog, /onClose\(\)/);
    assert.match(dialog, /finally\s*\{\s*setBusy\(false\)/);
    assert.match(dialog, /t\("promptLibrary\.importSelected"/);

    assert.doesNotMatch(results, /commitPromptImport/);
    assert.match(results, /onImportOne/);
  });

  it("adds bounded layout and translated action copy", () => {
    const css = readSource("ui/src/index.css");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(css, /width:\s*min\(920px,\s*calc\(100vw - 24px\)\)/);
    assert.match(css, /\.prompt-import-dialog__workspace/);
    assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.05fr\)\s*minmax\(280px,\s*0\.95fr\)/);
    assert.match(css, /\.prompt-import-dialog__results,\s*\n\.prompt-import-dialog__candidate-preview/);
    assert.match(css, /max-height:\s*min\(44vh,\s*520px\)/);
    assert.match(css, /overflow-y:\s*auto/);

    for (const dict of [en, ko]) {
      assert.equal(typeof dict.promptLibrary.importSelected, "string");
      assert.equal(typeof dict.promptLibrary.importThisPrompt, "string");
      assert.equal(typeof dict.promptLibrary.previewPrompt, "string");
      assert.equal(typeof dict.promptLibrary.selectPrompt, "string");
      assert.equal(typeof dict.promptLibrary.selectedPrompt, "string");
      assert.equal(typeof dict.promptLibrary.searchResults, "string");
      assert.equal(typeof dict.promptLibrary.promptText, "string");
      assert.equal(typeof dict.promptLibrary.sourceDetails, "string");
      assert.equal(typeof dict.promptLibrary.license, "string");
      assert.equal(typeof dict.promptLibrary.attributionRequired, "string");
      assert.equal(typeof dict.promptLibrary.compatibilityWarnings, "string");
    }
  });

  it("v2: starts with no curated sources selected even when defaultSearch is true", () => {
    const dialog = readSource("ui/src/components/PromptImportDialog.tsx");
    assert.match(dialog, /setSelectedSourceIds\(new Set\(\)\)/);
    assert.doesNotMatch(dialog, /source\.defaultSearch/);
  });

  it("v2: does not auto-select preview candidates", () => {
    const dialog = readSource("ui/src/components/PromptImportDialog.tsx");
    const fn = /const addPreviewCandidates = useCallback\([\s\S]*?\}, \[\]\);/.exec(dialog)?.[0] ?? "";
    assert.ok(fn.length > 0, "addPreviewCandidates not found");
    assert.doesNotMatch(fn, /setSelected\(new Set\(merged\.map/);
  });

  it("v2: exposes select-all and clear actions on the results component", () => {
    const results = readSource("ui/src/components/PromptImportSearchResults.tsx");
    assert.match(results, /onSelectAll/);
    assert.match(results, /onClearSelection/);
    assert.match(results, /promptLibrary\.selectAllCandidates/);
    assert.match(results, /promptLibrary\.clearCandidateSelection/);
    assert.match(results, /promptLibrary\.searchResultsHeader/);
  });

  it("v2: collapses upper input sections when candidates exist", () => {
    const dialog = readSource("ui/src/components/PromptImportDialog.tsx");
    assert.match(dialog, /const hasResults = candidates\.length > 0/);
    assert.match(dialog, /const showUpperSections = !hasResults \|\| forceShowSources/);
    assert.match(dialog, /promptLibrary\.addAnotherSource/);
    assert.match(dialog, /setForceShowSources\(true\)/);
  });

  it("v2: results region drops min-height: 280px so the panel cannot squeeze", () => {
    const css = readSource("ui/src/index.css");
    const block = /\.prompt-import-dialog__results,\s*\n\.prompt-import-dialog__candidate-preview \{[\s\S]*?\}/.exec(css)?.[0] ?? "";
    assert.ok(block.length > 0, "results+preview block not found");
    assert.doesNotMatch(block, /min-height:\s*280px/);
    assert.match(block, /min-height:\s*0/);
  });

  it("v2: i18n keys for select-all / clear / add-another / results-header exist", () => {
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));
    for (const dict of [en, ko]) {
      assert.equal(typeof dict.promptLibrary.selectAllCandidates, "string");
      assert.equal(typeof dict.promptLibrary.clearCandidateSelection, "string");
      assert.equal(typeof dict.promptLibrary.addAnotherSource, "string");
      assert.equal(typeof dict.promptLibrary.searchResultsHeader, "string");
    }
  });
});
