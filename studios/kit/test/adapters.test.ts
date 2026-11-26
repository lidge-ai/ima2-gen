import { test } from "node:test";
import assert from "node:assert/strict";
import { toCatalog, toKeyStatuses, toWireSubmit, fromWireJob, nameParts } from "../src/adapt.ts";
import { toWorkflowDef, toWireRun, toEstimate, localizeWorkflow } from "../src/adaptWorkflow.ts";
import { toHistoryPage, historyParams } from "../src/adaptHistory.ts";
import { reduceJobEvent } from "../src/jobReducer.ts";
import { wireCatalog } from "../src/fake/catalog.ts";
import { Keys } from "../src/fake/keys.ts";
import { workflows, estimateWorkflow } from "../src/fake/workflows.ts";
import { makeCatalog } from "../src/fake/catalog.ts";

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
});
test("workflow and history adapters translate values, estimates and cursors", () => {
  const wire = workflows.find((w) => w.id === "director-cast")!,
    def = toWorkflowDef(wire);
  assert.equal(def.inputs.find((i) => i.name === "prompt")?.required, true);
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
  assert.deepEqual(historyParams({ cursor: page.nextCursor! }), { limit: 40, before: "1", beforeFilename: "a.png" });
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
