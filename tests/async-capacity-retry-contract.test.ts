import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

test("web async generation retries server capacity 429 instead of failing the queued click", () => {
  const helper = readSource("ui/src/lib/asyncJobSubmit.ts");
  assert.match(helper, /submitAsyncJobWithCapacityRetry/);
  assert.match(helper, /res\.status === 429 && data\.code === "TOO_MANY_JOBS"/);
  assert.match(helper, /Retry-After/);
  assert.match(helper, /await wait\(parseRetryAfterMs/);
  assert.match(helper, /continue;/);
  assert.match(helper, /JSON\.stringify\(\{ \.\.\.payload, async: true, requestId \}\)/);
});

test("classic, multimode, video, and node stream clients use capacity retry submitter", () => {
  const generation = readSource("ui/src/lib/api-generation.ts");
  const nodeApi = readSource("ui/src/lib/nodeApi.ts");
  const nodeStore = readSource("ui/src/store/storeNodeGenImpl.ts");

  assert.match(generation, /import \{ mergeAbortSignals, submitAsyncJobWithCapacityRetry \} from "\.\/asyncJobSubmit"/);
  assert.match(nodeApi, /import \{ mergeAbortSignals, submitAsyncJobWithCapacityRetry \} from "\.\/asyncJobSubmit"/);

  for (const endpoint of ["/api/generate", "/api/generate/multimode", "/api/video/generate"]) {
    assert.match(generation, new RegExp(`url: "${endpoint.replaceAll("/", "\\/")}"`));
  }
  assert.match(nodeApi, /url: "\/api\/node\/generate"/);

  assert.equal((generation.match(/submitAsyncJobWithCapacityRetry/g) ?? []).length, 4);
  assert.equal((nodeApi.match(/submitAsyncJobWithCapacityRetry/g) ?? []).length, 2);
  assert.equal((generation.match(/submitController\.abort\(\)/g) ?? []).length, 9);
  assert.equal((nodeApi.match(/submitController\.abort\(\)/g) ?? []).length, 3);
  assert.match(nodeStore, /registerFlightAbort\(flightId,\s*controller\)/);
  assert.match(nodeStore, /postNodeGenerateStream\([\s\S]*\{ signal: controller\.signal \}/);
  assert.match(nodeStore, /clearFlightAbort\(flightId\)/);
});
