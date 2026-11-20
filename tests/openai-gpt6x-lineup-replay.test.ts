import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openRouteHarness, responsesSse, type RouteHarness } from "./_executionRouteHarness.ts";

describe("API replay route", { concurrency: false }, () => {
  let harness: RouteHarness;
  before(async () => { harness = await openRouteHarness(); });
  after(async () => { await harness?.close(); });
  const upstream = () => responsesSse([{ type: "response.completed", response: {} }]);
  test("5 replay sends migrated model and preserves history", async () => {
    await harness.run("classic", { upstream }, async (fixture) => {
      const sidecar = join(fixture.generatedDir, "historical.png.json");
      const original = JSON.stringify({ model: "gpt-5.6-terra", prompt: "old" });
      await writeFile(sidecar, original);
      const response = await fixture.post({ provider: "api", model: "gpt-5.6-terra", prompt: "replay", webSearchEnabled: false });
      await response.text(); await fixture.waitSettled();
      const request = fixture.calls.find((call) => call.url.endsWith("/v1/responses"));
      assert.equal(await readFile(sidecar, "utf8"), original);
      assert.equal(request && JSON.parse(request.body).model, "gpt-6.1-terra");
    });
  });
  test("5 replay sends migrated model with coerced effort", async () => {
    await harness.run("classic", { upstream }, async (fixture) => {
      const response = await fixture.post({ provider: "api", model: "gpt-6-sol", reasoningEffort: "none", prompt: "replay", webSearchEnabled: false });
      await response.text(); await fixture.waitSettled();
      const request = fixture.calls.find((call) => call.url.endsWith("/v1/responses"));
      const body = request ? JSON.parse(request.body) : {};
      assert.deepEqual({ model: body.model, effort: body.reasoning?.effort }, { model: "gpt-6.2-sol", effort: "low" });
    });
  });
});
