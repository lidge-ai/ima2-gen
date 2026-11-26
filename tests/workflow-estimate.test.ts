// Workflow estimates on real catalogs (no network): Seedance billed per token on BytePlus, the
// ChatGPT subscription image step at $0, and a web instance without session routes falling back to
// a keyed image model with a price.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { BUILTIN_MEDIA_ADAPTERS } from "../lib/providers/media/adapters.js";
import { MODELS as BYTEPLUS_MODELS } from "../lib/providers/media/direct/byteplus/models.js";
import { MediaRegistry } from "../lib/providers/media/registry.js";
import type { SessionRoute } from "../lib/providers/media/sessionRoutes.js";
import { createWorkflowGateway } from "../lib/providers/media/workflowGateway.js";
import { priceFor } from "../lib/workflows/cost.js";
import { getWorkflow } from "../lib/workflows/index.js";
import { prepareWorkflow } from "../lib/workflows/runner.js";
import type { MediaStep } from "../lib/workflows/types.js";
import { workflowSessionRoutes } from "../routes/workflows.js";
import { fakeLocal, tempDir, writeFixture } from "./_workflowFakes.js";

const root = tempDir("ima2-wf-estimate-");
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const dancer = writeFixture(root, "dancer.mp4", "source-video");
const robot = writeFixture(root, "robot.png", "robot");
const local = fakeLocal({ "dancer.mp4": { durationSec: 5.06, width: 720, height: 1280, hasAudio: true } }, { "dancer.mp4": [] });
const chatgpt: SessionRoute = { adapterId: "openai", label: "ChatGPT subscription (GPT OAuth)", open: async () => ({ apiKey: "session" }) };
const seedance = (id: string) => BYTEPLUS_MODELS.find((m) => m.id === id);

async function prepare(id: string, values: Record<string, unknown>, sessionRoutes: Record<string, SessionRoute>, selection?: unknown) {
  const deps = { registry: new MediaRegistry(BUILTIN_MEDIA_ADAPTERS), generatedDir: root, inputsDir: root, configFile: root + "/no-config.json", env: { ARK_API_KEY: "test-ark-key" }, thumbnails: false };
  const gateway = await createWorkflowGateway(deps, { sessionRoutes, planText: async () => ({}) });
  const request = { values: { video: [{ path: dancer, mimeType: "video/mp4" }], ...values }, ...(selection ? { selection } : {}) };
  return prepareWorkflow(getWorkflow(id)!, request, { gateway, local, allowedRoots: [root] }, new AbortController().signal);
}
const step = (p: Awaited<ReturnType<typeof prepare>>, id: string) => p.estimate.steps.find((s) => s.stepId === id);

test("Seedance on BytePlus is estimated from its official token rate: (input s + output s) x width x height x 24 / 1024", async () => {
  const p = await prepare("remix-motion-transfer-open", { images: [{ path: robot, mimeType: "image/png" }], resolution: "720p" }, {}, { models: { render: "bytedance/seedance-2" } });
  const render = step(p, "render");
  // 9:16 720p renders 720x1280; the reference render bills the 5.06 s source plus the 6 s output.
  assert.deepEqual(render?.units, { unit: "1k-tokens", quantity: 238.896, variant: "video-in 720p" });
  assert.equal(render?.usd, 1.0273);
  assert.equal(render?.approximate, true);
  assert.match(render?.note ?? "", /5\.06 s in \+ 6 s out\) x 720x1280 x 24 fps \/ 1024 = 238896 tokens/);
  assert.match(render?.note ?? "", /minimum/);
  assert.match(render?.source ?? "", /docs\.byteplus\.com\/en\/docs\/ModelArk\/model-pricing/);
  assert.equal(p.estimate.complete, true);
  assert.equal(p.estimate.approximate, true);
});

test("without session routes (the web instance) the image step plans a keyed model with a price, so the run is fully priced", async () => {
  const p = await prepare("remix-motion-transfer-open", { images: [{ path: robot, mimeType: "image/png" }], resolution: "720p" }, {}, { models: { render: "bytedance/seedance-2" } });
  const subject = p.plan.steps.find((s) => s.id === "subject-first") as MediaStep;
  assert.deepEqual([subject.model, subject.route], ["bytedance/seedream-5.5", undefined]);
  assert.equal(step(p, "subject-first")?.usd, 0.035, "highest listed Seedream 5.5 image price, marked approximate");
  assert.equal(step(p, "subject-first")?.approximate, true);
  assert.equal(p.estimate.usd, 1.0623);
  assert.equal(p.estimate.complete, true);
});

test("an image step on the ChatGPT subscription is $0 and says so", async () => {
  const p = await prepare("remix-motion-transfer-open", { images: [{ path: robot, mimeType: "image/png" }], resolution: "720p" }, { "openai-oauth": chatgpt }, { models: { render: "bytedance/seedance-2" } });
  const subject = p.plan.steps.find((s) => s.id === "subject-first") as MediaStep;
  assert.deepEqual([subject.model, subject.route], ["openai/gpt-image-2", "openai-oauth"]);
  assert.equal(step(p, "subject-first")?.usd, 0);
  assert.equal(step(p, "subject-first")?.note, "included in the ChatGPT subscription (GPT OAuth)");
  assert.equal(p.estimate.usd, 1.0273);
  assert.equal(p.estimate.complete, true);
});

test("a Seedance 2.5 video edit bills the source as input and output at the 2.5 video-in rate", async () => {
  const p = await prepare("remix-object-swap", { images: [{ path: robot, mimeType: "image/png" }], target: "the dancer", resolution: "720p" }, {}, { models: { render: "bytedance/seedance-2.5" } });
  const render = step(p, "render");
  assert.deepEqual(render?.units, { unit: "1k-tokens", quantity: 218.592, variant: "video-in 720p" });
  assert.equal(render?.usd, 1.399);
  assert.equal(p.estimate.complete, true);
});

test("per-second prices match by resolution prefix; a variant the model does not list is still unpriced", () => {
  const spec = seedance("bytedance/seedance-2");
  assert.equal(priceFor(spec, { unit: "second", quantity: 5, variant: "720p" }).usd, 0.75);
  assert.equal(priceFor(spec, { unit: "second", quantity: 5, variant: "720p+audio" }).usd, 0.75);
  assert.equal(priceFor(spec, { unit: "second", quantity: 5, variant: "2k" }).usd, null);
  assert.equal(priceFor(spec, { unit: "image", quantity: 1 }).usd, null, "a unit the model does not list is never guessed");
});

test("the web instance offers no subscription routes; a local instance offers the signed-in ones", () => {
  const ctx = { oauthUrl: "http://127.0.0.1:1", oauthTransport: "native", config: {} };
  assert.deepEqual(Object.keys(workflowSessionRoutes({ ...ctx, webAccess: { spend: {} } } as never)), []);
  assert.deepEqual(Object.keys(workflowSessionRoutes(ctx as never)).sort(), ["openai-oauth", "xai-oauth"]);
});
