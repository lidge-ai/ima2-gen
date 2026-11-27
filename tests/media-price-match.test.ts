// Shared price-row matcher (lib/providers/media/priceMatch.ts): the spend guard uses it, and
// any estimate that has a quality, resolution or task can pick the same published row.
import test from "node:test";
import assert from "node:assert/strict";
import { matchPriceVariant, priceVariantParts } from "../lib/providers/media/priceMatch.ts";
import type { MediaPrice } from "../lib/providers/media/contract.ts";

const row = (usd: number, variant?: string): MediaPrice => ({ unit: "image", usd, ...(variant ? { variant } : {}), source: "https://example.test", checkedAt: "2026-11-27" });

test("variant names split into lower-cased parts on middle dots, colons and spaces", () => {
  assert.deepEqual(priceVariantParts("1K · low"), ["1k", "low"]);
  assert.deepEqual(priceVariantParts("text-to-image:very_low"), ["text-to-image", "very_low"]);
  assert.deepEqual(priceVariantParts("TURBO"), ["turbo"]);
});

test("picks the row the request names, however the provider spells it", () => {
  const tiers = [row(0.006, "1K · low"), row(0.0528, "1K · medium"), row(0.2108, "1K · high"), row(0.006, "2K · low")];
  assert.equal(matchPriceVariant(tiers, { resolution: "1K", quality: "low" })?.usd, 0.006);
  assert.equal(matchPriceVariant(tiers, { resolution: "1k", quality: "HIGH" })?.usd, 0.2108);
  assert.equal(matchPriceVariant([row(0.03, "TURBO"), row(0.09, "QUALITY")], { quality: "turbo" })?.usd, 0.03);
  const byTask = [row(0.03, "text-to-image:low"), row(0.008, "image-to-image:very_low"), row(0.22, "image-to-image:high")];
  assert.equal(matchPriceVariant(byTask, { task: "image-to-image", quality: "very_low" })?.usd, 0.008);
  assert.equal(matchPriceVariant([row(0.1, "720p"), row(0.15, "720p+audio")], { resolution: "720p", audio: true })?.usd, 0.15);
});

test("never guesses: a missing part, an unpriced quality or a foreign word means no match", () => {
  const tiers = [row(0.006, "1K · low"), row(0.2108, "1K · high")];
  assert.equal(matchPriceVariant(tiers, { quality: "low" }), undefined);
  assert.equal(matchPriceVariant(tiers, { resolution: "1K", quality: "ultra" }), undefined);
  assert.equal(matchPriceVariant([row(0.004, "text-to-image: starting price")], { task: "text-to-image", quality: "low" }), undefined);
  assert.equal(matchPriceVariant([row(0.02, "1K"), row(0.05, "1K · high")], { resolution: "1K", quality: "high" })?.usd, 0.05);
});
