import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("async stream clients subscribe before async POST submission", () => {
  for (const rel of ["ui/src/lib/api-generation.ts", "ui/src/lib/nodeApi.ts"]) {
    const src = readFileSync(join(root, rel), "utf8");
    const subscribeIdx = src.indexOf("subscribe(requestId");
    const submitIdx = src.indexOf("void submitAsyncJobWithCapacityRetry");
    assert.ok(subscribeIdx >= 0, `${rel} must call subscribe(requestId)`);
    assert.ok(submitIdx >= 0, `${rel} must submit async POST work`);
    assert.ok(subscribeIdx < submitIdx, `${rel} must subscribe before async POST to avoid event loss`);
  }
});
