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

describe("prompt import folder UI contract", () => {
  it("adds a focused folder section without bypassing commit flow", () => {
    const dialog = readSource("ui/src/components/PromptImportDialog.tsx");
    const section = readSource("ui/src/components/PromptImportFolderSection.tsx");
    const api = readSource("ui/src/lib/api.ts");

    assert.match(dialog, /PromptImportFolderSection/);
    assert.match(dialog, /onCandidates=\{addPreviewCandidates\}/);
    assert.match(section, /listPromptImportFolderFiles/);
    assert.match(section, /previewPromptImportFolderFiles/);
    assert.match(section, /onCandidates\(result\.candidates\)/);
    assert.doesNotMatch(section, /commitPromptImport/);
    assert.match(dialog, /commitPromptImport\(\{ candidates: picked \}\)/);

    assert.match(api, /export type PromptGitHubFolderSource/);
    assert.match(api, /export type PromptGitHubFolderFile/);
    assert.match(api, /export type PromptImportFolderFilesResponse/);
    assert.match(api, /export type PromptImportFolderPreviewResponse/);
  });

  it("keeps folder preview payload limited to source input and selected paths", () => {
    const api = readSource("ui/src/lib/api.ts");
    const helper = api.slice(
      api.indexOf("export function previewPromptImportFolderFiles"),
      api.indexOf("export function exportPromptLibrary"),
    );

    assert.match(helper, /\/api\/prompts\/import\/folder-preview/);
    assert.match(helper, /source: \{ kind: "github-folder", input: payload\.source\.input \}/);
    assert.match(helper, /paths: payload\.paths/);
    assert.doesNotMatch(helper, /downloadUrl/);
    assert.doesNotMatch(helper, /htmlUrl/);
    assert.doesNotMatch(helper, /apiUrl/);
    assert.doesNotMatch(helper, /rawUrl/);
  });

  it("adds bounded folder list styling and translated copy", () => {
    const css = readSource("ui/src/index.css");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(css, /\.prompt-import-dialog__folder/);
    assert.match(css, /\.prompt-import-dialog__folder-list/);
    assert.match(css, /max-height:\s*148px/);
    assert.match(css, /overflow-y:\s*auto/);
    assert.match(css, /text-overflow:\s*ellipsis/);

    for (const dict of [en, ko]) {
      assert.equal(typeof dict.promptLibrary.folderBrowse, "string");
      assert.equal(typeof dict.promptLibrary.folderBrowseHint, "string");
      assert.equal(typeof dict.promptLibrary.folderFiles, "string");
      assert.equal(typeof dict.promptLibrary.folderPreviewSelected, "string");
      assert.equal(typeof dict.promptLibrary.folderSelectedCount, "string");
      assert.equal(typeof dict.promptLibrary.folderNoSelection, "string");
      assert.equal(typeof dict.promptLibrary.folderUnsupported, "string");
    }
  });
});
