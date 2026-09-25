import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI prompt import parity contract", () => {
  it("wraps JSON import and preview endpoints", () => {
    const cli = readSource("bin/commands/prompt.ts");
    const promptsRoute = readSource("routes/prompts.ts");
    const importRoute = readSource("routes/promptImport.ts");

    assert.match(cli, /import json <file\|@file\|->/);
    assert.match(cli, /import preview <file\|@file\|->/);
    assert.match(cli, /\/api\/prompts\/import"/);
    assert.match(cli, /\/api\/prompts\/import\/preview"/);
    assert.match(promptsRoute, /app\.post\("\/api\/prompts\/import"/);
    assert.match(importRoute, /app\.post\("\/api\/prompts\/import\/preview"/);
  });

  it("folder override is applied per prompt before /api/prompts/import", () => {
    const cli = readSource("bin/commands/prompt.ts");

    assert.match(cli, /body\.prompts = body\.prompts\.map/);
    assert.match(cli, /folderId: args\.folder/);
  });
});
