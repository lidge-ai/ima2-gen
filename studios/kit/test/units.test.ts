import { test } from "node:test";
import assert from "node:assert/strict";
import { readSse } from "../src/sse.ts";
import { estimateCost, formatUsd, sumEstimates } from "../src/pricing.ts";
import { chooseRoute } from "../src/routing.ts";
import { makeCatalog } from "../src/fake/catalog.ts";

test("SSE parses split CRLF, comments, ids and multiline data", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of [": hi\r", "\nid: 42\r\nevent: step\r", "\ndata: first\r\ndata: second\r\n\r", "\n"])
        controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  const result = [];
  for await (const event of readSse(stream)) result.push(event);
  assert.deepEqual(result, [{ id: "42", event: "step", data: "first\nsecond" }]);
});
test("pricing computes and preserves unknown prices", () => {
  const price = { unit: "second" as const, usd: 0.1, source: "fixture:fake", checkedAt: "2026-11-26" };
  assert.equal(estimateCost([price], { durationSec: 5, count: 2 }).usd, 1);
  assert.equal(formatUsd(estimateCost([], {})), "Price not published");
  assert.equal(sumEstimates([estimateCost([price], { durationSec: 5 }), estimateCost([], {})]).usd, null);
});
test("routing prefers direct then keyed aggregator and reports missing key", () => {
  let model = makeCatalog(new Set(["openai", "fal"])).models.find((m) => m.id === "openai/gpt-image-2")!;
  assert.equal(chooseRoute(model).kind, "default");
  assert.equal(chooseRoute(model, "fal").kind, "chosen");
  model = makeCatalog(new Set(["fal"])).models.find((m) => m.id === "openai/gpt-image-2")!;
  const choice = chooseRoute(model);
  assert.equal(choice.kind, "default");
  if (choice.kind === "default") assert.equal(choice.route.providerId, "fal");
  assert.equal(chooseRoute(model, "openai").kind, "needs-key");
});
