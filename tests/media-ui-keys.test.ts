import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.IMA2_CONFIG_DIR = await mkdtemp(join(tmpdir(), "ima2-media-ui-"));
const { extraFieldStatus } = await import("../ui/src/lib/mediaKeys.js");

test("extra fields combine vocabulary with legacy adapter status", () => {
  const vocabulary = { vocabulary: "vertex", label: "Vertex", legacy: true, consoleUrl: "", keyPrefix: null,
    extraFields: [{ name: "location", secret: false, required: true }] };
  assert.deepEqual(extraFieldStatus(vocabulary, undefined, [{ keyVocabulary: "vertex", extraFields: [
    { name: "location", secret: false, required: true, configured: true, source: "config", value: "us" },
  ] }]), [{ name: "location", secret: false, required: true, configured: true, source: "config", value: "us" }]);
});

test("media status takes precedence and secret values stay absent", () => {
  const vocabulary = { vocabulary: "fake", label: "Fake", legacy: false, consoleUrl: "", keyPrefix: null,
    extraFields: [{ name: "secret", secret: true, required: true }] };
  const fields = extraFieldStatus(vocabulary, { configured: true, source: "env", maskedKey: "***",
    extraFields: [{ name: "secret", secret: true, required: true, configured: true, source: "env" }] }, []);
  assert.equal(fields[0]?.configured, true);
  assert.equal(fields[0]?.value, undefined);
});

// ── Keys, estimates and failures in the classic picker (L11) ──
const { keyDraftProblem, keyEntrySupported, keySaveRequests } = await import("../ui/src/lib/mediaKeyEntry.js");
const { estimateBody, pickPrice, quoteFor } = await import("../ui/src/lib/mediaEstimate.js");
const { buildMediaFailure, failureAction, failureCategory, parseMediaFailure } = await import("../ui/src/lib/mediaFailure.js");

test("a key is checked with the provider before it is stored, and legacy vocabularies save extras on their own route", () => {
  assert.deepEqual(keySaveRequests({ keyVocabulary: "fal" }, { apiKey: "  fal-key-123  ", extra: {} }), [
    { method: "POST", url: "/api/keys/fal/validate", body: { apiKey: "fal-key-123" } },
    { method: "PUT", url: "/api/keys/fal", body: { apiKey: "fal-key-123" } },
  ]);
  assert.deepEqual(keySaveRequests({ keyVocabulary: "kling-legacy" }, { apiKey: "ak-123456", extra: { secretKey: " sk-1 ", region: " " } }), [
    { method: "POST", url: "/api/keys/kling-legacy/validate", body: { apiKey: "ak-123456", extra: { secretKey: "sk-1" } } },
    { method: "PUT", url: "/api/keys/kling-legacy", body: { apiKey: "ak-123456", extra: { secretKey: "sk-1" } } },
  ]);
  assert.deepEqual(keySaveRequests({ keyVocabulary: "minimax" }, { apiKey: "mm-123456", extra: { region: "cn" } }).map((r) => r.method + " " + r.url),
    ["POST /api/keys/minimax/validate", "PUT /api/keys/minimax/extra", "PUT /api/keys/minimax"]);
  assert.equal(keyEntrySupported({ keyVocabulary: "vertex" }), false);
  assert.equal(keyEntrySupported({ keyVocabulary: "gemini" }), true);
});

test("a key draft is held back for the reasons the server would refuse it", () => {
  const adapter = { keyPrefix: "sk-", extraFields: [{ name: "secretKey", secret: true, required: true }, { name: "region", secret: false, required: false }] };
  assert.equal(keyDraftProblem(adapter, { apiKey: " ", extra: {} }), "empty");
  assert.equal(keyDraftProblem(adapter, { apiKey: "sk-1", extra: {} }), "short");
  assert.equal(keyDraftProblem(adapter, { apiKey: "pk-123456", extra: {} }), "prefix");
  assert.equal(keyDraftProblem(adapter, { apiKey: "sk-123456", extra: { region: "us" } }), "extra");
  assert.equal(keyDraftProblem(adapter, { apiKey: "sk-123456", extra: { secretKey: "s" } }), null);
  assert.equal(keyDraftProblem({ keyPrefix: null, extraFields: [{ name: "secretKey", secret: true, required: true, configured: true }] }, { apiKey: "abcdef", extra: {} }), null,
    "a required field the server already holds does not block");
});

const row = (usd: number, variant?: string, unit = "second") => ({ unit, usd, source: "https://example.com/p", checkedAt: "2026-11-27", ...(variant ? { variant } : {}) });

test("the price row for a request is read from the variant names providers publish", () => {
  const direct = [row(0.103, "480p 16:9, no video input (official 5 s example)"), row(0.231, "720p 16:9, no video input (official 5 s example)"), row(0.569, "1080p 16:9, no video input (official 5 s example)")];
  assert.equal(pickPrice(direct, "second", { task: "text-to-video", resolution: "720p" }).price?.usd, 0.231);
  const byTask = [row(0.2205, "text-to-video:480p"), row(0.473, "text-to-video:720p"), row(0.25, "image-to-video:480p"), row(0.5, "image-to-video:720p")];
  assert.equal(pickPrice(byTask, "second", { task: "image-to-video", resolution: "480p" }).price?.usd, 0.25);
  assert.equal(pickPrice(byTask, "second", { task: "reference-to-video", resolution: "480p" }).price, null, "no row names this task");
  const videoIn = [row(0.1028, "model variant=non_video_in, target resolution=480p"), row(0.4304, "model variant=video_in, target resolution=480p")];
  assert.equal(pickPrice(videoIn, "second", { task: "text-to-video", resolution: "480p" }).price?.usd, 0.1028, "rows priced for a video input never apply");
  const tiers = [row(0.02, "output, P <= 2,601,124 px (up to 1.5K)", "image"), row(0.035, "output, P <= 4,624,220 px (2K)", "image"), row(0.008, "each input image", "image")];
  assert.equal(pickPrice(tiers, "image", { task: "text-to-image", resolution: "1K" }).price?.usd, 0.02);
  assert.equal(pickPrice(tiers, "image", { task: "text-to-image", resolution: "2K" }).price?.usd, 0.035);
  const audio = [row(0.1, "720p"), row(0.15, "720p+audio")];
  assert.equal(pickPrice(audio, "second", { task: "text-to-video", resolution: "720p" }).price?.usd, 0.1);
  assert.equal(pickPrice(audio, "second", { task: "text-to-video", resolution: "720p", audio: true }).price?.usd, 0.15);
  const quality = [row(0.011, "low", "image"), row(0.042, "medium", "image"), row(0.167, "high", "image")];
  assert.deepEqual(pickPrice(quality, "image", { task: "text-to-image" }), { price: null, floor: false, range: { min: 0.011, max: 0.167 } }, "a tier the UI does not set stays a range");
  assert.equal(pickPrice([row(0.134, "text-to-video: starting price")], "second", { task: "text-to-video" }).floor, true);
  assert.deepEqual(pickPrice([row(0.4)], "second", { task: "text-to-video" }), { price: row(0.4), floor: false, range: null });
  assert.deepEqual(pickPrice([row(0.4)], "image", { task: "text-to-image" }), { price: null, floor: false, range: null });
});

test("a quote multiplies the applicable row by the clip length, and says when it cannot", () => {
  const selection = { kind: "video" as const, model: "acme/clip", adapter: "fal", task: "text-to-video", durationSec: 5, resolution: "720p" };
  const pricing = [row(0.2205, "text-to-video:480p"), row(0.473, "text-to-video:720p")];
  assert.deepEqual(quoteFor({ pricing }, selection), { state: "exact", usd: 2.365, unit: "second", quantity: 5, price: pricing[1] });
  assert.deepEqual(quoteFor({ pricing: [] }, selection), { state: "unpriced" });
  assert.deepEqual(quoteFor({ pricing }, { ...selection, task: "image-to-video" }), { state: "unknown" });
  assert.deepEqual(quoteFor({ pricing: [row(0.134, "text-to-video: starting price")] }, selection).state, "from");
  const image = { kind: "image" as const, model: "acme/still", adapter: "openai", task: "text-to-image" };
  assert.deepEqual(quoteFor({ pricing: [row(0.011, "low", "image"), row(0.167, "high", "image")] }, image), { state: "range", min: 0.011, max: 0.167, unit: "image", quantity: 1 });
  assert.deepEqual(quoteFor({ pricing: [row(0.05, undefined, "request")] }, selection), { state: "exact", usd: 0.05, unit: "request", quantity: 1, price: row(0.05, undefined, "request") });
  assert.deepEqual(estimateBody({ ...selection, aspectRatio: "16:9", audio: true, seed: 3, negativePrompt: "x" }, "fal", pricing[1]!),
    { model: "acme/clip", adapter: "fal", task: "text-to-video", durationSec: 5, resolution: "720p", aspectRatio: "16:9", audio: true, priceVariant: "text-to-video:720p" });
  assert.deepEqual(estimateBody(image, "openai", row(0.04, undefined, "image")), { model: "acme/still", adapter: "openai", task: "text-to-image", count: 1 });
});

test("a failure names one next step, from the server category or from the status when a reload lost the category", () => {
  assert.equal(failureCategory({ category: "quota", status: 500 }), "quota");
  assert.deepEqual([401, 403, 402, 429, 422, 404, 504, 400, 502, undefined].map((status) => failureCategory({ status })),
    ["auth", "auth", "quota", "rate-limit", "moderation", "not-found", "timeout", "invalid-request", "upstream", "unknown"]);
  assert.equal(failureCategory({ code: "MEDIA_KEY_MISSING", status: 400 }), "auth");
  assert.equal(failureCategory({ category: "made-up" }), "unknown");
  assert.deepEqual((["auth", "quota", "rate-limit", "timeout", "moderation", "invalid-request", "not-found"] as const).map((c) => failureAction(c, false)),
    ["key", "billing", "retry", "retry", "prompt", "settings", "settings"]);
  assert.equal(failureAction("upstream", true), "retry");
  assert.equal(failureAction("upstream", false), null);
  assert.equal(failureAction("unknown", false), null);
});

test("a failure record keeps what was run and survives storage without trusting its shape", () => {
  const selection = { kind: "video" as const, model: "acme/clip", adapter: "fal", task: "text-to-video", routeMode: "auto" as const, durationSec: 5 };
  const error = Object.assign(new Error("balance empty"), { code: "FAL_INSUFFICIENT_CREDIT", status: 402, category: "quota", retryable: false });
  const failure = buildMediaFailure(error, { requestId: "media_1", prompt: "a fox", selection, at: 10 });
  assert.deepEqual(failure, { requestId: "media_1", at: 10, category: "quota", retryable: false, code: "FAL_INSUFFICIENT_CREDIT", message: "balance empty", adapter: "fal", prompt: "a fox", selection });
  assert.deepEqual(parseMediaFailure(JSON.parse(JSON.stringify(failure))), failure);
  assert.equal(parseMediaFailure({ requestId: "", at: 1, code: "X" }), null);
  assert.equal(parseMediaFailure("nope"), null);
  assert.deepEqual(parseMediaFailure({ requestId: "r", at: 1, code: "X", category: 7, selection: { kind: "audio" } }),
    { requestId: "r", at: 1, category: "unknown", retryable: false, code: "X", message: "", adapter: "", prompt: "", selection: null });
  assert.equal(buildMediaFailure({ status: 401 }, { requestId: "r", prompt: "", selection: null, adapter: "kling" }).adapter, "kling");
});

const { generateBlocker } = await import("../ui/src/lib/mediaReadiness.js");

test("Generate is held back for a missing key first, then for images that do not fit the task", () => {
  const route = { adapter: "fal", route: "aggregator" as const, label: "fal", logo: null, upstreamId: "x", tasks: ["text-to-video", "image-to-video"],
    params: {}, pricing: [], docsUrl: "", hasKey: true };
  assert.equal(generateBlocker(undefined, "text-to-video", 0), null, "nothing is claimed before the catalog has loaded");
  assert.equal(generateBlocker({ route, state: "auto" }, "text-to-video", 0), null);
  assert.deepEqual(generateBlocker({ route, state: "needs-key" }, "image-to-video", 0), { code: "key", route });
  assert.deepEqual(generateBlocker({ route, state: "pinned" }, "image-to-video", 0), { code: "input", problem: { code: "needsImages", min: 1, max: 1, have: 0 } });
  assert.deepEqual(generateBlocker({ route, state: "auto" }, "text-to-video", 2), { code: "input", problem: { code: "noImages", min: 0, max: 0, have: 2 } });
});

const { formatUsd } = await import("../ui/src/lib/mediaFormat.js");

test("amounts keep enough digits to tell prices apart and round up, never down", () => {
  assert.deepEqual([0, 0.0004, 0.004, 0.035, 0.2205, 0.5, 1.1025, 2.365, 12], [0, 0.0004, 0.004, 0.035, 0.2205, 0.5, 1.1025, 2.365, 12].map((n) => n));
  assert.deepEqual([0, 0.0004, 0.004, 0.035, 0.2205, 0.5, 1.1025, 2.365, 12].map(formatUsd),
    ["$0", "$0.0004", "$0.004", "$0.035", "$0.221", "$0.50", "$1.11", "$2.37", "$12.00"]);
});
