import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const quota = ["QuotaCard.tsx", "SwitchAccountButton.tsx", "useAccountSwitch.ts"]
  .map((file) => read(`ui/src/components/settings/${file}`)).join("\n");
const apiKey = read("ui/src/components/ApiKeyInput.tsx");
const vertex = read("ui/src/components/VertexJsonInput.tsx");
const locales = ["en", "ko", "zh-Hant", "zh-Hans"].map((locale) => JSON.parse(read(`ui/src/i18n/${locale}.json`)));

describe("settings i18n state contract", () => {
  it("localizes every account-switch phase and copied state", () => {
    for (const phase of ["idle", "starting", "waiting", "complete", "error"]) {
      assert.match(quota, new RegExp(`state\\.phase === "${phase}"`));
    }
    for (const key of [
      "switchAccount", "startingLogin", "enterCode", "retry", "copyLink", "copied",
      "waitingApproval", "switchComplete", "switchFailed", "tryAgain", "codexNotLoggedIn",
    ]) {
      assert.match(quota, new RegExp(`settings\\.quota\\.${key}`), `QuotaCard missing ${key}`);
    }
    assert.doesNotMatch(quota, /Starting login|Enter this code|Waiting for approval|Switch failed|Try again|Not logged in/);
  });

  it("localizes API key and Vertex failure/configured branches", () => {
    for (const [source, label] of [[apiKey, "ApiKeyInput"], [vertex, "VertexJsonInput"]] as const) {
      assert.match(source, /settings\.apiKeys\.saveFailed/, `${label} missing save fallback`);
      assert.match(source, /settings\.apiKeys\.networkError/, `${label} missing network fallback`);
      assert.match(source, /settings\.apiKeys\.removeFailed/, `${label} missing remove fallback`);
      assert.doesNotMatch(source, /Failed to save|Network error|Failed to remove/);
    }
    assert.match(vertex, /settings\.apiKeys\.configuredReplace/);
    assert.doesNotMatch(vertex, /configured — click to replace/);
  });

  it("keeps every new settings key symmetric across locales", () => {
    for (const locale of locales) {
      for (const key of [
        "switchAccount", "startingLogin", "enterCode", "retry", "copyLink", "copied",
        "waitingApproval", "switchComplete", "switchFailed", "tryAgain",
      ]) assert.equal(typeof locale.settings.quota[key], "string", `settings.quota.${key}`);
      for (const key of ["saveFailed", "networkError", "removeFailed", "configuredReplace"]) {
        assert.equal(typeof locale.settings.apiKeys[key], "string", `settings.apiKeys.${key}`);
      }
    }
  });
});
