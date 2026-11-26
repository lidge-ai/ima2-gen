import { test } from "node:test";
import assert from "node:assert/strict";
import { directorCast } from "../lib/workflows/definitions/directorCast.js";
import { directorLocations } from "../lib/workflows/definitions/directorLocations.js";
import { directorCinema } from "../lib/workflows/definitions/directorCinema.js";
import { estimatePlan } from "../lib/workflows/cost.js";
import { validateValues } from "../lib/workflows/validate.js";
import type { MediaModelSpec } from "../lib/providers/media/contract.js";
import type { StepRuntime, WorkflowDefinition, WorkflowValues } from "../lib/workflows/types.js";

const model = "google/nano-banana-pro";
const models = { image: { model, route: "test-route" } };
const env = { catalog: () => undefined };
const options = { allowedRoots: [] };
const scene = { url: "https://example.com/scene.png", mimeType: "image/png" };
const character = { url: "https://example.com/character.png", mimeType: "image/png" };
const rt = { asInput: async (ref, role) => ({ role, url: "url" in ref ? ref.url : undefined, mimeType: ref.mimeType }) } as StepRuntime;

for (const definition of [directorCast, directorLocations, directorCinema]) {
  test(`${definition.id}: render and switch with references`, async () => {
    const cinema = definition === directorCinema;
    const raw = { prompt: "A quiet harbor", aspectRatio: cinema ? "3:4" : "4:3", resolution: "1k", ...(!cinema && { n: 3 }),
      ...(definition !== directorCast && { camera: "35mm-film", lens: "anamorphic", palette: "golden-hour" }) };
    const values = await validateValues(definition, raw, options);
    const plan = definition.plan(values, models, env);
    assert.equal(plan.workflowId, definition.id);
    assert.equal(plan.steps.length, 1);
    const step = plan.steps[0];
    assert.ok(step && step.kind === "media");
    assert.equal(step.id, "render");
    assert.equal(step.final, true);
    assert.equal(step.outputKind, "image");
    assert.equal(step.slot, "image");
    assert.equal(step.model, model);
    assert.equal(step.route, "test-route");
    assert.deepEqual(step.units, { unit: "image", quantity: cinema ? 1 : 3, variant: "1k" });
    const request = await step.build(rt);
    assert.equal(request.model, model);
    assert.equal(request.task, "text-to-image");
    assert.equal(request.count, cinema ? 1 : 3);
    assert.equal(request.aspectRatio, raw.aspectRatio);
    assert.equal(request.resolution, "1k");
    assert.deepEqual(request.inputs, []);
    assert.match(request.prompt!, /A quiet harbor/);
    if (definition !== directorCast) {
      assert.match(request.prompt!, /35mm motion picture film/);
      assert.match(request.prompt!, /anamorphic lenses/);
      assert.match(request.prompt!, /golden hour/);
    }
    const refs = await validateValues(definition, { ...raw, images: [scene], ...(cinema && { characterImage: [character] }) }, options);
    const withRefs = definition.plan(refs, models, env).steps[0];
    assert.ok(withRefs && withRefs.kind === "media");
    const edited = await withRefs.build(rt);
    assert.equal(edited.task, "image-to-image");
    assert.deepEqual(edited.inputs, (cinema ? [scene, character] : [scene]).map((ref) => ({ role: "reference-image", ...ref })));
    await assert.rejects(validateValues(definition, { ...raw, unknown: true }, options), /not an input/);
    await assert.rejects(validateValues(definition, { ...raw, n: 5 }, options));
  });
}

for (const definition of [directorLocations, directorCinema]) {
  test(`${definition.id}: rejects conflicting palettes`, async () => {
    await assert.rejects(validateValues(definition, { prompt: "test", palette: "golden-hour", paletteColors: ["#000000", "#ffffff"] }, options), /choose a palette/);
  });
}

test("estimate uses count and resolution price", () => {
  const spec: MediaModelSpec = {
    id: model, upstreamId: model, vendor: "google", label: "Image", kind: "image", tasks: ["text-to-image"], params: {}, docsUrl: "https://ai.google.dev/",
    pricing: [{ unit: "image", usd: 0.134, variant: "2k", source: "https://ai.google.dev/gemini-api/docs/pricing", checkedAt: "2026-11-26" }],
  };
  const values: WorkflowValues = { prompt: "test", n: 3, resolution: "2k" };
  const plan = (directorCast as WorkflowDefinition).plan(values, models, env);
  const estimate = estimatePlan(plan, { catalog: () => spec });
  assert.equal(estimate.usd, 0.402);
  assert.equal(estimate.complete, true);
});
