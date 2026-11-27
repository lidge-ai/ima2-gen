import { test } from "node:test";
import assert from "node:assert/strict";
import { readSse } from "../src/sse.ts";
import { formatUsd, sumEstimates } from "../src/pricing.ts";
import { chooseRoute } from "../src/routing.ts";
import { chooseEditRoute, editForm, editRoutes } from "../src/editForm.ts";
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
test("money prints the server's figures and keeps an unpriced step unpriced", () => {
  assert.equal(formatUsd({ usd: 1, basis: "" }), "$1.00");
  assert.equal(formatUsd({ usd: 0.0034, basis: "" }), "$0.0034");
  assert.equal(formatUsd({ usd: null, basis: "" }), "Price not published");
  assert.equal(sumEstimates([{ usd: 0.5, basis: "" }, { usd: null, basis: "" }]).usd, null);
  assert.equal(sumEstimates([{ usd: 0.5, basis: "" }, { usd: 0.25, basis: "" }]).usd, 0.75);
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

test("a task is only routed to a route that serves it, whatever key or choice is there", () => {
  const base = makeCatalog(new Set(["openai", "fal"])).models.find((m) => m.id === "openai/gpt-image-2")!;
  // The direct route serves only text-to-image; the aggregator also edits.
  const model = { ...base, routes: base.routes.map((r) => ({ ...r, tasks: r.providerId === "openai" ? ["text-to-image" as const] : ["text-to-image" as const, "image-to-image" as const] })) };
  const create = chooseRoute(model, undefined, "text-to-image");
  assert.ok(create.kind === "default" && create.route.providerId === "openai");
  const edit = chooseRoute(model, undefined, "image-to-image");
  assert.ok(edit.kind === "default" && edit.route.providerId === "fal");
  // A route picked for another task is not kept for one it cannot run.
  const kept = chooseRoute(model, "openai", "image-to-image");
  assert.ok(kept.kind === "default" && kept.route.providerId === "fal");
  assert.equal(chooseRoute(model, undefined, "video-extend").kind, "unavailable");
  const keyless = { ...model, routes: model.routes.map((r) => ({ ...r, keyConfigured: false })) };
  const ask = chooseRoute(keyless, undefined, "image-to-image");
  assert.ok(ask.kind === "needs-key" && ask.candidates.every((r) => r.providerId === "fal"));
  // A server that does not say which tasks a route serves is treated as before.
  assert.equal(chooseRoute(base, undefined, "image-to-image").kind, "default");
});

test("an edit tool is offered only through routes that declare it, with the fields and lists of that route", () => {
  const models = makeCatalog(new Set(["fal"])).models;
  const seedance = models.find((m) => m.id === "bytedance/seedance-2")!;
  // fal has the key but only creates with this model; the direct route edits.
  assert.deepEqual(editRoutes(seedance, "video-to-video").map((r) => r.providerId), ["byteplus"]);
  const choice = chooseEditRoute(seedance, "video-to-video");
  assert.ok(choice.kind === "needs-key" && choice.route.providerId === "byteplus");
  assert.equal(editForm(seedance, "fal", "video-to-video"), null);
  assert.equal(editRoutes(seedance, "video-extend").length, 0);

  const grok = models.find((m) => m.id === "xai/grok-imagine-video")!;
  const edit = editForm(grok, "xai", "video-to-video")!;
  assert.deepEqual([edit.durationsSec, edit.resolutions, edit.aspectRatios], [[], [], []]);
  assert.equal(edit.source.billedLength, true);
  const extend = editForm(grok, "xai", "video-extend")!;
  assert.ok(extend.durationsSec.length > 0 && extend.resolutions.length === 0);

  const topaz = models.find((m) => m.id === "topaz-labs/topaz-video")!;
  assert.deepEqual(editRoutes(topaz, "video-upscale").map((r) => r.providerId), ["fal"]);
  // A required choice with nothing to choose from is not a form.
  const stuck = { ...grok, routeParams: { xai: { ...grok.routeParams!.xai, taskFields: { "video-extend": { accepts: ["resolution" as const], requires: ["resolution" as const], resolutions: [] } } } } };
  assert.equal(editForm(stuck, "xai", "video-extend"), null);
});
