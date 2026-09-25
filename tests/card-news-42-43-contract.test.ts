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

describe("Card News 42/43 editor and reopen contract", () => {
  it("keeps text field selection shared between stage and inspector", () => {
    const store = readSource("ui/src/store/cardNewsStore.ts");
    const stage = readSource("ui/src/components/card-news/CardStage.tsx");
    const inspector = readSource("ui/src/components/card-news/CardInspector.tsx");
    const textFieldCard = readSource("ui/src/components/card-news/TextFieldCard.tsx");
    const plannerPrompt = readSource("lib/cardNewsPlannerPrompt.ts");
    const css = readSource("ui/src/index.css");

    assert.match(store, /selectedTextFieldId: string \| null/);
    assert.match(store, /selectTextField: \(fieldId: string \| null\) => void/);
    assert.match(store, /selectCard\(id\)/);
    assert.match(store, /selectedTextFieldId: null/);
    assert.match(stage, /selectedTextFieldId/);
    assert.match(stage, /selectTextField\(field\.id\)/);
    assert.match(stage, /fallbackFieldStyle/);
    assert.match(stage, /cardNews\.selectTextField/);
    assert.match(stage, /card-news-empty__deck/);
    assert.match(stage, /card-news-empty__copy/);
    assert.match(css, /\.card-news-empty__copy h2\s*\{[^}]*text-wrap:\s*balance/s);
    assert.match(css, /\.card-news-stage__header > div\s*\{[^}]*min-width:\s*0/s);
    assert.match(css, /\.card-news-stage__header h2\s*\{[^}]*overflow-wrap:\s*break-word[^}]*text-wrap:\s*balance/s);
    assert.match(inspector, /selectedTextFieldId === field\.id/);
    assert.match(inspector, /onSelect=\{\(\) => selectTextField\(field\.id\)\}/);
    assert.match(inspector, /card-news-advanced-prompt/);
    assert.match(inspector, /cardNews\.cardTitle/);
    assert.match(inspector, /card-news-inspector-empty__mock/);
    assert.doesNotMatch(inspector, /cardNews\.body/);
    assert.match(textFieldCard, /selected\?: boolean/);
    assert.match(textFieldCard, /className=\{`card-news-text-field-card\$\{selected/);
    assert.doesNotMatch(stage, /card-news-preview__copy/);
    assert.doesNotMatch(stage, /card\.body, \.\.\.visible/);
    assert.match(plannerPrompt, /headline, body, textFields, and visualPrompt/);
    assert.match(css, /\.card-news-text-field-card\.selected/);
    assert.match(css, /\.card-news-stage-overlay__field\.selected/);
    assert.match(css, /\.card-news-empty__deck/);
    assert.match(css, /\.card-news-inspector-empty__mock/);
  });

  it("exposes safe manifest download and richer set metadata", () => {
    const manifestStore = readSource("lib/cardNewsManifestStore.ts");
    const cardNewsPath = readSource("lib/cardNewsPath.ts");
    const routes = readSource("routes/cardNews.ts");
    const cardNewsApi = readSource("ui/src/lib/cardNewsApi.ts");
    const api = readSource("ui/src/lib/api.ts");
    const types = readSource("ui/src/types.ts");

    assert.match(cardNewsPath, /function assertSafeSetId/);
    assert.match(cardNewsPath, /CARD_NEWS_SET_NOT_FOUND/);
    assert.match(manifestStore, /resolveCardNewsSetDir/);
    assert.match(manifestStore, /export async function readCardNewsManifest/);
    assert.match(manifestStore, /manifestUrl/);
    assert.match(manifestStore, /folderLabel/);
    assert.match(manifestStore, /imageFilename: card\.imageFilename/);
    assert.match(routes, /readCardNewsManifest/);
    assert.match(routes, /\/api\/cardnews\/sets\/:setId\/manifest/);
    assert.match(routes, /download === "1"/);
    assert.match(routes, /Content-Disposition/);
    assert.match(cardNewsApi, /cardNewsManifestDownloadUrl/);
    assert.match(api, /imageFilename\?: string/);
    assert.match(types, /imageFilename\?: string/);
  });

  it("adds gallery set actions without replacing reopen behavior", () => {
    const gallery = readSource("ui/src/components/GalleryModal.tsx");
    const tile = readSource("ui/src/components/CardNewsGalleryTile.tsx");
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");
    const css = readSource("ui/src/index.css");

    assert.match(gallery, /cardNewsManifestDownloadUrl/);
    assert.match(gallery, /handleCopyCardNewsSetPath/);
    assert.match(gallery, /handleDownloadCardNewsManifest/);
    assert.match(gallery, /generated\/cardnews\/\$\{item\.setId\}/);
    assert.match(gallery, /CardNewsGalleryTile/);
    assert.match(tile, /gallery-card-news-actions/);
    assert.match(tile, /item\.cards/);
    assert.match(tile, /leadHeadline/);
    assert.match(gallery, /handleOpenCardNewsSet\(next\)/);
    assert.match(css, /\.gallery-card-news-actions/);
    assert.match(css, /\.gallery-card-news-strip img/);
    for (const source of [en, ko]) {
      assert.match(source, /copyCardNewsSetPath/);
      assert.match(source, /cardNewsPathCopied/);
      assert.match(source, /downloadCardNewsManifest/);
      assert.match(source, /cardNewsCount/);
      assert.match(source, /selectTextField/);
    }
  });
});
