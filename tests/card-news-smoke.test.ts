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

describe("Card News smoke flow contract", () => {
  it("keeps the template, draft, job, retry, and reopen API wiring intact", () => {
    const api = readSource("ui/src/lib/cardNewsApi.ts");
    const store = readSource("ui/src/store/cardNewsStore.ts");
    const routes = readSource("routes/cardNews.ts");

    assert.match(api, /export function listCardNewsImageTemplates/);
    assert.match(api, /export function listCardNewsRoleTemplates/);
    assert.match(api, /export async function draftCardNews/);
    assert.match(api, /export function startCardNewsJob/);
    assert.match(api, /export function getCardNewsJob/);
    assert.match(api, /export function getCardNewsSet/);
    assert.match(api, /export async function regenerateCardNewsCard/);

    assert.match(store, /async hydrate\(\)/);
    assert.match(store, /async draft\(\)/);
    assert.match(store, /async generateSet\(\)/);
    assert.match(store, /function applyJobSummary/);
    assert.match(store, /async retryCard\(cardId\)/);
    assert.match(store, /async loadSet\(setId\)/);

    assert.match(routes, /app\.post\("\/api\/cardnews\/draft"/);
    assert.match(routes, /app\.post\("\/api\/cardnews\/jobs"/);
    assert.match(routes, /app\.get\("\/api\/cardnews\/jobs\/:jobId"/);
    assert.match(routes, /app\.get\("\/api\/cardnews\/sets\/:setId"/);
  });

  it("keeps the visible Card News workspace surfaces wired", () => {
    const workspace = readSource("ui/src/components/card-news/CardNewsWorkspace.tsx");
    const composer = readSource("ui/src/components/card-news/CardNewsComposer.tsx");
    const stage = readSource("ui/src/components/card-news/CardStage.tsx");
    const deck = readSource("ui/src/components/card-news/CardDeckRail.tsx");
    const batchBar = readSource("ui/src/components/card-news/CardNewsBatchBar.tsx");
    const statusBadge = readSource("ui/src/components/card-news/CardStatusBadge.tsx");
    const inspector = readSource("ui/src/components/card-news/CardInspector.tsx");

    assert.match(workspace, /ImageTemplatePicker/);
    assert.match(workspace, /RoleTemplatePicker/);
    assert.match(workspace, /CardStage/);
    assert.match(workspace, /CardInspector/);

    assert.match(composer, /useCardNewsStore\(\(s\) => s\.draft\)/);
    assert.match(composer, /useCardNewsStore\(\(s\) => s\.generateSet\)/);
    assert.match(composer, /void draft\(\)/);
    assert.match(composer, /void generateSet\(\)/);

    assert.match(stage, /card-news-stage-overlay/);
    assert.match(stage, /renderMode === "in-image"/);
    assert.match(stage, /card\.url/);
    assert.match(stage, /retryCard\(card\.id\)/);

    assert.match(deck, /card\.url/);
    assert.match(deck, /CardStatusBadge/);

    assert.match(batchBar, /summary\.queued/);
    assert.match(batchBar, /summary\.errors/);
    assert.match(batchBar, /summary\.skipped/);

    assert.match(statusBadge, /display === "queued" \|\| display === "generating"/);
    assert.match(statusBadge, /card-news-spinner/);

    assert.match(inspector, /TextFieldCard/);
    assert.match(inspector, /retryCard\(card\.id\)/);
  });

  it("keeps gallery set reopen wired to Card News mode", () => {
    const gallery = readSource("ui/src/components/GalleryModal.tsx");

    assert.match(gallery, /handleOpenCardNewsSet/);
    assert.match(gallery, /loadSet\(item\.setId\)/);
    assert.match(gallery, /setUIMode\("card-news"\)/);
    assert.match(gallery, /item\.kind === "card-news-set"/);
    assert.match(gallery, /gallery-card-news-set/);
  });

  it("keeps manual smoke QA covered by tracked source contracts", () => {
    const en = readSource("ui/src/i18n/en.json");
    const composer = readSource("ui/src/components/card-news/CardNewsComposer.tsx");
    const stage = readSource("ui/src/components/card-news/CardStage.tsx");
    const gallery = readSource("ui/src/components/GalleryModal.tsx");
    const smokeTest = readSource("tests/card-news-smoke.test.ts");

    for (const phrase of [
      "Draft outline",
      "Batch generate",
      "Retry this card",
      "Open image",
      "Download",
      "Card News set path copied.",
    ]) {
      assert.match(en, new RegExp(phrase));
    }

    assert.match(composer, /t\("cardNews\.draft"\)/);
    assert.match(composer, /t\("cardNews\.batchGenerate"\)/);
    assert.match(stage, /t\("cardNews\.retryCard"\)/);
    assert.match(stage, /t\("cardNews\.actions\.openImage"\)/);
    assert.match(stage, /t\("cardNews\.actions\.downloadCard"\)/);
    assert.match(gallery, /handleOpenCardNewsSet/);
    assert.match(gallery, /setUIMode\("card-news"\)/);

    assert.doesNotMatch(smokeTest, new RegExp("await\\s+" + "generateCardNews\\("));
    assert.doesNotMatch(smokeTest, new RegExp("await\\s+" + "startCardNewsJob\\("));
  });
});
