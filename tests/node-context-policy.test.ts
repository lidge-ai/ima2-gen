import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readStoreBundle } from "./_storeBundle.mjs";

const route = (readFileSync("routes/nodes.ts", "utf-8") + readFileSync("lib/nodeGeneration.ts", "utf-8") + readFileSync("lib/nodeValidation.ts", "utf-8"));
// NOTE: lib/oauthProxy.ts was split into lib/oauthProxy/*.ts behind a facade.
const OAUTH_PROXY_SOURCES = [
  "lib/oauthProxy.ts",
  "lib/oauthProxy/types.ts",
  "lib/oauthProxy/prompts.ts",
  "lib/oauthProxy/references.ts",
  "lib/oauthProxy/errors.ts",
  "lib/oauthProxy/runtime.ts",
  "lib/oauthProxy/streams.ts",
  "lib/oauthProxy/generators.ts",
  "lib/oauthProxy/multimodeGenerators.ts",
  "lib/oauthProxy/index.ts",
];
const oauth = OAUTH_PROXY_SOURCES.map((p) => readFileSync(p, "utf-8")).join("\n");
const providerOptions = readFileSync("lib/providerOptions.ts", "utf-8");

describe("node context and edit search policy", () => {
  it("defaults node context to parent-plus-refs and rejects ancestry until implemented", () => {
    assert.match(route, /contextMode: rawContextMode = "parent-plus-refs"/);
    assert.match(route, /CONTEXT_MODE_UNSUPPORTED/);
  });

  it("defaults web_search on while honoring an explicit off switch", () => {
    assert.match(route, /searchMode: rawSearchMode = "on"/);
    assert.match(route, /resolveProviderOptions/);
    assert.match(providerOptions, /rawWebSearchEnabled !== false && searchMode !== "off"/);
    assert.match(providerOptions, /apiConfig\.allowWebSearch !== false/);
    assert.match(oauth, /resolveWebSearchEnabled/);
    assert.match(oauth, /\.\.\(webSearchEnabled \? \[\{ type: "web_search" \}\] : \[\]\)/);
    assert.match(oauth, /webSearchEnabled/);
  });

  it("forwards the selected provider from Node Mode requests", () => {
    const store = readStoreBundle();
    const nodePayload = /postNodeGenerateStream\(\{\s*[\s\S]*?\},\s*\{/.exec(store)?.[0] ?? "";
    // Branch variants carry per-node overrides; the payload uses them and the
    // fallback chain still lands on the globally selected provider/model.
    assert.match(nodePayload, /provider:\s*nodeProvider/);
    assert.match(nodePayload, /model:\s*nodeModel/);
    assert.match(store, /node\.data\.provider[\s\S]{0,120}: s\.provider/);
    assert.match(store, /node\.data\.model[\s\S]{0,120}: s\.imageModel/);
  });

  it("logs safe context shape instead of raw prompts or images", () => {
    assert.match(route, /inputImageCount/);
    assert.match(route, /parentImagePresent/);
    assert.match(route, /webSearchEnabled/);
    assert.match(oauth, /inputImageCount: 1 \+ references\.length/);
    assert.doesNotMatch(oauth, /logEvent\("oauth-edit", "request", \{[^}]*prompt/);
  });
});
