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

// ── Classic picker: tasks, routes, model list, selection (L11) ──
const { inferTask, inputLimits, inputProblem, inputRoles, modelTasks, routeTasks } = await import("../ui/src/lib/mediaTasks.js");
const { autoRoute, candidateRoutes, lowestPrice, resolveRoute } = await import("../ui/src/lib/mediaRoutes.js");
const { filterModels, groupModels, modelFacts, offeredFeatures, resolutionRank, sortModels, suggestModels, unsupportedModels } = await import("../ui/src/lib/mediaModelList.js");
const { defaultDuration, defaultResolution, parseSeed, reconcileSelection } = await import("../ui/src/lib/mediaSelection.js");
const { parseMediaSelection } = await import("../ui/src/lib/mediaSelectionStore.js");

const price = (usd: number, unit = "second", variant?: string) => ({ unit, usd, source: "https://example.com/p", checkedAt: "2026-11-27", ...(variant ? { variant } : {}) });
function route(adapter: string, over: Partial<MediaRoute> = {}): MediaRoute {
  return { adapter, route: "aggregator", label: adapter, logo: null, upstreamId: adapter, tasks: ["text-to-video", "image-to-video"],
    params: { durationsSec: [5, 10], resolutions: ["480p", "720p"], aspectRatios: ["16:9", "9:16"] }, pricing: [], docsUrl: "", hasKey: false, ...over };
}
function model(id: string, routes: MediaRoute[], over: Partial<MediaModel> = {}): MediaModel {
  return { id, label: id.split("/")[1]!, vendor: id.split("/")[0]!, logo: null, kind: "video", tasks: [...new Set(routes.flatMap((r) => r.tasks))], routes, defaultRoute: null, ...over };
}

test("the task follows what the composer already holds", () => {
  assert.equal(inferTask("image", 0), "text-to-image");
  assert.equal(inferTask("image", 2), "image-to-image");
  assert.equal(inferTask("video", 0), "text-to-video");
  assert.equal(inferTask("video", 1), "image-to-video");
  assert.equal(inferTask("video", 3), "reference-to-video");
});

test("input limits come from the route, and a route that lists no reference count cannot take references", () => {
  assert.deepEqual(inputLimits("text-to-video", route("a")), { min: 0, max: 0 });
  assert.deepEqual(inputLimits("image-to-video", route("a")), { min: 1, max: 1 });
  assert.deepEqual(inputLimits("image-to-image", route("a")), { min: 1, max: 1 });
  assert.deepEqual(inputLimits("image-to-image", route("a", { params: { maxReferenceImages: 4 } })), { min: 1, max: 4 });
  assert.deepEqual(inputLimits("reference-to-video", route("a", { params: { maxReferenceImages: 3 } })), { min: 1, max: 3 });
  assert.equal(inputLimits("reference-to-video", route("a")), null);
  assert.equal(inputLimits("video-to-video", route("a")), null);
  const r = route("a", { tasks: ["text-to-video", "reference-to-video", "video-to-video", "lipsync"] });
  assert.deepEqual(routeTasks(r), ["text-to-video"], "tasks the composer cannot feed are not offered");
  assert.deepEqual(modelTasks(model("acme/x", [r, route("b", { tasks: ["reference-to-video"], params: { maxReferenceImages: 2 } })])), ["text-to-video", "reference-to-video"]);
  assert.deepEqual(modelTasks(model("acme/lip", [route("a", { tasks: ["lipsync", "video-upscale"] })])), []);
});

test("a tray that does not fit the task names the problem and the allowed range", () => {
  const refs = route("a", { params: { maxReferenceImages: 4 } });
  assert.equal(inputProblem("text-to-video", refs, 0), null);
  assert.deepEqual(inputProblem("text-to-video", refs, 2), { code: "noImages", min: 0, max: 0, have: 2 });
  assert.deepEqual(inputProblem("image-to-video", refs, 0), { code: "needsImages", min: 1, max: 1, have: 0 });
  assert.deepEqual(inputProblem("reference-to-video", refs, 5), { code: "tooManyImages", min: 1, max: 4, have: 5 });
  assert.equal(inputProblem("reference-to-video", refs, 4), null);
  assert.equal(inputProblem("reference-to-video", route("a"), 1)?.code, "unsupported");
  assert.deepEqual(inputRoles("image-to-video", 1), ["first-frame"]);
  assert.deepEqual(inputRoles("image-to-image", 3), ["source-image", "reference-image", "reference-image"]);
  assert.deepEqual(inputRoles("reference-to-video", 2), ["reference-image", "reference-image"]);
  assert.deepEqual(inputRoles("text-to-image", 0), []);
});

test("automatic route: keyed direct first, then the cheapest keyed aggregator, never a keyless route", () => {
  const direct = route("direct", { route: "direct", pricing: [price(0.3)] });
  const dear = route("dear", { hasKey: true, pricing: [price(0.2)] });
  const cheap = route("cheap", { hasKey: true, pricing: [price(0.5), price(0.1)] });
  const unpriced = route("unpriced", { hasKey: true });
  const m = model("acme/clip", [unpriced, dear, cheap, direct]);
  assert.equal(lowestPrice(cheap, "video")?.usd, 0.1);
  assert.deepEqual(candidateRoutes(m).map((r) => r.adapter), ["direct", "cheap", "dear", "unpriced"]);
  assert.equal(autoRoute(m)?.adapter, "cheap", "the keyless direct route is skipped");
  assert.equal(autoRoute(model("acme/clip", [unpriced, dear, cheap, { ...direct, hasKey: true }]))?.adapter, "direct");
  assert.equal(autoRoute(model("acme/clip", [direct])), undefined);
  const imageOnly = route("i2v", { hasKey: true, tasks: ["image-to-video"], route: "direct" });
  assert.equal(autoRoute(model("acme/clip", [imageOnly, dear]), "text-to-video")?.adapter, "dear", "a route that cannot do the task is not chosen");
});

test("a pinned route is honored without a key and is never swapped; automatic names the route to add a key for", () => {
  const direct = route("direct", { route: "direct" });
  const agg = route("agg", { hasKey: true });
  const m = model("acme/clip", [agg, direct]);
  assert.deepEqual(resolveRoute(m, { adapter: "direct", routeMode: "pinned" }), { route: direct, state: "needs-key" });
  assert.deepEqual(resolveRoute(m, { adapter: "agg", routeMode: "pinned" }), { route: agg, state: "pinned" });
  assert.deepEqual(resolveRoute(m, { adapter: "direct", routeMode: "auto" }), { route: agg, state: "auto" });
  assert.deepEqual(resolveRoute(m, { adapter: "direct" }), { route: direct, state: "needs-key" }, "a selection saved before routeMode stays pinned");
  assert.deepEqual(resolveRoute(model("acme/clip", [route("agg"), direct]), { routeMode: "auto" }), { route: direct, state: "needs-key" });
  assert.equal(resolveRoute(model("acme/clip", []), { routeMode: "auto" }), undefined);
  assert.equal(resolveRoute(m, { adapter: "gone", routeMode: "pinned" })?.route.adapter, "agg", "a pinned route the catalog no longer lists falls back to automatic");
});

test("resolution labels order across the spellings the catalog uses", () => {
  const order = ["auto", "480p", "720P", "1K", "1080p", "1440p-sr", "2K", "4k", "8K"];
  assert.deepEqual([...order].sort((a, b) => resolutionRank(a) - resolutionRank(b)), order);
  assert.equal(resolutionRank("1024x1536"), 1536);
  assert.equal(resolutionRank("auto"), 0);
});

const CATALOG = [
  model("acme/fast", [route("fal", { hasKey: true, pricing: [price(0.05)], params: { durationsSec: [5], resolutions: ["480p", "720p"] } })]),
  model("acme/sharp", [route("fal", { hasKey: true, pricing: [price(0.4)], params: { durationsSec: [5, 8], resolutions: ["720p", "4k"], nativeAudio: true } })]),
  model("acme/long", [route("fal", { hasKey: true, pricing: [price(0.2)], params: { durationsSec: [5, 15], resolutions: ["720p"] } })]),
  model("beta/plain", [route("fal", { hasKey: true, pricing: [price(0.2)], params: { durationsSec: [5], resolutions: ["720p"] } })]),
  model("beta/locked", [route("beta", { route: "direct", pricing: [price(0.01)], params: { durationsSec: [5, 20], resolutions: ["1080p"] } })]),
  model("beta/lipsync", [route("beta", { tasks: ["lipsync"] })]),
  model("beta/still", [route("beta", { tasks: ["text-to-image"], hasKey: true })], { kind: "image" }),
];

test("the list holds only models of the kind that can do the task, narrowed by search, maker and feature chips", () => {
  const base = { kind: "video" as const, task: "text-to-video" as const };
  const ids = (list: MediaModel[]) => list.map((m) => m.id);
  assert.deepEqual(ids(filterModels(CATALOG, base)), ["acme/fast", "acme/sharp", "acme/long", "beta/plain", "beta/locked"]);
  assert.deepEqual(ids(filterModels(CATALOG, { ...base, query: "ACME sha" })), ["acme/sharp"]);
  assert.deepEqual(ids(filterModels(CATALOG, { ...base, vendor: "beta" })), ["beta/plain", "beta/locked"]);
  assert.deepEqual(ids(filterModels(CATALOG, { ...base, features: ["mine"] })), ["acme/fast", "acme/sharp", "acme/long", "beta/plain"]);
  assert.deepEqual(ids(filterModels(CATALOG, { ...base, features: ["sharp", "long"] })), ["beta/locked"]);
  assert.deepEqual(ids(filterModels(CATALOG, { ...base, features: ["audio"] })), ["acme/sharp"]);
  assert.deepEqual(ids(filterModels(CATALOG, { kind: "video", task: "reference-to-video" })), []);
  assert.deepEqual(ids(filterModels(CATALOG, { kind: "image", task: "text-to-image" })), ["beta/still"]);
  assert.deepEqual(ids(unsupportedModels(CATALOG, "video")), ["beta/lipsync"]);
  assert.deepEqual(offeredFeatures(filterModels(CATALOG, base), "video", "text-to-video"), ["mine", "audio", "sharp", "long"]);
  assert.deepEqual(offeredFeatures(filterModels(CATALOG, { kind: "image", task: "text-to-image" }), "image", "text-to-image"), [], "a chip that would change nothing is not offered");
});

test("row facts, sorting, groups and suggestions come from catalog data", () => {
  const list = filterModels(CATALOG, { kind: "video", task: "text-to-video" });
  assert.deepEqual(modelFacts(CATALOG[1]!, "text-to-video"), { price: price(0.4), resolutions: { low: "720p", high: "4k", rank: 2160 },
    durations: { min: 5, max: 8 }, audio: true, routes: 1, runnable: true });
  const ids = (l: MediaModel[]) => l.map((m) => m.id);
  assert.deepEqual(ids(sortModels(list, "price", "text-to-video")), ["beta/locked", "acme/fast", "acme/long", "beta/plain", "acme/sharp"]);
  assert.deepEqual(ids(sortModels(list, "resolution", "text-to-video"))[0], "acme/sharp");
  assert.deepEqual(ids(sortModels(list, "duration", "text-to-video")).slice(0, 2), ["beta/locked", "acme/long"]);
  assert.deepEqual(ids(sortModels(list, "catalog", "text-to-video")), ids(list));
  const groups = groupModels(list, ["video:beta/locked", "video:acme/long", "image:acme/fast"], "text-to-video");
  assert.deepEqual(ids(groups.recent), ["acme/long"], "a keyless model never appears under Recent");
  assert.deepEqual(ids(groups.ready), ["acme/fast", "acme/sharp", "beta/plain"]);
  assert.deepEqual(ids(groups.needsKey), ["beta/locked"]);
  assert.deepEqual(suggestModels(list, "text-to-video").map((s) => [s.model.id, s.reason]),
    [["acme/fast", "cheapest"], ["acme/sharp", "sharpest"], ["acme/long", "longest"]]);
  assert.deepEqual(suggestModels(list.slice(0, 3), "text-to-video"), [], "three or fewer runnable models need no suggestion");
});

test("a runnable model is described by the route that would run; a model that needs a key by its best case", () => {
  const direct = route("direct", { route: "direct", pricing: [price(0.1)], params: { durationsSec: [5, 15], resolutions: ["720p", "1080p"], nativeAudio: true } });
  const keyed = route("fal", { hasKey: true, pricing: [price(0.3)], params: { durationsSec: [5, 8], resolutions: ["480p", "720p"] } });
  const mine = modelFacts(model("acme/clip", [direct, keyed]), "text-to-video");
  assert.deepEqual([mine.price?.usd, mine.resolutions?.high, mine.durations?.max, mine.audio, mine.routes, mine.runnable], [0.3, "720p", 8, false, 2, true]);
  const locked = modelFacts(model("acme/clip", [direct, { ...keyed, hasKey: false }]), "text-to-video");
  assert.deepEqual([locked.price?.usd, locked.resolutions?.high, locked.durations?.max, locked.audio, locked.runnable], [0.1, "1080p", 15, true, false]);
});

test("switching model keeps allowed settings, moves the rest to listed values and reports each move", () => {
  const from = route("fal", { hasKey: true, params: { durationsSec: [5, 10, 15], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16"], nativeAudio: true, seed: true, negativePrompt: true } });
  const first = reconcileSelection(model("acme/a", [from]), from, "text-to-video", null, "auto");
  assert.deepEqual(first, { selection: { kind: "video", model: "acme/a", adapter: "fal", task: "text-to-video", routeMode: "auto", label: "a", vendor: "acme", routeLabel: "fal", durationSec: 5, resolution: "720p" }, adjusted: [] });
  const tuned = { ...first.selection, durationSec: 15, resolution: "1080p", aspectRatio: "9:16", audio: true, seed: 42, negativePrompt: "blur" };
  const to = route("kling", { route: "direct", hasKey: true, tasks: ["image-to-video"], params: { durationsSec: [5, 10], resolutions: ["720P", "1080P"], aspectRatios: ["16:9"] } });
  const next = reconcileSelection(model("acme/b", [to]), to, "text-to-video", tuned, "pinned");
  assert.deepEqual(next.selection, { kind: "video", model: "acme/b", adapter: "kling", task: "image-to-video", routeMode: "pinned", label: "b", vendor: "acme", routeLabel: "kling", durationSec: 10, resolution: "1080P" });
  assert.deepEqual(next.adjusted, [
    { field: "task", from: "text-to-video", to: "image-to-video" }, { field: "durationSec", from: "15", to: "10" },
    { field: "aspectRatio", from: "9:16", to: null }, { field: "audio", from: "true", to: null },
    { field: "seed", from: "42", to: null }, { field: "negativePrompt", from: "set", to: null },
  ]);
  assert.deepEqual(reconcileSelection(model("acme/a", [from]), from, "text-to-video", tuned, "auto").adjusted, [], "nothing is reported when everything still fits");
  assert.equal(defaultDuration([4, 6, 8]), 4);
  assert.equal(defaultResolution(["4K", "1K", "2K"]), "1K");
  assert.equal(defaultResolution(undefined), undefined);
});

test("seeds are whole numbers in the provider range, and saved selections are re-validated on load", () => {
  assert.equal(parseSeed("42"), 42);
  assert.equal(parseSeed(" 0 "), 0);
  for (const bad of ["", "1.5", "-3", "1e3", "abc", "99999999999"]) assert.equal(parseSeed(bad), undefined, bad);
  assert.equal(parseMediaSelection(null), null);
  assert.equal(parseMediaSelection({ kind: "audio", model: "a/b", adapter: "x", task: "t" }), null);
  assert.equal(parseMediaSelection({ kind: "video", model: "", adapter: "x", task: "t" }), null);
  assert.deepEqual(parseMediaSelection({ kind: "video", model: "a/b", adapter: "fal", task: "text-to-video", routeMode: "auto", label: "B", routeLabel: "fal.ai", routeMark: "https://evil.example/x.svg", durationSec: 5, seed: 1.5, audio: "yes", extra: 1 }),
    { kind: "video", model: "a/b", adapter: "fal", task: "text-to-video", routeMode: "auto", label: "B", routeLabel: "fal.ai", durationSec: 5 });
  assert.equal(parseMediaSelection({ kind: "image", model: "a/b", adapter: "fal", task: "text-to-image" })?.routeMode, "pinned");
});

// ── Results: what a media row says and how it is made again (L11) ──
const { isMediaResult, remakePlan, resultAdapter, resultCost } = await import("../ui/src/lib/mediaResult.js");

test("a media result is recognised by its provider, and its cost prefers what the provider billed", () => {
  assert.equal(isMediaResult({ provider: "media:fal", model: "acme/clip" }), true);
  assert.equal(isMediaResult({ provider: "grok", model: "grok-imagine-video" }), false);
  assert.equal(isMediaResult({ provider: "media:fal", model: "" }), false);
  assert.equal(resultAdapter({ provider: "media:fal" }), "fal");
  assert.equal(resultAdapter({ provider: "media:fal", adapter: "replicate" }), "replicate");
  assert.equal(resultAdapter({ provider: "oauth" }), null);
  assert.deepEqual(resultCost({ billed: { usd: 0.31 }, estimate: { usd: 0.25, basis: "exact" } }), { kind: "billed", usd: 0.31 });
  assert.deepEqual(resultCost({ billed: { units: 5 }, estimate: { usd: 0.25, basis: "exact" } }), { kind: "estimate", usd: 0.25 });
  assert.deepEqual(resultCost({ estimate: { usd: 0.5, basis: "upper-bound" } }), { kind: "ceiling", usd: 0.5 });
  assert.equal(resultCost({ estimate: { usd: null, basis: "upper-bound" } }), null);
  assert.equal(resultCost({}), null, "a row from before the server kept costs shows no cost line");
});

test("making a result again restores its model, pinned route and settings against today's catalog", () => {
  const fal = route("fal", { hasKey: true, tasks: ["text-to-video", "image-to-video"], params: { durationsSec: [5, 10], resolutions: ["480p", "720p"], aspectRatios: ["16:9", "9:16"], seed: true, nativeAudio: true } });
  const direct = route("direct", { route: "direct", hasKey: true, params: { durationsSec: [5], resolutions: ["720p"] } });
  const models = [model("acme/clip", [direct, fal])];
  const row = { provider: "media:fal", adapter: "fal", model: "acme/clip", mediaType: "video",
    media: { task: "text-to-video", durationSec: 10, resolution: "480p", aspectRatio: "9:16", seed: 7, audio: true, inputRoles: [] } };
  assert.deepEqual(remakePlan(row, models), { ok: true, adjusted: [], inputsDropped: false,
    selection: { kind: "video", model: "acme/clip", adapter: "fal", task: "text-to-video", routeMode: "pinned", label: "clip", vendor: "acme", routeLabel: "fal",
      durationSec: 10, resolution: "480p", aspectRatio: "9:16", seed: 7, audio: true } });
  // The route it ran on is gone: Automatic takes over and says which settings moved.
  const gone = remakePlan({ ...row, adapter: "replicate", provider: "media:replicate" }, models);
  assert.equal(gone.ok && gone.selection.adapter, "direct");
  assert.equal(gone.ok && gone.selection.routeMode, "auto");
  assert.deepEqual(gone.ok && gone.adjusted.map((entry) => entry.field), ["durationSec", "resolution", "aspectRatio", "audio", "seed"]);
  // A result made from an image keeps its task and says the image has to be added again.
  const fromImage = remakePlan({ ...row, media: { task: "image-to-video", inputRoles: ["first-frame"] } }, models);
  assert.equal(fromImage.ok && fromImage.selection.task, "image-to-video");
  assert.equal(fromImage.ok && fromImage.inputsDropped, true);
  // An older row without the settings block still restores the model and route with listed defaults.
  const bare = remakePlan({ provider: "media:fal", model: "acme/clip", mediaType: "video" }, models);
  assert.deepEqual(bare.ok && [bare.selection.adapter, bare.selection.task, bare.selection.durationSec, bare.selection.resolution], ["fal", "text-to-video", 5, "720p"]);
  assert.deepEqual(remakePlan({ ...row, model: "acme/retired" }, models), { ok: false, reason: "model-gone" });
  assert.deepEqual(remakePlan({ provider: "oauth", model: "gpt-6-luna" }, models), { ok: false, reason: "not-media" });
});
