// What an image edit, upscale, vectorize or separate job may carry on each route: the images it takes (and
// in which role), whether it takes a mask, and which common fields (params.taskFields, params.inputs).
// Each declaration is checked against the adapter by handing it requests and seeing which it refuses
// before its first provider call, after the same spec check every client request goes through.
import test from "node:test";
import assert from "node:assert/strict";
import type {
  MediaAdapterContext, MediaInputRole, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest, MediaTask, MediaTaskFieldName,
} from "../lib/providers/media/contract.ts";
import { BUILTIN_MEDIA_ADAPTERS } from "../lib/providers/media/adapters.ts";
import { validateAgainstSpec, type MediaJobBody } from "../lib/providers/media/validate.ts";

const IMAGE: readonly MediaTask[] = ["image-to-image", "image-upscale", "image-vectorize", "image-segment"];
const FIELDS: readonly MediaTaskFieldName[] = ["prompt", "negativePrompt", "resolution", "aspectRatio", "seed", "count", "quality"];
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

/**
 * Adapters whose requests reach the provider without being checked here, so "the adapter took it" proves
 * nothing. None today: every declared route below is held to "declared is exactly what the adapter takes".
 * An adapter added here is held only to "what is declared is accepted", and must say why in its models file.
 */
const NOT_CHECKED_BY_ADAPTER: readonly string[] = [];

interface Route { adapter: MediaProviderAdapter; spec: MediaModelSpec; task: MediaTask }
const routes: Route[] = BUILTIN_MEDIA_ADAPTERS.flatMap((adapter) => adapter.listModels()
  .flatMap((spec) => spec.tasks.filter((task) => IMAGE.includes(task)).map((task) => ({ adapter, spec, task }))));
const declared = routes.filter((route) => route.spec.params.taskFields?.[route.task]);
const name = (route: Route) => route.adapter.id + " " + route.spec.id + " " + route.task;
const needs = (route: Route) => (route.spec.params.inputs ?? []).filter((need) => !need.tasks || need.tasks.includes(route.task));

function valueOf(route: Route, field: MediaTaskFieldName): string | number {
  const entry = route.spec.params.taskFields?.[route.task], p = route.spec.params;
  if (field === "prompt") return "make the door red";
  if (field === "negativePrompt") return "blur";
  if (field === "resolution") return (entry?.resolutions ?? p.resolutions)?.[0] ?? "1024x1024";
  if (field === "aspectRatio") return (entry?.aspectRatios ?? p.aspectRatios)?.find((ratio) => !/adaptive|auto/i.test(ratio)) ?? "1:1";
  if (field === "quality") return p.qualities?.[0] ?? "high";
  return field === "count" ? 2 : 7;
}

function request(route: Route, fields: readonly MediaTaskFieldName[], roles: readonly MediaInputRole[]): MediaSubmitRequest {
  return {
    model: route.spec.id, task: route.task,
    inputs: roles.map((role, i) => ({ role, url: "https://example.test/" + role + "-" + i + ".png", bytes: PNG, mimeType: "image/png" })),
    ...Object.fromEntries(fields.map((field) => [field, valueOf(route, field)])),
  };
}

/** True when the request passes the spec check and the adapter gets as far as calling the provider. */
async function reaches(route: Route, body: MediaSubmitRequest): Promise<boolean> {
  try {
    validateAgainstSpec(route.spec, { ...body, inputs: body.inputs.map((input) => ({ role: input.role, ref: "x" })) } as unknown as MediaJobBody);
  } catch {
    return false;
  }
  const { adapter } = route;
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
  const extra = Object.fromEntries((adapter.credential.extraFields ?? []).filter((f) => f.required).map((f) => [f.name, "extra-value"]));
  const ctx: MediaAdapterContext = { apiKey: "test-key-0123456789", extra, fetch: fetchImpl };
  // An adapter takes inputs as links or as files; hand it the shape it works with.
  const shaped = { ...body, inputs: body.inputs.map((input) => (adapter.inputTransport === "url" ? { role: input.role, url: input.url!, mimeType: input.mimeType } : { role: input.role, bytes: input.bytes!, mimeType: input.mimeType })) };
  await adapter.submit(ctx, shaped).catch(() => undefined);
  return calls > 0;
}

/** The fewest inputs the declaration allows, images first. */
const minimal = (route: Route): MediaInputRole[] => needs(route).flatMap((need) => Array.from({ length: need.min }, () => need.role));

test("image routes declare their task forms", () => {
  const count = (adapterId: string, task: MediaTask) => declared.filter((r) => r.adapter.id === adapterId && r.task === task).length;
  assert.equal(count("openai", "image-to-image"), 5);
  assert.ok(count("fal", "image-to-image") > 10 && count("fal", "image-upscale") > 0);
  assert.ok(count("recraft", "image-upscale") === 2 && count("recraft", "image-vectorize") === 1);
  assert.ok(declared.length >= 100, "expected the image routes to be declared, got " + declared.length);
});

test("an image declaration is well formed", () => {
  for (const route of declared) {
    const entry = route.spec.params.taskFields![route.task]!;
    for (const field of entry.accepts) assert.ok(FIELDS.includes(field), name(route) + " accepts " + field);
    for (const field of entry.requires ?? []) assert.ok(entry.accepts.includes(field), name(route) + " requires " + field + " without accepting it");
    const images = needs(route).filter((need) => need.role === "source-image" || need.role === "reference-image");
    assert.ok(images.length > 0 && images.reduce((sum, need) => sum + need.min, 0) >= 1, name(route) + " does not declare the image it works on");
    for (const need of needs(route)) assert.ok(need.max >= Math.max(1, need.min) && need.max <= 16, name(route) + " " + need.role + " max " + need.max);
    assert.ok(needs(route).filter((need) => need.role === "mask").length <= 1);
  }
});

for (const route of declared) {
  test(name(route) + ": the adapter takes what the route declares", async () => {
    const entry = route.spec.params.taskFields![route.task]!;
    const strict = !NOT_CHECKED_BY_ADAPTER.includes(route.adapter.id);
    const required = entry.requires ?? [], base = minimal(route);
    assert.ok(await reaches(route, request(route, required, base)), "refused the smallest declared form: " + JSON.stringify({ required, base }));
    for (const field of required) {
      if (strict) assert.equal(await reaches(route, request(route, required.filter((f) => f !== field), base)), false, field + " is declared required but the adapter runs without it");
    }
    for (const field of FIELDS.filter((f) => !required.includes(f))) {
      const taken = await reaches(route, request(route, [...required, field], base));
      if (entry.accepts.includes(field)) assert.ok(taken, field + " is declared accepted but refused");
      else if (strict) assert.ok(!taken, field + " is not declared but the adapter takes it");
    }
    for (const need of needs(route)) {
      const others = base.filter((role) => role !== need.role);
      const with_ = (n: number) => [...Array.from({ length: n }, () => need.role), ...others];
      assert.ok(await reaches(route, request(route, required, with_(need.max))), need.max + " " + need.role + " inputs are declared but refused");
      if (strict && need.max < 16) assert.equal(await reaches(route, request(route, required, with_(need.max + 1))), false, (need.max + 1) + " " + need.role + " inputs are taken but " + need.max + " declared");
    }
    if (strict && !needs(route).some((need) => need.role === "mask")) {
      assert.equal(await reaches(route, request(route, required, [...base, "mask"])), false, "a mask is taken but not declared");
    }
  });
}

test("a direct route that declares nothing for an image task refuses a plain form", async () => {
  for (const route of routes.filter((r) => !r.spec.params.taskFields?.[r.task] && r.adapter.route === "direct")) {
    for (const role of ["source-image", "reference-image"] as const) for (const fields of [[], ["prompt"]] as const) {
      assert.equal(await reaches(route, request(route, fields, [role])), false, name(route) + " runs a plain form but declares none");
    }
  }
});
