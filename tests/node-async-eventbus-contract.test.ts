import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("node async mode publishes phase and partial via eventBus", () => {
  const src = (readFileSync(join(root, "routes/nodes.ts"), "utf8") + readFileSync(join(root, "lib/nodeGeneration.ts"), "utf8") + readFileSync(join(root, "lib/nodeValidation.ts"), "utf8"));
  assert.match(src, /const emitProgress = streamResponse \|\| asyncMode/);
  assert.match(src, /else if \(asyncMode\)[\s\S]*publish\(requestId, "phase"/);
  assert.match(src, /partialImages: emitProgress \? 2 : 0/);
  assert.match(src, /publish\(requestId, "partial", pd\)/);
});

