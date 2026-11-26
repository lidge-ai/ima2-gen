// Workflow runs on the web instance (L9): a run is admitted only with a complete
// published-price estimate inside the caps, and the ledger names the person.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolatedConfigDir = await mkdtemp(join(tmpdir(), "ima2-web-workflow-"));
process.env.IMA2_CONFIG_DIR = isolatedConfigDir;

const { config } = await import("../config.ts");
const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { registerWorkflowRoutes } = await import("../routes/workflows.ts");
const { _resetForTest: resetBus } = await import("../lib/eventBus.ts");
const { _resetForTests: resetInflight } = await import("../lib/inflight.ts");
const { createSpendGuard } = await import("../lib/webAccess/spendGuard.ts");
const { FAKE_KEY, fakeSpec, fakeTransport, makeFakeAdapter } = await import("./_mediaFakeAdapter.ts");
type WorkflowDefinition = import("../lib/workflows/types.ts").WorkflowDefinition;

test.after(async () => { await rm(isolatedConfigDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
test.afterEach(() => { resetBus(); resetInflight(); });

const VIDEO_URL = "https://cdn.fake.example/out/clip.mp4";

function flow(id: string, seconds: number, model = "acme/clip-1") {
  return {
    id, label: id, description: "one fake clip", equivalents: [],
    fields: [{ type: "text", name: "prompt", label: "Prompt", required: true, maxLength: 200 }],
    slots: [{ name: "render", label: "Render", task: "text-to-video", defaultModel: model, alternatives: [], rationale: "test" }],
    plan(values: Record<string, unknown>, slots: Record<string, { model: string }>) {
      const chosen = slots.render!.model;
      return { workflowId: id, steps: [{
        id: "render", label: "Render", kind: "media", dependsOn: [], final: true, slot: "render", model: chosen, outputKind: "video",
        units: { unit: "second", quantity: seconds, variant: "720p" },
        build: async () => ({ model: chosen, task: "text-to-video", prompt: String(values.prompt), durationSec: 5, inputs: [] }),
      }] };
    },
  } as unknown as WorkflowDefinition;
}

const noLocalOps = {
  probe: async () => { throw new Error("no media fields"); },
  frame: async () => { throw new Error("unused"); },
  muxAudio: async () => { throw new Error("unused"); },
  concat: async () => { throw new Error("unused"); },
  cut: async () => { throw new Error("unused"); },
};

test("workflow runs pass the spend guard: priced runs are charged with the email, others never start", async t => {
  const root = await mkdtemp(join(tmpdir(), "ima2-web-workflow-app-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify({ fakeApiKey: FAKE_KEY }));
  const adapter = makeFakeAdapter({
    models: [fakeSpec("acme/clip-1"), fakeSpec("acme/free-1", { pricing: [] })],
    script: { states: [{ status: "succeeded", outputs: [{ kind: "video", url: VIDEO_URL, mimeType: "video/mp4" }] }], submitted: [] },
  });
  const transport = fakeTransport({ downloads: { [VIDEO_URL]: { body: "mp4", type: "video/mp4" } } });
  const spend = createSpendGuard({ dailyCapUsd: 15, requestCapUsd: 3, ledgerFile: join(root, "ledger.json"), timeZone: "UTC" });
  const ctx = { rootDir: root, packageVersion: "test", webAccess: { spend },
    config: { ...config, storage: { ...config.storage, configFile, configDir: root, generatedDir: join(root, "generated") }, log: { ...config.log, level: "silent" } } };
  const deps = { registry: new MediaRegistry([adapter]), fetch: transport.fetch, env: {}, thumbnails: false, sleep: async () => { await new Promise(r => setImmediate(r)); } };
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.webUser = { email: "jun@example.test" }; next(); });
  registerWorkflowRoutes(app, ctx as never, { deps, workflows: [flow("cheap", 5), flow("long", 120), flow("unpriced", 5, "acme/free-1")], local: noLocalOps, sessionRoutes: {} });
  const server = await new Promise<import("node:http").Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(async () => { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const base = "http://127.0.0.1:" + (server.address() as import("node:net").AddressInfo).port;
  const run = (id: string) => fetch(base + "/api/workflows/" + id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "wf-" + id, values: { prompt: "a fox" } }) });

  const unpriced = await run("unpriced");
  assert.equal(unpriced.status, 403);
  assert.equal((await unpriced.json()).code, "WEB_SPEND_UNPRICED");
  const long = await run("long");
  assert.equal(long.status, 402);
  assert.equal((await long.json()).code, "WEB_SPEND_REQUEST_CAP");
  assert.equal(adapter.script.submitted!.length, 0, "refused runs never reach the provider");

  const ok = await run("cheap");
  assert.equal(ok.status, 202, await ok.clone().text());
  const status = await spend.status();
  assert.equal(status.spentUsd, 0.25);
  assert.equal(status.entries[0]!.email, "jun@example.test");
  assert.equal(status.entries[0]!.model, "workflow:cheap");
});
