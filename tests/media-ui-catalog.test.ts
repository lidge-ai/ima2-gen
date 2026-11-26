import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.IMA2_CONFIG_DIR = mkdtempSync(join(tmpdir(), "ima2-media-ui-"));
const { allowedMediaValue, chooseMediaRoute, formatMediaPrice, logoUrl } = await import("../ui/src/lib/mediaCatalog.js");
import type { MediaModel, MediaRoute } from "../ui/src/lib/mediaCatalog.js";

test("formats route prices with their variant", () => {
  assert.equal(formatMediaPrice({ usd: 0.05, unit: "second", variant: "720p", source: "https://example.com", checkedAt: "2026-11-26" }), "$0.05 / second · 720p");
});

test("chooses default or explicitly selected route including key state", () => {
  const routes = [{ adapter: "a", hasKey: true }, { adapter: "b", hasKey: false }] as MediaRoute[];
  const model = { routes, defaultRoute: "a" } as MediaModel;
  assert.equal(chooseMediaRoute(model)?.hasKey, true);
  assert.equal(chooseMediaRoute(model, "b")?.hasKey, false);
  assert.equal(chooseMediaRoute(model, "missing"), undefined);
});

test("accepts only advertised values and picks the mark before primary", () => {
  assert.equal(allowedMediaValue(5, [5, 10]), 5);
  assert.equal(allowedMediaValue(8, [5, 10]), undefined);
  assert.equal(allowedMediaValue("720p", undefined), undefined);
  assert.equal(logoUrl({ id: "x", name: "X", urls: { primary: "/primary", mark: "/mark" }, source: null }), "/mark");
  assert.equal(logoUrl(null), undefined);
});
