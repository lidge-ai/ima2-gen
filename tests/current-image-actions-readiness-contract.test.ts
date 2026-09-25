import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

describe("current image actions and readiness popup contract", () => {
  it("adds a visible first-node button instead of hiding #59 in More", () => {
    const actions = readSource("ui/src/components/ResultActions.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");

    assert.match(actions, /createRootNodeFromHistoryItem/);
    assert.match(actions, /generateAsFirstNode/);
    assert.match(actions, /result\.firstNode/);
    assert.match(store, /createRootNodeFromHistoryItem: \(item: GenerateItem\) => ClientNodeId/);
    assert.match(store, /uiMode: "node"/);
    assert.match(store, /status: "ready"/);
    assert.match(en, /"firstNode":\s*"First node"/);
    assert.match(ko, /"firstNode":\s*"첫 노드"/);
  });

  it("keeps #65 readiness as an on-demand popup", () => {
    const app = readSource("ui/src/App.tsx");
    const popup = readSource("ui/src/components/ProviderReadinessPopup.tsx");
    const button = readSource("ui/src/components/GenerateButton.tsx");
    const settings = readSource("ui/src/components/SettingsWorkspace.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    const css = readSource("ui/src/index.css");

    assert.match(app, /<ProviderReadinessPopup \/>/);
    assert.match(popup, /role="dialog"/);
    assert.match(popup, /useProviderAvailability/);
    assert.match(button, /openReadinessPopup/);
    assert.match(settings, /openReadinessPopup/);
    assert.match(store, /readinessPopupOpen: boolean/);
    assert.match(css, /\.provider-readiness/);
    assert.match(css, /\.generate-row__readiness/);
  });

  it("shows Continue as URL only for fresh Grok provider URLs", () => {
    const actions = readSource("ui/src/components/ResultActions.tsx");
    const store = readSource("ui/src/store/storeGenImpl.ts");
    const route = (readSource("routes/generate.ts") + readSource("lib/generatePipeline.ts"));

    assert.match(actions, /providerUrlAlive/);
    assert.match(actions, /actionImage\.providerUrl/);
    assert.match(actions, /PROVIDER_URL_TTL_MS = 3_600_000/);
    assert.match(actions, /!isVideo/);
    assert.match(actions, /Date\.now\(\) - actionImage\.createdAt < PROVIDER_URL_TTL_MS/);
    assert.match(actions, /Date\.now\(\) - actionImage\.createdAt >= PROVIDER_URL_TTL_MS/);
    assert.match(actions, /continueFromItemAsUrl/);
    assert.match(route, /providerUrl: firstImage\.providerUrl \?\? null/);
    assert.match(route, /\.\.\.\(providerUrl \? \{ providerUrl \} : \{\}\)/);
    assert.match(store, /providerUrl: res\.providerUrl \?\? null/);
    assert.match(store, /createdAt: res\.createdAt \?\? Date\.now\(\)/);
  });
});
