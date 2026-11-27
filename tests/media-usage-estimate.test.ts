// Prices per minute and per character (audio): the one rule in lib/providers/media/priceQuote.ts gives a
// figure when the request says how long or how much text, and the web spend guard charges that same figure.
import test from "node:test";
import assert from "node:assert/strict";
import { quoteFor, usageQuantity } from "../lib/providers/media/priceQuote.ts";
import { estimateMediaUsd } from "../lib/webAccess/spendGuard.ts";
import type { MediaPrice, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { estimateMediaJob } = await import("../lib/providers/media/estimate.ts");
const { MediaKeySnapshot } = await import("../lib/providers/media/credentials.ts");
const { parseEstimateBody } = await import("../routes/mediaTools.ts");
const { fakeSpec, makeFakeAdapter } = await import("./_mediaFakeAdapter.ts");

const row = (unit: MediaPrice["unit"], usd: number, variant?: string): MediaPrice => ({ unit, usd, ...(variant ? { variant } : {}), source: "https://example.test", checkedAt: "2026-11-28" });
const audio = { kind: "audio", task: "text-to-audio" };

test("a price per minute is quoted from the requested length, by the second", () => {
  const music = { pricing: [row("minute", 0.15)] };
  assert.deepEqual(quoteFor(music, { ...audio, durationSec: 45 }), { state: "exact", usd: 0.1125, unit: "minute", quantity: 0.75, price: music.pricing[0] });
  assert.equal((quoteFor(music, { ...audio, durationSec: 600 }) as { usd: number }).usd, 1.5);
  // A length the request leaves to the model is still unknown, so there is no figure.
  assert.deepEqual(quoteFor(music, audio), { state: "usage", unit: "minute" });
  assert.deepEqual(quoteFor(music, { ...audio, durationSec: 0 }), { state: "usage", unit: "minute" });
});

test("a price per character is quoted from the length of the text", () => {
  const speech = { pricing: [row("character", 0.00008, "$0.08 per 1K characters")] };
  assert.deepEqual(quoteFor(speech, { ...audio, characters: 1250 }), { state: "exact", usd: 0.1, unit: "character", quantity: 1250, price: speech.pricing[0] });
  assert.deepEqual(quoteFor(speech, audio), { state: "usage", unit: "character" });
  assert.deepEqual(quoteFor(speech, { ...audio, characters: 0 }), { state: "usage", unit: "character" });
});

test("the figure is rounded up to a hundredth of a cent, after binary noise is removed", () => {
  const usd = (pricing: MediaPrice[], request: Record<string, number>) => (quoteFor({ pricing }, { ...audio, ...request }) as { usd: number }).usd;
  assert.equal(usd([row("minute", 0.12)], { durationSec: 7 }), 0.014, "0.12 x 7/60 is 0.014 exactly");
  assert.equal(usd([row("minute", 0.15)], { durationSec: 10 }), 0.025);
  assert.equal(usd([row("minute", 0.15)], { durationSec: 1 }), 0.0025);
  assert.equal(usd([row("minute", 0.15)], { durationSec: 0.5 }), 0.0013, "0.00125 rounds up");
  assert.equal(usd([row("character", 0.00008)], { characters: 1 }), 0.0001, "one character still costs something");
  assert.equal(usd([row("character", 0.00008)], { characters: 12 }), 0.001, "0.00096 rounds up");
  assert.equal(usd([row("character", 0.00004)], { characters: 2500 }), 0.1);
});

test("several rows are told apart the usual way, and megapixel and token prices still have no figure", () => {
  const tiers = { pricing: [row("character", 0.00008, "standard"), row("character", 0.00004, "turbo")], params: { qualities: ["standard", "turbo"] } };
  assert.equal((quoteFor(tiers, { ...audio, characters: 1000, quality: "turbo" }) as { usd: number }).usd, 0.04);
  assert.deepEqual(quoteFor(tiers, { ...audio, characters: 1000 }), { state: "range", min: 0.04, max: 0.08, unit: "character", quantity: 1000 });
  assert.deepEqual(quoteFor({ pricing: [row("megapixel", 0.03)] }, { kind: "image", task: "text-to-image" }), { state: "usage", unit: "megapixel" });
  assert.deepEqual(quoteFor({ pricing: [row("1k-tokens", 0.01)] }, { kind: "video", task: "text-to-video", durationSec: 5 }), { state: "usage", unit: "1k-tokens" });
  // A route that also has a per-second price keeps using it.
  assert.equal((quoteFor({ pricing: [row("second", 0.02), row("minute", 0.9)] }, { ...audio, durationSec: 10 }) as { unit: string }).unit, "second");
});

test("usageQuantity is the one conversion: minutes from seconds, characters as counted", () => {
  assert.equal(usageQuantity("minute", { durationSec: 90 }), 1.5);
  assert.equal(usageQuantity("character", { characters: 12 }), 12);
  assert.equal(usageQuantity("minute", {}), null);
  assert.equal(usageQuantity("character", { durationSec: 5 }), null);
  assert.equal(usageQuantity("megapixel", { durationSec: 5, characters: 5 }), null);
});

const registry = new MediaRegistry([makeFakeAdapter({ models: [
  fakeSpec("acme/music", { kind: "audio", tasks: ["text-to-audio"], params: { durationRange: { minSec: 3, maxSec: 600 } }, pricing: [row("minute", 0.15)] }),
  fakeSpec("acme/speech", { kind: "audio", tasks: ["text-to-audio"], params: { options: [{ name: "voice_id", type: "voice", required: true }] }, pricing: [row("character", 0.00008, "$0.08 per 1K characters")] }),
] })]);
const keys = new MediaKeySnapshot({ env: {}, fileConfig: {} });
const estimate = (body: Record<string, unknown>) => estimateMediaJob(registry, keys, parseEstimateBody({ task: "text-to-audio", ...body }));

test("POST /api/media/estimate gives the figure, and keeps its earlier fields", () => {
  const music = estimate({ model: "acme/music", durationSec: 45 });
  assert.equal(music.usd, 0.1125);
  assert.deepEqual(music.quote, { state: "exact", usd: 0.1125, unit: "minute", quantity: 0.75, price: row("minute", 0.15) });
  assert.equal(music.note, undefined);
  // unit and quantity are what they were before this: the second-based view of the request.
  assert.deepEqual([music.unit, music.quantity], ["second", 45]);
  const open = estimate({ model: "acme/music" });
  assert.deepEqual([open.usd, open.quote, open.note], [null, { state: "usage", unit: "minute" }, "billed per minute: the amount depends on the output"]);

  const words = "Welcome aboard. Please keep your seatbelt fastened.";
  const spoken = estimate({ model: "acme/speech", prompt: words });
  assert.equal(spoken.usd, 0.0041, String(words.length) + " characters at $0.00008");
  assert.equal((spoken.quote as { quantity: number }).quantity, words.length);
  // A client that does not want to send the text sends its length.
  assert.equal(estimate({ model: "acme/speech", characters: 1250 }).usd, 0.1);
  assert.equal(estimate({ model: "acme/speech", prompt: words, characters: 1250 }).usd, 0.1, "characters wins over the prompt");
  assert.equal(estimate({ model: "acme/speech" }).usd, null);
  assert.throws(() => estimate({ model: "acme/speech", characters: -1 }), /characters/);
  assert.throws(() => estimate({ model: "acme/speech", characters: 1.5 }), /characters/);
});

test("the web spend guard charges the figure the estimate shows", () => {
  const request = (extra: Partial<MediaSubmitRequest>): MediaSubmitRequest => ({ model: "acme/x", task: "text-to-audio", inputs: [], ...extra });
  const music = registry.getModel("acme/music")!.candidates[0]!.spec;
  const speech = registry.getModel("acme/speech")!.candidates[0]!.spec;
  for (const durationSec of [0.5, 7, 45, 61, 600]) {
    assert.deepEqual(estimateMediaUsd(music, request({ durationSec })), { usd: estimate({ model: "acme/music", durationSec }).usd, basis: "exact" }, String(durationSec) + " s");
  }
  assert.equal(estimateMediaUsd(music, request({ durationSec: 61 })).usd, 0.1525, "by the second, not by the started minute");
  for (const prompt of ["a", "hello there", "x".repeat(1250)]) {
    assert.deepEqual(estimateMediaUsd(speech, request({ prompt })), { usd: estimate({ model: "acme/speech", prompt }).usd, basis: "exact" });
  }
  // Without a length there is no figure for either, and the shared instance does not run what it cannot price.
  assert.equal(estimateMediaUsd(music, request({})).usd, null);
});
