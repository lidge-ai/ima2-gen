// Subscription routes (xai-oauth, openai-oauth) must point at adapters that exist and
// list the models L6's subscription presets put on them. A wrong adapter id only shows
// up at run time as MEDIA_ROUTE_UNKNOWN, after the user already started a paid workflow.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

const isolatedConfigDir = await mkdtemp(join(tmpdir(), "ima2-session-routes-"));
process.env.IMA2_CONFIG_DIR = isolatedConfigDir;
const { config } = await import("../config.ts");
const { createSessionRoutes } = await import("../lib/providers/media/sessionRoutes.ts");
const { getMediaRegistry } = await import("../lib/providers/media/registry.ts");
const { WORKFLOWS } = await import("../lib/workflows/index.ts");
const { registerHistoryRoutes } = await import("../routes/history.ts");

test.after(async () => { await rm(isolatedConfigDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

const ctx = { rootDir: isolatedConfigDir, oauthUrl: "http://127.0.0.1:9", config } as never;

test("every session route names a registered adapter", () => {
  const registry = getMediaRegistry();
  for (const [routeId, route] of Object.entries(createSessionRoutes(ctx))) {
    assert.ok(registry.getAdapter(route.adapterId), `${routeId} points at missing adapter ${route.adapterId}`);
  }
});

test("every workflow slot that defaults to a session route can run on that route's adapter", () => {
  const registry = getMediaRegistry();
  const routes = createSessionRoutes(ctx);
  let checked = 0;
  for (const wf of WORKFLOWS) {
    for (const slot of wf.slots) {
      const route = slot.defaultRoute ? routes[slot.defaultRoute] : undefined;
      if (!route) continue;
      const adapter = registry.getAdapter(route.adapterId);
      assert.ok(adapter, `${wf.id}/${slot.name}: ${slot.defaultRoute} has no adapter`);
      for (const model of [slot.defaultModel, ...slot.alternatives]) {
        const spec = adapter.listModels().find((m) => m.id === model);
        assert.ok(spec, `${wf.id}/${slot.name}: ${adapter.id} does not list ${model}`);
        assert.ok(spec.tasks.includes(slot.task), `${wf.id}/${slot.name}: ${model} on ${adapter.id} lacks ${slot.task}`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 2, "the subscription presets put at least two slots on session routes");
});

test("history lists audio and workflow provenance only when asked", async () => {
  const generatedDir = join(isolatedConfigDir, "generated-history");
  await mkdir(generatedDir, { recursive: true });
  await writeFile(join(generatedDir, "1_a.mp3"), "ID3audio");
  await writeFile(join(generatedDir, "1_a.mp3.json"), JSON.stringify({ mediaType: "audio", provider: "media:elevenlabs", adapter: "elevenlabs", createdAt: 2 }));
  await writeFile(join(generatedDir, "1_b.mp4"), "mp4");
  await writeFile(join(generatedDir, "1_b.mp4.json"), JSON.stringify({ mediaType: "video", workflow: "remix-restyle", workflowStep: "render", createdAt: 1 }));
  const app = express();
  registerHistoryRoutes(app, { rootDir: isolatedConfigDir, config: { ...config, storage: { ...config.storage, generatedDir } } } as never);
  const server = await new Promise<import("node:http").Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try {
    const plain = await (await fetch(`${base}/api/history`)).json() as { items: { filename: string; mediaType: string; workflow: string | null; workflowStep: string | null }[] };
    assert.deepEqual(plain.items.map((i) => i.filename), ["1_b.mp4"], "classic history stays image/video only");
    assert.equal(plain.items[0]!.workflow, "remix-restyle");
    assert.equal(plain.items[0]!.workflowStep, "render");
    const withAudio = await (await fetch(`${base}/api/history?includeAudio=1`)).json() as { items: { filename: string; mediaType: string; adapter: string | null }[] };
    const audio = withAudio.items.find((i) => i.filename === "1_a.mp3");
    assert.equal(audio?.mediaType, "audio");
    assert.equal(audio?.adapter, "elevenlabs");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
