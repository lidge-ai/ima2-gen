// What a talking-video model needs to run (lip-sync, avatar, dubbing, subtitles): every UI reads the
// same declaration from the catalog, so a form built from it must be a request the adapter accepts.
import test from "node:test";
import assert from "node:assert/strict";
import type { MediaAdapterContext, MediaInputRole, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest, MediaTask } from "../lib/providers/media/contract.ts";
import { BUILTIN_MEDIA_ADAPTERS } from "../lib/providers/media/adapters.ts";
import { MediaRegistry } from "../lib/providers/media/registry.ts";
import { MediaKeySnapshot } from "../lib/providers/media/credentials.ts";
import { buildMediaCatalog } from "../lib/providers/media/catalog.ts";
import { paramsFromSchemas, type EndpointSchema } from "../lib/providers/media/aggregator/shared/fields.ts";
import { billedInputSeconds, withBilledLength } from "../lib/providers/media/inputLength.ts";
import { estimateMediaUsd } from "../lib/webAccess/spendGuard.ts";

// Tasks whose form is media inputs: the talking-video ones, and sound made for a video.
const TALKING: readonly MediaTask[] = ["lipsync", "avatar", "dubbing", "subtitles", "video-to-audio"];
const MIME: Record<string, string> = { image: "image/png", video: "video/mp4", audio: "audio/mpeg" };
const kindOf = (role: MediaInputRole) => (role.endsWith("audio") ? "audio" : role.endsWith("video") ? "video" : "image");

function forTask<T extends { tasks?: readonly MediaTask[] }>(list: readonly T[] | undefined, task: MediaTask): T[] {
  return (list ?? []).filter((entry) => !entry.tasks || entry.tasks.includes(task));
}

/** The request a form makes when a person fills exactly what the route declares, and nothing else. */
function minimalRequest(spec: MediaModelSpec, task: MediaTask): MediaSubmitRequest {
  const inputs = forTask(spec.params.inputs, task).flatMap((need) =>
    Array.from({ length: need.min }, (_, i) => ({ role: need.role, url: "https://example.test/" + need.role + "-" + i, mimeType: MIME[kindOf(need.role)]! })));
  const vendorOptions = Object.fromEntries(forTask(spec.params.options, task).filter((o) => o.required)
    .map((o) => [o.name, o.type === "enum" ? o.values![0]! : o.type === "boolean" ? true : "text"]));
  return {
    model: spec.id, task, inputs,
    ...(spec.params.resolutions?.length ? { resolution: spec.params.resolutions[0]! } : {}),
    ...(Object.keys(vendorOptions).length ? { vendorOptions } : {}),
  };
}

function recordingCtx(adapter: MediaProviderAdapter): { ctx: MediaAdapterContext; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
  // Only the fields a key needs; optional ones (a region) keep the adapter's default.
  const extra = Object.fromEntries((adapter.credential.extraFields ?? []).filter((f) => f.required).map((f) => [f.name, "extra-value"]));
  return { ctx: { apiKey: "test-key-0123456789", extra, fetch: fetchImpl }, calls };
}

const declared = BUILTIN_MEDIA_ADAPTERS.flatMap((adapter) => adapter.listModels()
  .filter((spec) => spec.params.inputs?.length)
  // Edit, extend and upscale forms are checked in media-task-fields.test.ts.
  .flatMap((spec) => spec.tasks.filter((task) => TALKING.includes(task) && forTask(spec.params.inputs, task).length > 0).map((task) => ({ adapter, spec, task }))));

test("the direct talking-video routes say which inputs they need", () => {
  const byRoute = new Map(declared.map((d) => [d.adapter.id + ":" + d.spec.id + ":" + d.task, d.spec]));
  const roles = (key: string) => forTask(byRoute.get(key)?.params.inputs, key.split(":")[2] as MediaTask).map((n) => n.role + " " + n.min + "-" + n.max);
  assert.deepEqual(roles("veed:veed/veed-fabric-1.0:avatar"), ["source-image 1-1", "source-audio 1-1"]);
  assert.deepEqual(roles("veed:veed/veed-lipsync:lipsync"), ["source-video 1-1", "source-audio 1-1"]);
  assert.deepEqual(roles("veed:veed/veed-dubbing:dubbing"), ["source-video 1-1"]);
  assert.deepEqual(roles("sync:sync/sync-lipsync-3:lipsync"), ["source-video 1-1", "source-audio 1-1"]);
  assert.deepEqual(roles("byteplus-vision:bytedance/omnihuman-1.5:avatar"), ["source-image 1-1", "source-audio 1-1"]);
  assert.deepEqual(roles("heygen:heygen/heygen-avatar-6:avatar"), ["reference-image 1-1", "source-audio 1-1"]);
  assert.deepEqual(roles("pixverse:pixverse/pixverse-lipsync:lipsync"), ["source-video 1-1", "source-audio 1-1"]);
  const dubbing = byRoute.get("veed:veed/veed-dubbing:dubbing")!.params.options!;
  const target = dubbing.find((o) => o.name === "target_language")!;
  assert.equal(target.required, true);
  assert.ok(target.values!.includes("ko") && target.values!.includes("en"));
  assert.deepEqual(dubbing.find((o) => o.name === "tier")!.values, ["standard", "pro"]);
});

test("every declared input set is for a task the model lists, with sane counts", () => {
  assert.ok(declared.length >= 10, "expected the talking routes to declare inputs, got " + declared.length);
  for (const { adapter, spec, task } of declared) assert.ok(TALKING.includes(task), adapter.id + " " + spec.id + " declares inputs for " + task);
  for (const { adapter, spec } of declared) {
    for (const need of spec.params.inputs!) {
      assert.ok(Number.isInteger(need.min) && need.min >= 0 && need.max >= Math.max(1, need.min), adapter.id + " " + spec.id + " " + need.role);
      for (const task of need.tasks ?? []) assert.ok(spec.tasks.includes(task), adapter.id + " " + spec.id + " declares inputs for " + task);
    }
    for (const option of spec.params.options ?? []) {
      assert.match(option.name, /^[A-Za-z][A-Za-z0-9_]*$/);
      if (option.type === "enum") assert.ok(option.values && option.values.length > 0, adapter.id + " " + spec.id + " " + option.name);
    }
  }
});

for (const { adapter, spec, task } of declared) {
  test(adapter.id + " accepts " + spec.id + " " + task + " built from its declared inputs", async () => {
    const { ctx, calls } = recordingCtx(adapter);
    const request = minimalRequest(spec, task);
    // The fake transport answers "{}", which no adapter takes for a job: only a refusal before the first call fails this.
    await adapter.submit(ctx, request).catch(() => undefined);
    assert.ok(calls.length > 0, "the adapter refused the declared form before calling the provider: " + JSON.stringify(request));
  });
}

test("routes built from a published endpoint schema derive inputs and options from it", () => {
  const dubbing: EndpointSchema = { endpoint: "acme/dub", task: "dubbing", required: ["video_url", "target_language"],
    fields: { video_url: { type: "string" }, target_language: { type: "string", enum: ["en", "ko"] }, keyterms: { type: "array", items: "string" }, lip: { type: "boolean" } } };
  const avatar: EndpointSchema = { endpoint: "acme/face", task: "avatar", required: ["image_url", "audio_url", "resolution"],
    fields: { image_url: { type: "string" }, audio_url: { type: "string" }, resolution: { type: "string", enum: ["480p", "720p"] }, motion_prompt: { type: "string" } } };
  const params = paramsFromSchemas([dubbing, avatar]);
  assert.deepEqual(params.inputs, [
    { role: "source-video", min: 1, max: 1, tasks: ["dubbing"], billedLength: true },
    { role: "source-image", min: 1, max: 1, tasks: ["avatar"] },
    { role: "source-audio", min: 1, max: 1, tasks: ["avatar"], billedLength: true },
  ]);
  assert.deepEqual(params.options, [
    { name: "target_language", type: "enum", values: ["en", "ko"], required: true, tasks: ["dubbing"] },
    { name: "lip", type: "boolean", tasks: ["dubbing"] },
    { name: "motion_prompt", type: "text", tasks: ["avatar"] },
  ]);
});

test("an endpoint whose required fields a form cannot fill declares nothing, and other tasks are left alone", () => {
  const needsSession: EndpointSchema = { endpoint: "acme/lip", task: "lipsync", required: ["video_url", "face_map"],
    fields: { video_url: { type: "string" }, audio_url: { type: "string" }, face_map: { type: "object" } } };
  const plain: EndpointSchema = { endpoint: "acme/t2v", task: "text-to-video", required: ["prompt"], fields: { prompt: { type: "string" }, style: { type: "string", enum: ["a", "b"] } } };
  const params = paramsFromSchemas([needsSession, plain]);
  assert.equal(params.inputs, undefined);
  assert.equal(params.options, undefined);
});

test("the catalog carries the declaration on each route, so every client reads the same thing", async () => {
  const registry = new MediaRegistry(BUILTIN_MEDIA_ADAPTERS);
  const keys = await MediaKeySnapshot.load("/nonexistent/ima2-config.json", {});
  const catalog = buildMediaCatalog(registry, keys);
  const fabric = catalog.models.find((m) => m.id === "veed/veed-fabric-1.0")!;
  const direct = fabric.routes.find((r) => r.adapter === "veed")!;
  assert.deepEqual(direct.params.inputs!.map((n) => n.role), ["source-image", "source-audio"]);
  const viaFal = fabric.routes.find((r) => r.adapter === "fal")!;
  assert.deepEqual(viaFal.params.inputs!.map((n) => n.role), ["source-image", "source-audio"]);
  assert.ok(!JSON.stringify(catalog).includes("test-key"));
});

test("a job billed by the length of its input is priced from the longest such input", async () => {
  const spec = BUILTIN_MEDIA_ADAPTERS.find((a) => a.id === "veed")!.listModels().find((m) => m.id === "veed/veed-lipsync")!;
  const request: MediaSubmitRequest = { model: spec.id, task: "lipsync", inputs: [
    { role: "source-video", bytes: new Uint8Array([1]), mimeType: "video/mp4" },
    { role: "source-audio", bytes: new Uint8Array([2]), mimeType: "audio/mpeg" },
  ] };
  const lengths: Record<string, number> = { "source-video": 4.2, "source-audio": 7.4 };
  const seconds = await billedInputSeconds(spec, request, async (input) => lengths[input.role] ?? null);
  assert.equal(seconds, 7.4);
  assert.deepEqual(estimateMediaUsd(spec, withBilledLength(request, seconds)), { usd: 0.56, basis: "exact" });
  // The adapter still receives the request without a duration it would refuse.
  assert.equal(request.durationSec, undefined);
});

test("an unreadable or remote input leaves the job unpriced instead of guessing a length", async () => {
  const spec = BUILTIN_MEDIA_ADAPTERS.find((a) => a.id === "veed")!.listModels().find((m) => m.id === "veed/veed-fabric-1.0")!;
  const request: MediaSubmitRequest = { model: spec.id, task: "avatar", resolution: "480p", inputs: [
    { role: "source-image", url: "https://example.test/face.png", mimeType: "image/png" },
    { role: "source-audio", url: "https://example.test/line.mp3", mimeType: "audio/mpeg" },
  ] };
  const seconds = await billedInputSeconds(spec, request, async () => null);
  assert.equal(seconds, null);
  assert.equal(estimateMediaUsd(spec, withBilledLength(request, seconds)).usd, null);
  const plain = { ...spec, params: { ...spec.params, inputs: undefined } } as unknown as MediaModelSpec;
  assert.equal(await billedInputSeconds(plain, request, async () => { throw new Error("must not probe"); }), null);
});

