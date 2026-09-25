import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("storage open route keeps the existing generated-dir-only endpoint", () => {
  const source = readFileSync("routes/storage.ts", "utf-8");
  assert.match(source, /app\.post\("\/api\/storage\/open-generated-dir"/);
  assert.match(source, /openDirectory\(ctx\.config\.storage\.generatedDir\)/);
  assert.doesNotMatch(source, /req\.body/);
  assert.doesNotMatch(source, /\/api\/open-folder/);
});
