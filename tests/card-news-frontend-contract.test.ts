import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

describe("Card News frontend dev MVP contract", () => {
  it("exposes Card News mode only through the dev feature gate", () => {
    const devMode = readSource("ui/src/lib/devMode.ts");
    const modes = readSource("ui/src/types.ts");
    const navRail = readSource("ui/src/components/NavRail.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    const storeUI = readSource("ui/src/store/storeUIImpl.ts");

    assert.match(devMode, /export const ENABLE_CARD_NEWS_MODE/);
    assert.match(devMode, /IS_DEV_UI && import\.meta\.env\.VITE_IMA2_CARD_NEWS !== "0"/);
    assert.match(devMode, /VITE_IMA2_CARD_NEWS/);
    assert.match(devMode, /VITE_IMA2_DEV/);
    assert.doesNotMatch(devMode, /VITE_IMA2_CARD_NEWS === "1"/);
    assert.match(modes, /"classic" \| "node" \| "card-news"/);
    assert.match(navRail, /setUIMode\(item\.mode\)/);
    assert.match(store, /setUIMode: \(m\) => setUIModeImpl\(m, set\)/);
    assert.match(storeUI, /m === "card-news" && !ENABLE_CARD_NEWS_MODE/);
  });

  it("renders the Card News workspace and composer without Node fallthrough", () => {
    const app = readSource("ui/src/App.tsx");
    const sidebar = readSource("ui/src/components/Sidebar.tsx");

    assert.match(app, /CardNewsWorkspace/);
    assert.match(app, /uiMode === "card-news"/);
    assert.match(app, /uiMode === "card-news" \? null : uiMode === "assets" \? null : uiMode === "asset-gen" \? null : uiMode === "home" \? null : <RightPanel \/>/);
    assert.match(sidebar, /CardNewsComposer/);
    assert.match(sidebar, /uiMode === "card-news"/);
    assert.match(sidebar, /<CardNewsComposer \/>/);
  });

  it("uses a dedicated Card News API and store for JSON-first draft then batch generation", () => {
    const api = readSource("ui/src/lib/cardNewsApi.ts");
    const store = readSource("ui/src/store/cardNewsStore.ts");
    const composer = readSource("ui/src/components/card-news/CardNewsComposer.tsx");

    assert.match(api, /\/api\/cardnews\/image-templates/);
    assert.match(api, /\/api\/cardnews\/draft/);
    assert.match(api, /\/api\/cardnews\/generate/);
    assert.match(api, /\/api\/cardnews\/jobs/);
    assert.match(api, /\/api\/cardnews\/cards\/\$\{encodeURIComponent\(payload\.card\.id\)\}\/regenerate/);
    assert.match(api, /\/api\/cardnews\/sets\/\$\{encodeURIComponent\(setId\)\}/);
    assert.match(api, /CardNewsCardStatus/);
    assert.match(api, /CardNewsTextField/);
    assert.match(api, /textFields: CardNewsTextField\[\]/);
    assert.match(api, /recommendedOutputSizes: string\[\]/);
    assert.match(api, /authoringLabel: string/);
    assert.match(api, /normalizeCardNewsPlan/);
    assert.match(api, /\| "generating"/);
    assert.match(store, /draftCardNews/);
    assert.match(store, /startCardNewsJob/);
    assert.match(store, /getCardNewsJob/);
    assert.match(store, /applyJobSummary/);
    assert.match(store, /regenerateCardNewsCard/);
    assert.match(store, /getCardNewsSet/);
    assert.match(store, /plannerMeta/);
    assert.match(store, /getGenerationSummary/);
    assert.match(store, /retryCard/);
    assert.match(store, /loadSet/);
    assert.match(store, /function mergeGeneratedCard/);
    assert.match(store, /updateTextField/);
    assert.match(store, /addTextField/);
    assert.match(store, /removeTextField/);
    assert.match(store, /textFields: Array\.isArray\(generated\.textFields\) \? generated\.textFields : card\.textFields/);
    assert.match(store, /textFields: Array\.isArray\(jobCard\.textFields\) \? jobCard\.textFields : card\.textFields/);
    assert.match(store, /status = generated\.status/);
    assert.match(store, /outputSizePreset/);
    assert.match(store, /resolvedOutputSize/);
    assert.match(store, /topic: ""/);
    assert.match(store, /activePlan/);
    assert.match(store, /startCardNewsJob/);
    assert.match(store, /getCardNewsJob/);
    assert.match(store, /while \(\["queued", "running"\]\.includes\(summary\.status\)\)/);
    assert.match(composer, /1024²/);
    assert.match(composer, /2048²/);
    assert.match(composer, /cardNews\.outputSize/);
  });

  it("shows template authoring metadata in the image template picker", () => {
    const picker = readSource("ui/src/components/card-news/ImageTemplatePicker.tsx");
    const css = readSource("ui/src/index.css");

    assert.match(picker, /summarizeSlots/);
    assert.match(picker, /template\.recommendedOutputSizes\.join/);
    assert.match(picker, /card-news-template__meta/);
    assert.match(picker, /card-news-template__sizes/);
    assert.match(css, /\.card-news-template__body/);
    assert.match(css, /\.card-news-template__sizes/);
  });

  it("renders 0.21 delivery, progress, planner, and retry surfaces", () => {
    const stage = readSource("ui/src/components/card-news/CardStage.tsx");
    const deck = readSource("ui/src/components/card-news/CardDeckRail.tsx");
    const inspector = readSource("ui/src/components/card-news/CardInspector.tsx");
    const batchBar = readSource("ui/src/components/card-news/CardNewsBatchBar.tsx");
    const composer = readSource("ui/src/components/card-news/CardNewsComposer.tsx");
    const statusBadge = readSource("ui/src/components/card-news/CardStatusBadge.tsx");
    const plannerBadge = readSource("ui/src/components/card-news/PlannerMetaBadge.tsx");
    const textFieldCard = readSource("ui/src/components/card-news/TextFieldCard.tsx");
    const placementBadge = readSource("ui/src/components/card-news/PlacementBadge.tsx");
    const css = readSource("ui/src/index.css");

    assert.match(stage, /CardNewsBatchBar/);
    assert.match(stage, /PlannerMetaBadge/);
    assert.match(stage, /card-news-stage-overlay/);
    assert.match(stage, /textFields/);
    assert.match(stage, /cardNews\.actions\.copyPrompt/);
    assert.match(stage, /cardNews\.actions\.openImage/);
    assert.match(stage, /retryCard/);
    assert.match(composer, /card-news-inline-status/);
    assert.match(composer, /card-news-spinner/);
    assert.match(deck, /CardStatusBadge/);
    assert.match(deck, /card\.url/);
    assert.match(deck, /roleLabel/);
    assert.match(inspector, /TextFieldCard/);
    assert.match(inspector, /updateTextField/);
    assert.match(inspector, /addTextField/);
    assert.match(inspector, /removeTextField/);
    assert.match(inspector, /generatedMeta/);
    assert.match(inspector, /lockedHelp/);
    assert.match(batchBar, /summary\.queued/);
    assert.match(batchBar, /cardNews\.progress\.summary/);
    assert.match(batchBar, /const EMPTY_CARDS/);
    assert.match(batchBar, /activePlan\?\.cards \?\? EMPTY_CARDS/);
    assert.doesNotMatch(batchBar, /useCardNewsStore\(\(s\) => s\.getGenerationSummary\(\)\)/);
    assert.doesNotMatch(batchBar, /activePlan\?\.cards \|\| \[\]/);
    assert.doesNotMatch(composer, /useCardNewsStore\(\(s\) => s\.getGenerationSummary\(\)\)/);
    assert.match(statusBadge, /display === "queued" \|\| display === "generating"/);
    assert.match(statusBadge, /card-news-spinner/);
    assert.match(statusBadge, /cardNews\.status\.\$\{display\}/);
    assert.match(plannerBadge, /cardNews\.planner\.structured/);
    assert.match(plannerBadge, /cardNews\.planner\.jsonMode/);
    assert.match(plannerBadge, /cardNews\.planner\.fallback/);
    assert.match(css, /\.card-news-status-badge/);
    assert.match(css, /\.card-news-batch-bar/);
    assert.match(css, /\.card-news-inline-status/);
    assert.match(css, /\.card-news-result-actions/);
    assert.match(css, /\.card-news-text-field-card/);
    assert.match(css, /\.card-news-stage-overlay/);
    assert.match(textFieldCard, /source: "user"/);
    assert.match(textFieldCard, /disabled=\{locked\}/);
    assert.match(placementBadge, /placementLabel/);
  });

  it("preserves Card News set metadata through gallery history mapping", () => {
    const appStore = readSource("ui/src/store/useAppStore.ts");
    const gallery = readSource("ui/src/components/GalleryModal.tsx");
    const galleryTile = readSource("ui/src/components/CardNewsGalleryTile.tsx");
    const api = readSource("ui/src/lib/api.ts");
    const types = readSource("ui/src/types.ts");

    assert.match(api, /setId\?: string \| null/);
    assert.match(types, /"card-news-card" \| "card-news-set"/);
    assert.match(types, /cards\?: Array/);
    assert.match(appStore, /function mapHistoryItem/);
    assert.match(appStore, /setId: it\.setId/);
    assert.match(appStore, /cards: it\.cards/);
    assert.match(gallery, /useCardNewsStore/);
    assert.match(gallery, /loadSet\(item\.setId\)/);
    assert.match(gallery, /setUIMode\("card-news"\)/);
    assert.match(gallery, /gallery-card-news-set/);
    assert.match(gallery, /CardNewsGalleryTile/);
    assert.match(galleryTile, /item\.cards/);
  });

  it("keeps the Card News layout responsive inside the existing app shell", () => {
    const css = readSource("ui/src/index.css");
    const workspaceRule = /\.card-news-workspace\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(workspaceRule, /minmax\(160px, 220px\) minmax\(0, 1fr\) minmax\(200px, 260px\)/);
    assert.match(css, /@media \(max-width: 1180px\)/);
  });

  it("has localized Card News UI copy", () => {
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");

    for (const source of [ko, en]) {
      assert.match(source, /"cardNews"/);
      assert.match(source, /"imageTemplate"/);
      assert.match(source, /"roleTemplate"/);
      assert.match(source, /"draft"/);
      assert.match(source, /"batchGenerate"/);
      assert.match(source, /"outputSize"/);
      assert.match(source, /"status"/);
      assert.match(source, /"progress"/);
      assert.match(source, /"planner"/);
      assert.match(source, /"textFields"/);
      assert.match(source, /"cardTitle"/);
      assert.match(source, /"placements"/);
      assert.match(source, /"textKinds"/);
      assert.match(source, /"renderModes"/);
      assert.match(source, /"hierarchy"/);
      assert.match(source, /"roles"/);
      for (const key of ["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right", "free"]) {
        assert.match(source, new RegExp(`"${key}"`));
      }
    }
    assert.match(ko, /"openCardNewsSet"/);
    assert.match(en, /"openCardNewsSet"/);
    assert.doesNotMatch(en, /Draft with Codex/);
  });
});
