// The one price rule (lib/providers/media/priceQuote.ts): the estimate route, the web spend guard,
// the CLI, the MCP tool and the web UI all get their price row from it.
import test from "node:test";
import assert from "node:assert/strict";
import { pickPrice } from "../lib/providers/media/priceQuote.ts";
import type { MediaPrice } from "../lib/providers/media/contract.ts";

const row = (usd: number, variant?: string): MediaPrice => ({ unit: "image", usd, ...(variant ? { variant } : {}), source: "https://example.test", checkedAt: "2026-11-27" });
const price = (rows: MediaPrice[], want: Parameters<typeof pickPrice>[2]) => { const pick = pickPrice(rows, "image", want); return pick.price?.usd ?? pick.range ?? undefined; };
const t2i = { task: "text-to-image" };

test("picks the row the request names, however the provider spells it", () => {
  const tiers = [row(0.006, "1K · low"), row(0.0528, "1K · medium"), row(0.2108, "1K · high"), row(0.006, "2K · low")];
  assert.equal(price(tiers, { ...t2i, resolution: "1K", quality: "low" }), 0.006);
  assert.equal(price(tiers, { ...t2i, resolution: "1k", quality: "HIGH" }), 0.2108);
  assert.equal(price([row(0.03, "TURBO"), row(0.09, "QUALITY")], { ...t2i, quality: "turbo" }), 0.03);
  const byTask = [row(0.03, "text-to-image:low"), row(0.008, "image-to-image:very_low"), row(0.22, "image-to-image:high")];
  assert.equal(price(byTask, { task: "image-to-image", quality: "very_low" }), 0.008);
  assert.equal(price([row(0.1, "720p"), row(0.15, "720p+audio")], { task: "text-to-video", resolution: "720p", audio: true }), 0.15);
  assert.equal(price([row(0.1, "720p"), row(0.15, "720p+audio")], { task: "text-to-video", resolution: "720p" }), 0.1);
});

test("a quality the price list names leaves only the rows that name it, with or without a declared tier list", () => {
  assert.equal(price([row(0.02, "1K"), row(0.05, "1K · high")], { ...t2i, resolution: "1K", quality: "high" }), 0.05);
  // The same answer when the route declares its tiers.
  assert.equal(price([row(0.02, "1K"), row(0.05, "1K · high")], { ...t2i, resolution: "1K", quality: "high", qualities: ["low", "high"] }), 0.05);
  // Every "low" row costs the same, so the resolution does not need to be said.
  assert.equal(price([row(0.006, "1K · low"), row(0.2108, "1K · high"), row(0.006, "2K · low")], { ...t2i, quality: "low" }), 0.006);
});

test("never guesses: rows that still differ are a range, and a quality no row names narrows nothing", () => {
  const tiers = [row(0.006, "1K · low"), row(0.2108, "1K · high"), row(0.4, "2K · high")];
  assert.deepEqual(price(tiers, { ...t2i, quality: "high" }), { min: 0.2108, max: 0.4 });
  assert.deepEqual(price(tiers, { ...t2i, resolution: "1K", quality: "ultra" }), { min: 0.006, max: 0.2108 });
  assert.deepEqual(price(tiers, t2i), { min: 0.006, max: 0.4 });
  // A row for another task never applies.
  assert.equal(price([row(0.004, "image-to-image: starting price")], { ...t2i, quality: "low" }), undefined);
  assert.equal(pickPrice([row(0.004, "text-to-image: starting price")], "image", { ...t2i, quality: "low" }).floor, true);
});
