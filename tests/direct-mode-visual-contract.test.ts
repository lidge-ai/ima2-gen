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

describe("direct mode visual contract", () => {
  it("marks direct mode on the prompt composer without overriding multimode", () => {
    const composer = readSource("ui/src/components/PromptComposer.tsx");

    assert.match(composer, /const isDirectMode = promptMode === "direct"/);
    assert.match(composer, /isDirectMode \? " composer--direct" : ""/);
    assert.match(composer, /multimode \? " composer--multimode" : ""/);
    assert.match(composer, /isDirectMode && multimode \? " composer--combined-modes" : ""/);
    assert.match(composer, /className="composer__direct-badge"/);
    assert.match(composer, /t\("prompt\.directModeActive"\)/);
    assert.match(composer, /providerUrlReference = useAppStore\(\(s\) => s\.providerUrlReference\)/);
    assert.match(composer, /setProviderUrlReference = useAppStore\(\(s\) => s\.setProviderUrlReference\)/);
    assert.match(composer, /className="composer__url-ref-badge"/);
    assert.match(composer, /onClick=\{\(\) => setProviderUrlReference\(null\)\}/);
    assert.match(composer, /t\("prompt\.urlRefActive"\)/);
    assert.match(composer, /aria-pressed=\{isDirectMode\}/);
  });

  it("styles direct mode separately from the multimode composer state", () => {
    const css = readSource("ui/src/index.css");

    assert.match(css, /\.composer--direct\s*\{/);
    assert.match(css, /\.composer__direct-badge\s*\{/);
    assert.match(css, /\.composer__url-ref-badge\s*\{/);
    assert.match(css, /\.composer__url-ref-dot\s*\{/);
    assert.match(css, /\.composer--multimode\s*\{/);
    assert.match(css, /\.composer--combined-modes\s*\{/);
    assert.match(css, /\.composer__mode-badge\s*\{/);
    assert.match(css, /\.composer__header-meta\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    assert.match(css, /\.composer__tool--on\s*\{/);
  });

  it("defines short direct mode active copy in both locales", () => {
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");

    assert.match(en, /"directModeActive":\s*"1:1 Direct on"/);
    assert.match(ko, /"directModeActive":\s*"1:1 Direct 켜짐"/);
    assert.match(en, /"urlRefActive":\s*"URL ref"/);
    assert.match(ko, /"urlRefActive":\s*"URL 참조"/);
    assert.match(en, /"urlRefActiveTitle":\s*"Provider URL reference is active/);
    assert.match(ko, /"urlRefActiveTitle":\s*"URL 참조가 활성화/);
  });

  it("keeps the URL reference active until the composer badge explicitly clears it", () => {
    const composer = readSource("ui/src/components/PromptComposer.tsx");
    const genStore = readSource("ui/src/store/storeGenImpl.ts");
    const videoStore = readSource("ui/src/store/storeVideoImpl.ts");

    assert.match(composer, /onClick=\{\(\) => setProviderUrlReference\(null\)\}/);
    assert.doesNotMatch(genStore, /providerUrlReference:\s*null/);
    assert.doesNotMatch(videoStore, /providerUrlReference:\s*null/);
  });

  it("clears stale URL references when the user picks a local reference path", () => {
    const refsStore = readSource("ui/src/store/storeReferenceImpl.ts");
    const uiStore = readSource("ui/src/store/storeUIImpl.ts");
    const continueHelper = readSource("ui/src/lib/continueFromItem.ts");

    assert.match(continueHelper, /store\.clearReferences\(\)/);
    assert.match(refsStore, /providerUrlReference:\s*null/);
    assert.match(uiStore, /providerUrlReference:\s*null/);
    assert.match(continueHelper, /setProviderUrlReference\(item\.providerUrl\)/);
  });
});
