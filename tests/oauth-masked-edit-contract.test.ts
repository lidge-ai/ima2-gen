import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

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
const proxy = OAUTH_PROXY_SOURCES.map((p) => fs.readFileSync(p, "utf8")).join("\n");
const cfg = fs.readFileSync("config.ts", "utf8");

test("config exposes oauth.maskedEditEnabled flag", () => {
  assert.match(cfg, /maskedEditEnabled/);
  assert.match(cfg, /IMA2_OAUTH_MASKED_EDIT_ENABLED/);
});

test("editViaOAuth gates mask path on flag, never silently strips mask", () => {
  assert.match(proxy, /maskedEditEnabled/);
  assert.match(proxy, /EDIT_MASK_NOT_SUPPORTED/);
  assert.doesNotMatch(proxy, /retry.*without.*mask/i);
  assert.doesNotMatch(proxy, /fall ?back.*mask/i);
});

// TODO(#31 STEP-0): re-enable when upstream mask wiring lands

