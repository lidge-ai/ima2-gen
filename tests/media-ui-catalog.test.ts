import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.IMA2_CONFIG_DIR = mkdtempSync(join(tmpdir(), "ima2-media-ui-"));
const { allowedMediaValue, chooseMediaRoute, formatMediaPrice, logoUrl } = await import("../ui/src/lib/mediaCatalog.js");
const { buildMediaSubmitBody } = await import("../ui/src/lib/mediaSubmitBody.js");
import type { MediaModel, MediaRoute } from "../ui/src/lib/mediaCatalog.js";

test("formats route prices with their variant", () => {
  assert.equal(formatMediaPrice({ usd: 0.05, unit: "second", variant: "720p", source: "https://example.com", checkedAt: "2026-11-26" }), "$0.05 / second · 720p");
});

test("builds a media request retaining filenames, route and supported parameters", () => {
  const body = buildMediaSubmitBody({ kind: "video", model: "acme/video", adapter: "fake", task: "image-to-video",
    durationSec: 5, resolution: "720p", audio: false, seed: 0 }, "Animate", "request-1", "session-1",
  [{ role: "first-frame", filename: "source.png" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(body)), { requestId: "request-1", sessionId: "session-1", prompt: "Animate",
    model: "acme/video", adapter: "fake", task: "image-to-video", durationSec: 5, resolution: "720p", audio: false,
    seed: 0, inputs: [{ role: "first-frame", filename: "source.png" }] });
});

test("chooses default or explicitly selected route including key state", () => {
  const routes = [{ adapter: "a", hasKey: true }, { adapter: "b", hasKey: false }] as MediaRoute[];
  const model: MediaModel = { id: "acme/x", label: "X", vendor: "acme", logo: null, kind: "video", tasks: [], routes, defaultRoute: "a" };
  assert.equal(chooseMediaRoute(model)?.hasKey, true);
  assert.equal(chooseMediaRoute(model, "b")?.hasKey, false);
  assert.equal(chooseMediaRoute(model, "missing"), undefined);
});

test("accepts only advertised values and picks the mark before primary", () => {
  assert.equal(allowedMediaValue(5, [5, 10]), 5);
  assert.equal(allowedMediaValue(8, [5, 10]), undefined);
  assert.equal(allowedMediaValue("720p", undefined), undefined);
  assert.equal(logoUrl({ id: "x", name: "X", urls: { primary: "/primary", mark: "/mark" }, source: null }), "/mark");
  assert.equal(logoUrl({ id: "x", name: "X", urls: { primary: "/primary" }, source: null }), "/primary");
  assert.equal(logoUrl({ id: "x", name: "X", urls: {}, source: null }), undefined);
  assert.equal(logoUrl(null), undefined);
});
