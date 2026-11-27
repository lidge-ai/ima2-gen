// What an edit, extend or upscale job may carry: each route says per task which common fields it takes
// (params.taskFields) and which inputs (params.inputs). Nothing here keeps a second list of what the
// adapters accept: every declaration is checked by handing the adapter requests and seeing which ones it
// refuses before its first call to the provider.
import test from "node:test";
import assert from "node:assert/strict";
import type {
  MediaAdapterContext, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest, MediaTask, MediaTaskFieldName, MediaTaskFields,
} from "../lib/providers/media/contract.ts";
import { BUILTIN_MEDIA_ADAPTERS } from "../lib/providers/media/adapters.ts";
import { MediaRegistry } from "../lib/providers/media/registry.ts";
import { MediaKeySnapshot } from "../lib/providers/media/credentials.ts";
import { buildMediaCatalog } from "../lib/providers/media/catalog.ts";
import { paramsFromSchemas, type EndpointSchema } from "../lib/providers/media/aggregator/shared/fields.ts";

const EDIT: readonly MediaTask[] = ["video-to-video", "video-extend", "video-upscale"];
const FIELDS: readonly MediaTaskFieldName[] = ["prompt", "negativePrompt", "durationSec", "resolution", "aspectRatio", "audio", "seed"];

function valueOf(spec: MediaModelSpec, entry: MediaTaskFields | undefined, field: MediaTaskFieldName): string | number | boolean {
  if (field === "prompt") return "make it snow";
  if (field === "negativePrompt") return "blur";
  if (field === "durationSec") return (entry?.durationsSec ?? spec.params.durationsSec)?.[0] ?? 5;
  if (field === "resolution") return (entry?.resolutions ?? spec.params.resolutions)?.[0] ?? "720p";
  if (field === "aspectRatio") return (entry?.aspectRatios ?? spec.params.aspectRatios)?.find((ratio) => !/adaptive|auto/i.test(ratio)) ?? "16:9";
  return field === "audio" ? true : 7;
}

function request(spec: MediaModelSpec, task: MediaTask, fields: readonly MediaTaskFieldName[]): MediaSubmitRequest {
  const entry = spec.params.taskFields?.[task];
  const needs = (spec.params.inputs ?? []).filter((need) => !need.tasks || need.tasks.includes(task));
  const roles = needs.length > 0 ? needs.flatMap((need) => Array.from({ length: need.min }, () => need.role)) : ["source-video" as const];
  return {
    model: spec.id, task,
    inputs: roles.map((role, i) => ({ role, url: "https://example.test/" + role + "-" + i + ".mp4", mimeType: "video/mp4" })),
    ...Object.fromEntries(fields.map((field) => [field, valueOf(spec, entry, field)])),
  };
}

/** True when the adapter got as far as calling the provider; false when it refused the request first. */
async function reaches(adapter: MediaProviderAdapter, body: MediaSubmitRequest): Promise<boolean> {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
  const extra = Object.fromEntries((adapter.credential.extraFields ?? []).filter((f) => f.required).map((f) => [f.name, "extra-value"]));
  const ctx: MediaAdapterContext = { apiKey: "test-key-0123456789", extra, fetch: fetchImpl };
  await adapter.submit(ctx, body).catch(() => undefined);
  return calls > 0;
}

const routes = BUILTIN_MEDIA_ADAPTERS.flatMap((adapter) => adapter.listModels()
  .flatMap((spec) => spec.tasks.filter((task) => EDIT.includes(task)).map((task) => ({ adapter, spec, task, entry: spec.params.taskFields?.[task] }))));
const declared = routes.filter((route) => route.entry);
const name = (route: { adapter: MediaProviderAdapter; spec: MediaModelSpec; task: MediaTask }) => route.adapter.id + " " + route.spec.id + " " + route.task;

test("the edit, extend and upscale routes are declared where a plain form can run them", () => {
  const by = (adapterId: string, task: MediaTask) => declared.filter((r) => r.adapter.id === adapterId && r.task === task).map((r) => r.spec.id);
  assert.deepEqual(by("xai-video", "video-extend"), ["xai/grok-imagine-video"]);
  assert.deepEqual(by("pixverse", "video-extend"), ["pixverse/pixverse-v6"]);
  assert.equal(by("byteplus", "video-extend").length, 5);
  assert.deepEqual(by("minimax", "video-upscale"), ["minimax/hailuo-h3-regen"]);
  assert.ok(by("fal", "video-to-video").length > 0 && by("fal", "video-upscale").length > 0);
  assert.ok(declared.length >= 30, "expected the edit routes to be declared, got " + declared.length);
});

test("a declaration is well formed: required fields are accepted ones, lists belong to accepted fields, and the source video is declared", () => {
  for (const route of declared) {
    const entry = route.entry!;
    for (const field of entry.accepts) assert.ok(FIELDS.includes(field), name(route) + " accepts unknown " + field);
    for (const field of entry.requires ?? []) assert.ok(entry.accepts.includes(field), name(route) + " requires " + field + " without accepting it");
    assert.ok(!entry.durationsSec || entry.accepts.includes("durationSec"), name(route) + " lists lengths it does not take");
    assert.ok(!entry.resolutions || entry.accepts.includes("resolution"), name(route) + " lists sizes it does not take");
    assert.ok(!entry.aspectRatios || entry.accepts.includes("aspectRatio"), name(route) + " lists ratios it does not take");
    const needs = (route.spec.params.inputs ?? []).filter((need) => !need.tasks || need.tasks.includes(route.task));
    assert.ok(needs.some((need) => need.role === "source-video" && need.min === 1), name(route) + " does not declare its source video");
  }
});

for (const route of declared) {
  test(name(route) + ": the adapter takes exactly the fields the route declares", async () => {
    const { adapter, spec, task } = route, entry = route.entry!;
    const required = entry.requires ?? [];
    assert.ok(await reaches(adapter, request(spec, task, required)), "refused the smallest declared form: " + JSON.stringify(request(spec, task, required)));
    for (const field of required) {
      assert.equal(await reaches(adapter, request(spec, task, required.filter((f) => f !== field))), false, field + " is declared required but the adapter runs without it");
    }
    // A size, ratio or length the route lists no values for is nothing a form could offer, so it may stay undeclared.
    const listed: Partial<Record<MediaTaskFieldName, readonly unknown[] | undefined>> = {
      durationSec: spec.params.durationsSec, resolution: spec.params.resolutions, aspectRatio: spec.params.aspectRatios,
    };
    for (const field of FIELDS.filter((f) => !required.includes(f))) {
      const taken = await reaches(adapter, request(spec, task, [...required, field]));
      if (entry.accepts.includes(field)) assert.ok(taken, field + " is declared accepted but the adapter refuses it");
      else if (!(field in listed) || listed[field]?.length) assert.ok(!taken, field + " is not declared but the adapter takes it");
    }
  });
}

test("a direct route that declares nothing for an edit task refuses a plain form, so leaving it out hides nothing that works", async () => {
  const silent = routes.filter((route) => !route.entry && route.adapter.route === "direct");
  for (const route of silent) {
    for (const fields of [[], ["prompt"], ["prompt", "durationSec", "resolution"]] as const) {
      assert.equal(await reaches(route.adapter, request(route.spec, route.task, fields)), false, name(route) + " runs a plain form but declares none");
    }
  }
});

test("a route built from an endpoint schema declares the edit task from that schema", () => {
  const edit: EndpointSchema = { endpoint: "acme/edit", task: "video-to-video", required: ["prompt", "video_url"],
    fields: { prompt: { type: "string" }, video_url: { type: "string" }, resolution: { type: "string", enum: ["720p", "1080p"] }, seed: { type: "integer" }, keep_audio: { type: "boolean" } } };
  const upscale: EndpointSchema = { endpoint: "acme/up", task: "video-upscale", required: ["video_url"],
    fields: { video_url: { type: "string" }, upscale_factor: { type: "number", minimum: 1, maximum: 4 } } };
  const create: EndpointSchema = { endpoint: "acme/t2v", task: "text-to-video", required: ["prompt"],
    fields: { prompt: { type: "string" }, duration: { type: "string", enum: ["5", "10"] }, resolution: { type: "string", enum: ["480p", "720p", "1080p"] }, aspect_ratio: { type: "string", enum: ["16:9"] } } };
  const params = paramsFromSchemas([create, edit, upscale]);
  assert.deepEqual(params.taskFields, {
    "video-to-video": { accepts: ["prompt", "resolution", "seed"], requires: ["prompt"], resolutions: ["720p", "1080p"] },
    "video-upscale": { accepts: [] },
  });
  assert.deepEqual(params.inputs, [
    { role: "source-video", min: 1, max: 1, tasks: ["video-to-video"], billedLength: true },
    { role: "source-video", min: 1, max: 1, tasks: ["video-upscale"], billedLength: true },
  ]);
  // The create task keeps reading the route's own lists.
  assert.deepEqual(params.resolutions, ["480p", "720p", "1080p"]);
});

test("an edit endpoint that needs something a form cannot fill is left undeclared", () => {
  const masked: EndpointSchema = { endpoint: "acme/inpaint", task: "video-to-video", required: ["video_url", "tracking_points"],
    fields: { video_url: { type: "string" }, tracking_points: { type: "object" }, prompt: { type: "string" } } };
  const extend: EndpointSchema = { endpoint: "acme/extend", task: "video-extend", required: ["video_url", "duration"],
    fields: { video_url: { type: "string" }, duration: { type: "integer", minimum: 2, maximum: 6 }, prompt: { type: "string" } } };
  const params = paramsFromSchemas([masked, extend]);
  assert.deepEqual(params.taskFields, { "video-extend": { accepts: ["prompt", "durationSec"], requires: ["durationSec"], durationsSec: [2, 3, 4, 5, 6] } });
  assert.deepEqual(params.inputs, [{ role: "source-video", min: 1, max: 1, tasks: ["video-extend"] }]);
});

test("the catalog carries the declaration on each route", async () => {
  const keys = await MediaKeySnapshot.load("/nonexistent/ima2-config.json", {});
  const catalog = buildMediaCatalog(new MediaRegistry(BUILTIN_MEDIA_ADAPTERS), keys, "video");
  const grok = catalog.models.find((m) => m.id === "xai/grok-imagine-video")!.routes.find((r) => r.adapter === "xai-video")!;
  assert.deepEqual(grok.params.taskFields!["video-to-video"], { accepts: ["prompt"], requires: ["prompt"] });
  assert.deepEqual(grok.params.taskFields!["video-extend"]!.accepts, ["prompt", "durationSec"]);
  assert.equal(grok.params.taskFields!["text-to-video"], undefined);
});
