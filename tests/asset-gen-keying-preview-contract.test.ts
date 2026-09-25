import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSourceTree } from "./_readTree.mjs";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

describe("Asset Gen keyed preview contract", () => {
  it("renders an accessible original and keyed two-up comparison", () => {
    const panel = read("ui/src/components/assetgen/KeyingPanel.tsx");

    assert.match(panel, /className="keying-panel__compare"/);
    assert.match(panel, /t\("keying\.original"\)/);
    assert.match(panel, /alt=\{t\("keying\.originalAlt"\)\}/);
    assert.match(panel, /t\("keying\.removed"\)/);
    assert.match(panel, /aria-label=\{t\("keying\.previewAlt"\)\}/);
    assert.match(panel, /role="status">\{t\("keying\.previewLoading"\)\}/);
  });

  it("offers click-to-erase with undo, scoped to images and reset-safe", () => {
    const panel = read("ui/src/components/assetgen/KeyingPanel.tsx");

    assert.match(panel, /eraseSeedRegions\(/);
    assert.match(panel, /clickMode === "erase" && !isVideo/);
    assert.match(panel, /setEraseSeeds\(\(seeds\) => \[\.\.\.seeds, \{ x: nx, y: ny \}\]\)/);
    assert.match(panel, /setEraseSeeds\(\(seeds\) => seeds\.slice\(0, -1\)\)/);
    assert.match(panel, /t\("keying\.modeErase"\)/);
    assert.match(panel, /t\("keying\.modePick"\)/);
    assert.match(panel, /aria-pressed=\{clickMode === "erase"\}/);
    // New image loads and Reset both clear accumulated wand clicks.
    assert.equal((panel.match(/setEraseSeeds\(\[\]\)/g) ?? []).length, 2);
  });

  it("turns image and video save completions into unique derived result items", () => {
    const panel = read("ui/src/components/assetgen/KeyingPanel.tsx");
    const store = readSourceTree("ui/src/store/useAppStore.ts");

    assert.match(panel, /const url = `\/generated\/\$\{encodeURIComponent\(filePath\)\}`/);
    assert.match(panel, /requestId: `derived:\$\{filePath\}`/);
    assert.match(panel, /kind: "edit"/);
    assert.match(panel, /makeDerivedItem\(item, filePath\.trim\(\), "image"\)/);
    assert.match(panel, /makeDerivedItem\(item, filePath\.trim\(\), "video"\)/);
    assert.match(panel, /typeof filePath === "string" && filePath\.trim\(\)/);
    assert.match(panel, /showToast\(t\("keying\.videoSaved"\)\);\s*close\(null\);\s*return;/s);
    assert.match(panel, /setKeyingProgress\(null\);\s*setSaveError\(t\("keying\.saveError"\)\)/s);
    assert.match(store, /addAssetGenDerivedItem: \(item\) => set\(\(state\) =>/);
    assert.match(store, /state\.assetGenItems\.some\(\(entry\) => entry\.filename === item\.filename\)/);
  });

  it("cleans up async work and validates runtime payloads", () => {
    const panel = read("ui/src/components/assetgen/KeyingPanel.tsx");

    assert.match(panel, /let active = true/);
    assert.match(panel, /active = false/);
    assert.match(panel, /img\.onload = null/);
    assert.match(panel, /keyingUnsubRef = useRef/);
    assert.match(panel, /targetFilenameRef = useRef/);
    assert.match(panel, /clearKeyingSubscription\(\);\s*setSaving\(false\)/s);
    assert.equal((panel.match(/targetFilenameRef\.current !== item\.filename/g) ?? []).length, 5);
    assert.match(panel, /targetFilenameRef\.current === item\.filename\) setSaving\(false\)/);
    assert.match(panel, /typeof rawMs === "number" && Number\.isFinite\(rawMs\)/);
    assert.match(panel, /typeof payload\.error === "string"/);
    assert.match(panel, /typeof filePath !== "string" \|\| !filePath\.trim\(\)/);
  });

  it("marks derived cards and prevents recursive keying or source-save retries", () => {
    const workspace = read("ui/src/components/assetgen/AssetGenWorkspace.tsx");

    assert.match(workspace, /const isKeyed = item\.kind === "edit"/);
    assert.match(workspace, /assetgen-tile\$\{isKeyed \? " is-keyed" : ""\}/);
    assert.match(workspace, /t\("keying\.resultBadge"\)/);
    // Transparent generations already carry alpha, so they are excluded from
    // the keying offer alongside already-keyed derivatives (260821).
    assert.match(workspace, /const isAlpha = item\.backgroundPreset === "transparent"/);
    assert.match(workspace, /\{!isKeyed && !isAlpha \? \(/);
    assert.match(workspace, /!isKeyed && item\.requestId && saveFailures\.includes/);
  });

  it("keeps the two-up and transparent card checkerboards responsive", () => {
    const css = read("ui/src/styles/assetgen-workspace.css");

    assert.match(css, /\.keying-panel__compare\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
    assert.match(css, /\.keying-panel__preview\s*\{[^}]*min-width:\s*0/s);
    assert.match(css, /\.keying-panel\s*\{[^}]*overflow-y:\s*auto/s);
    assert.match(css, /\.assetgen-tile\.is-keyed \.assetgen-tile__media\s*\{[^}]*repeating-conic-gradient/s);
    assert.match(css, /\.assetgen-tile\.is-alpha \.assetgen-tile__media\s*\{[^}]*repeating-conic-gradient/s);
    assert.match(css, /@media \(max-width: 480px\)/);
  });

  it("balances Asset Gen headings and bounds empty copy", () => {
    const css = read("ui/src/styles/assetgen-workspace.css");
    assert.match(css, /\.assetgen-form h1\s*\{[^}]*text-wrap:\s*balance/s);
    assert.match(css, /\.assetgen-form__lede\s*\{[^}]*text-wrap:\s*balance/s);
    assert.match(css, /\.assetgen-empty p\s*\{[^}]*max-width:\s*40ch[^}]*text-wrap:\s*balance/s);
  });

  it("keeps workflow tabs separated, touch-safe, and keyboard reachable", () => {
    const workspace = read("ui/src/components/assetgen/AssetGenWorkspace.tsx");
    const css = read("ui/src/styles/sprite-recipe.css");

    assert.match(workspace, /styles\/sprite-recipe\.css/);
    assert.match(workspace, /useTablistKeys<HTMLDivElement>\(\)/);
    assert.match(workspace, /onKeyDown=\{onWorkflowTabKeyDown\}/);
    assert.equal((workspace.match(/tabIndex=\{workflow ===/g) ?? []).length, 2);
    assert.match(css, /\.assetgen-workflow-tabs\s*\{[^}]*gap:\s*6px/s);
    assert.match(css, /\.assetgen-workflow-tabs button,[\s\S]*?min-height:\s*44px/);
    assert.match(css, /\.assetgen-workflow-tabs button\[aria-selected="true"\]/);
    assert.match(css, /\.assetgen-workflow-tabs button:focus-visible/);
    assert.match(css, /@media \(max-width: 480px\)[\s\S]*?width:\s*100%;/);
    assert.match(css, /@media \(max-width: 480px\)[\s\S]*?flex:\s*1 1 0;/);
  });

  it("carries comparison labels in both locales", () => {
    const locales = ["en", "ko"].map((locale) => JSON.parse(read(`ui/src/i18n/${locale}.json`)));
    for (const locale of locales) {
      assert.equal(typeof locale.keying.original, "string");
      assert.equal(typeof locale.keying.originalAlt, "string");
      assert.equal(typeof locale.keying.removed, "string");
      assert.equal(typeof locale.keying.previewLoading, "string");
      assert.equal(typeof locale.keying.resultBadge, "string");
    }
  });
});
