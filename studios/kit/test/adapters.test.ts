import { test } from "node:test";
import assert from "node:assert/strict";
import { toCatalog, toKeyStatuses, toWireSubmit, fromWireJob, nameParts } from "../src/adapt.ts";
import { JobCache } from "../src/client.ts";
import { toWorkflowDef, toWireRun, toEstimate, localizeWorkflow } from "../src/adaptWorkflow.ts";
import { toHistoryPage, historyParams } from "../src/adaptHistory.ts";
import { reduceJobEvent } from "../src/jobReducer.ts";
import { wireCatalog } from "../src/fake/catalog.ts";
import { Keys } from "../src/fake/keys.ts";
import { workflows, estimateWorkflow } from "../src/fake/workflows.ts";
import { makeCatalog } from "../src/fake/catalog.ts";
import { resolutionParts, tidyResolutions } from "../src/resolutions.ts";

test("catalog, key, submit and job adapters translate wire records", () => {
  const wire = wireCatalog(new Keys(["openai"]));
  const catalog = toCatalog(wire);
  assert.equal(catalog.models.find((m) => m.id === "openai/gpt-image-2")?.routes[0]?.keyConfigured, true);
  assert.equal(toKeyStatuses(wire).find((k) => k.keyVocabulary === "openai")?.source, "config");
  assert.deepEqual(
    toWireSubmit({
      model: "openai/gpt-image-2",
      task: "text-to-image",
      inputs: [{ role: "source-image", inputId: "input:a.png" }],
      provider: "openai",
      clientRequestId: "r",
    }),
    {
      model: "openai/gpt-image-2",
      task: "text-to-image",
      inputs: [{ role: "source-image", ref: "input:a.png" }],
      adapter: "openai",
      requestId: "r",
    },
  );
  assert.equal(fromWireJob({ requestId: "r", kind: "media", startedAt: 0, status: "canceled" }).status, "canceled");
  // A job read back after it finished (no events seen) still reads as complete.
  assert.equal(fromWireJob({ requestId: "r", kind: "media", startedAt: 0, status: "completed" }).progress, 1);
});
test("workflow and history adapters translate values, estimates and cursors", () => {
  const wire = workflows.find((w) => w.id === "director-cast")!,
    def = toWorkflowDef(wire);
  assert.equal(def.inputs.find((i) => i.name === "prompt")?.required, true);
  // A step shows the server's one-sentence description only; reviewer notes never reach the screen.
  const slot = { ...wire.slots[0]!, description: "Draws the character sheet." };
  assert.equal(toWorkflowDef({ ...wire, slots: [slot] }).steps[0]?.description, "Draws the character sheet.");
  const { description: _shown, ...bare } = slot;
  const older = toWorkflowDef({ ...wire, slots: [Object.assign(bare, { rationale: "reviewer note" })] });
  assert.equal(older.steps[0]?.description, undefined);
  assert.equal("rationale" in older.steps[0]!, false);
  assert.deepEqual(
    toWireRun({ inputs: { images: [{ role: "reference-image", inputId: "input:a.png" }], prompt: "scene" } }, def)
      .values,
    { images: [{ ref: "input:a.png" }], prompt: "scene" },
  );
  const estimate = toEstimate(estimateWorkflow(wire, { prompt: "x" }, makeCatalog(new Set(["fal"]))));
  assert.ok(estimate.steps.length);
  const page = toHistoryPage(
    {
      items: [
        {
          filename: "a.png",
          url: "/generated/a.png",
          thumb: null,
          mediaType: "image",
          createdAt: 1,
          prompt: "x",
          model: "m",
          provider: "media:fal",
          requestId: "r",
          kind: "media",
          isFavorite: true,
        },
      ],
      total: 1,
      nextCursor: { before: 1, beforeFilename: "a.png" },
    },
    {},
  );
  assert.equal(page.items[0]?.provider, "fal");
  // Audio is always asked for: the server leaves it out by default and the studio lists it like any result.
  assert.deepEqual(historyParams({ cursor: page.nextCursor! }), { limit: 40, includeAudio: "1", before: "1", beforeFilename: "a.png" });
  assert.deepEqual(historyParams({ kind: "video", q: " fox ", order: "oldest", sinceMs: 5, models: true, cursor: "a:7|b.mp4" }),
    { limit: 40, includeAudio: "1", mediaType: "video", q: "fox", order: "asc", since: 5, facets: "model", after: "7", afterFilename: "b.mp4" });
});
test("reducer applies planned, step, done and cancellation events", () => {
  const base = { requestId: "r", jobKind: "workflow" },
    steps = [{ id: "render", label: "Render", kind: "media", dependsOn: [], model: "m", final: true }];
  const planned = reduceJobEvent(undefined, "planned", { ...base, steps, estimate: { steps: [] } })!;
  const started = reduceJobEvent(planned.job, "step", { ...base, stepId: "render", status: "started" })!;
  assert.equal(started.job.steps?.[0]?.status, "running");
  const done = reduceJobEvent(started.job, "done", {
    ...base,
    outputs: [{ filename: "a.png", url: "/generated/a.png", mediaType: "image", mimeType: "image/png", bytes: 5 }],
  })!;
  assert.equal(done.job.status, "succeeded");
  assert.equal(done.job.outputs[0]?.historyId, "a.png");
  assert.equal(reduceJobEvent(started.job, "error", { ...base, code: "GENERATION_CANCELED" })?.job.status, "canceled");
});

test("a retiring model keeps a clean name and a retiring flag", () => {
  assert.deepEqual(nameParts("GPT Image 2 (deprecated)"), { label: "GPT Image 2", retiring: true });
  assert.deepEqual(nameParts("Seedance 2.5"), { label: "Seedance 2.5" });
  assert.deepEqual(nameParts("Kling 3 (Legacy) "), { label: "Kling 3", retiring: true });
  assert.deepEqual(nameParts("Veo 3.1 (fast)"), { label: "Veo 3.1 (fast)" });
  assert.deepEqual(nameParts("(deprecated)"), { label: "(deprecated)" });
});

test("a workflow reads in Korean from the server's i18n.ko, and stays English where nothing was translated", () => {
  const def = toWorkflowDef(workflows.find((w) => w.id === "remix-object-swap")!);
  const ko = localizeWorkflow(def, "ko");
  assert.equal(ko.label, "리믹스: 사물 바꾸기");
  assert.equal(ko.inputs.find((i) => i.name === "images")?.description, "공연할 사람이나 사물 이미지 1~8장, 순서대로.");
  assert.deepEqual(ko.params.find((p) => p.name === "tier")?.options?.map((o) => [o.value, o.label]), [["standard", "표준"], ["lite", "라이트"]]);
  assert.equal(ko.steps.find((s) => s.id === "render")?.label, "영상 만들기");
  assert.equal(ko.id, def.id);
  assert.equal(localizeWorkflow(def, "en"), def);
});

test("an estimate carries the model and route the server planned for each step", () => {
  const est = toEstimate({
    estimate: { usd: 0.4, complete: true, steps: [{ stepId: "subject-first", usd: 0.035 }] },
    steps: [{ id: "subject-first", label: "Subject frame", kind: "media", dependsOn: [], model: "bytedance/seedream-5.5", route: "byteplus", slot: "subject", final: false }],
  } as never);
  assert.equal(est.steps[0]?.model, "bytedance/seedream-5.5");
  assert.equal(est.steps[0]?.route, "byteplus");
  assert.equal(est.steps[0]?.slot, "subject");
});

test("a running job that the server reports finished reads as complete, whatever events showed", () => {
  const cache = new JobCache();
  const running = fromWireJob({ requestId: "r", kind: "media", startedAt: 0, phase: "running", meta: { model: "m" } });
  cache.remember({ ...running, progress: 0.4 });
  const merged = cache.merge({ requestId: "r", kind: "media", startedAt: 0, status: "completed", finishedAt: 10, meta: { model: "m" } });
  assert.equal(merged.status, "succeeded");
  assert.equal(merged.progress, 1);
});

test("a model's settings merged from its routes list each size once, in order, and every clip length in order", () => {
  const catalog = toCatalog(wireCatalog(new Keys(["fal"])));
  const seedance = catalog.models.find((m) => m.id === "bytedance/seedance-2.5")!;
  // The aggregator route lists 1-3 s after 15 s and spells "480P"; the direct route lists "480p".
  assert.deepEqual(seedance.params.durationsSec, [1, 2, 3, 4, 5, 8, 10, 12, 15]);
  assert.deepEqual(seedance.params.resolutions, ["480P", "720p", "720p-sr", "1080p", "1080p-esr & 60fps"]);
  const image = catalog.models.find((m) => m.id === "openai/gpt-image-2")!;
  assert.deepEqual(image.params.resolutions, ["1k", "2k", "4k"]);
  // Each route keeps its own list for sending.
  assert.deepEqual(image.routeParams?.openai?.resolutions, ["1K", "2K"]);
});

test("resolution values read as a size, an upscale tier and a frame rate", () => {
  assert.deepEqual(resolutionParts("1080p-esr & 60fps"), { base: "1080p", tier: "esr", fps: 60 });
  assert.deepEqual(resolutionParts("720p-SR"), { base: "720p", tier: "sr" });
  assert.deepEqual(resolutionParts("4k"), { base: "4K" });
  assert.deepEqual(resolutionParts("1.5k"), { base: "1.5K" });
  assert.equal(resolutionParts("2x"), null);
  assert.deepEqual(tidyResolutions(["4k", "1080p", "2x", "480P", "480p", "1440p-sr"]), ["480P", "1080p", "1440p-sr", "4k", "2x"]);
});

test("a keyless local route keeps its place in the catalog and has no key status", () => {
  const wire = wireCatalog(new Keys(["openai"]));
  const local = {
    id: "comfy-local", label: "ComfyUI (this computer)", route: "local" as const, keyVocabulary: "comfy-local", consoleUrl: "https://docs.comfy.org",
    keyPrefix: null, hasKey: true, keyless: true, keySource: "none", extraFields: [], modelCount: 1,
  };
  const model = {
    id: "comfy/klein", label: "Klein", vendor: "comfy", kind: "image" as const, tasks: ["text-to-image" as const], defaultRoute: "comfy-local",
    routes: [{ adapter: "comfy-local", route: "local" as const, label: local.label, upstreamId: "klein", tasks: ["text-to-image" as const], params: {}, pricing: [], docsUrl: "https://docs.comfy.org", hasKey: true, keyless: true }],
  };
  const withLocal = { models: [...wire.models, model], adapters: [...wire.adapters, local] };
  const catalog = toCatalog(withLocal);
  assert.deepEqual(catalog.models.find((m) => m.id === "comfy/klein")?.routes.map((r) => [r.providerId, r.route, r.keyConfigured, r.keyless]), [["comfy-local", "local", true, true]]);
  assert.equal(catalog.providers.find((p) => p.id === "comfy-local")?.keyless, true);
  assert.equal(catalog.providers.find((p) => p.id === "openai")?.keyless, undefined);
  assert.equal(toKeyStatuses(withLocal).some((k) => k.keyVocabulary === "comfy-local"), false, "nothing to save a key for");
  assert.equal(toKeyStatuses(withLocal).length, toKeyStatuses(wire).length);
});

test("a clip's length limit arrives as numbers, so each screen words it in its own language", () => {
  const def = toWorkflowDef(workflows.find((w) => w.id === "remix-restyle")!);
  const video = def.inputs.find((i) => i.name === "video")!;
  assert.deepEqual(video.durationSec, { min: 4, max: 15 });
  assert.equal(video.description, undefined);
  assert.equal(localizeWorkflow(def, "ko").inputs.find((i) => i.name === "video")?.description, undefined);
});

test("a cut list reaches the server as ordered shots, and its field reads in the screen's language", () => {
  const wire = workflows.find((w) => w.id === "director-studio")!;
  const def = toWorkflowDef(wire);
  assert.deepEqual(def.shots, {
    name: "shots", label: "Shots", min: 2, max: 6, promptMaxLength: 1000, maxTotalSec: 60,
    description: "Optional cut list: 2-6 shots in order, each with its own prompt and whole seconds, up to 60 seconds in all. Leave Length empty when you use it.",
  });
  // The cut list is its own thing: not a file input and not a setting tile.
  assert.equal(def.inputs.some((i) => i.name === "shots"), false);
  assert.equal(def.params.some((p) => p.name === "shots"), false);
  assert.equal(localizeWorkflow(def, "ko").shots?.label, "컷 목록");
  assert.equal(toWorkflowDef(workflows.find((w) => w.id === "director-cinema")!).shots, undefined);
  const shots = [{ prompt: " She opens the door ", durationSec: 4 }, { prompt: "Rain on the window", durationSec: 8 }];
  assert.deepEqual(toWireRun({ inputs: { prompt: "" }, params: { resolution: "720p" }, shots }, def).values, {
    prompt: "", resolution: "720p", shots: [{ prompt: "She opens the door", durationSec: 4 }, { prompt: "Rain on the window", durationSec: 8 }],
  });
  // Without shots nothing about them is sent, so a planned clip goes out as before.
  assert.deepEqual(toWireRun({ inputs: { prompt: "scene" }, params: { duration: 5 }, shots: [] }, def).values, { prompt: "scene", duration: 5 });
});
