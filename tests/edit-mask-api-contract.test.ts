import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectCallArguments } from "./_executionImportEdges.mjs";

const root = process.cwd();

// NOTE: lib/oauthProxy.ts was split into lib/oauthProxy/*.ts behind a 1-line
// facade. Contract assertions that previously matched against the monolithic
// file now match against all split sources concatenated.
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

function readSource(path) {
  if (path === "lib/oauthProxy.ts") {
    return OAUTH_PROXY_SOURCES.map((p) => readFileSync(join(root, p), "utf8")).join("\n");
  }
  return readFileSync(join(root, path), "utf8");
}

describe("edit mask API contract", () => {
  it("validates optional PNG alpha masks before provider calls", () => {
    const route = readSource("routes/edit.ts");
    assert.match(route, /mask: rawMask/);
    assert.match(route, /validateEditMask/);
    assert.match(route, /INVALID_EDIT_MASK_BASE64/);
    assert.match(route, /INVALID_EDIT_MASK_PNG/);
    assert.match(route, /EDIT_MASK_TOO_LARGE/);
    assert.match(route, /EDIT_MASK_NO_ALPHA/);
    assert.match(route, /EDIT_MASK_DIMENSION_MISMATCH/);
    assert.match(route, /maskPresent/);
    assert.match(route, /maskBytes/);
    assert.doesNotMatch(route, /rawMask[\s\S]{0,120}logEvent/);
  });

  it("routes validated masks through the Responses adapter as guided edits", () => {
    const route = readSource("routes/edit.ts");
    const adapter = readSource("lib/providers/adapters/openaiOperations.ts");
    const oauth = readSource("lib/oauthProxy.ts");
    const owner = "lib/providers/adapters/openaiExecution.ts";
    const calls = collectCallArguments(readSource(owner), owner, "editViaResponses", "executeOpenaiEdit");
    assert.equal(calls.length, 1);
    assert.match(calls[0][9], /mask: request\.mask/);
    assert.match(route, /mask: maskCheck\.mask/);
    assert.match(adapter, /mask guide/);
    assert.match(adapter, /input_image/);
    assert.match(oauth, /options\.mask/);
    assert.match(oauth, /EDIT_MASK_NOT_SUPPORTED/);
    assert.match(oauth, /mask_unsupported/);
  });

  it("parses PNG IHDR metadata through a helper", () => {
    const png = readSource("lib/pngInfo.ts");
    assert.match(png, /export function parsePngInfo/);
    assert.match(png, /readUInt32BE\(16\)/);
    assert.match(png, /readUInt32BE\(20\)/);
    assert.match(png, /colorType/);
    assert.match(png, /hasPngAlphaChannel/);
  });
});
