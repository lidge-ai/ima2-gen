import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { getProviderAdapter, listProviderAdapters } from "../lib/providers/adapters/index.js";
import { getProvider, REGISTRY } from "../lib/providers/registry.js";
import type { RuntimeContext } from "../lib/runtimeContext.js";

/**
 * The contract every ProviderAdapterV1 must satisfy (#150).
 *
 * It iterates listProviderAdapters rather than naming providers, so the day a
 * second adapter is registered it inherits every assertion here without anyone
 * remembering to extend this file. That automatic coverage is one of #150's
 * acceptance criteria.
 */
/**
 * Minimal workflow record: the assertions read only `id` and
 * `bind.refImage` (which decides whether the lane reports edit support).
 */
const FIXTURE_COMFY_WORKFLOW = {
  id: "fixture-workflow",
  label: "Fixture",
  origin: "http://127.0.0.1:8188",
  graph: {},
  bind: { prompt: { node: "6", input: "text" }, output: { node: "9" } },
  params: [],
  mediaKind: "image",
  createdAt: 0,
  updatedAt: 0,
};

function contextWith(key: string | undefined): RuntimeContext {
  // One shared key value per registered lane. Note the spelling split the
  // adapters have to survive: atlasCloudApiKey (capital C) vs lane id
  // "atlascloud".
  //
  // The comfy lane has no credential at all: what decides whether it is usable
  // is whether a workflow is registered, so its two-state rides the same switch
  // as the keys. That state must arrive through RuntimeContext — a module-level
  // store cache could not be empty and non-empty for the two calls below.
  return {
    apiKey: key,
    xaiApiKey: key,
    geminiApiKey: key,
    minimaxApiKey: key,
    atlasCloudApiKey: key,
    api88ImageKey: key,
    api88VideoKey: key,
    naiApiKey: key,
    comfyWorkflows: key ? [FIXTURE_COMFY_WORKFLOW] : [],
  } as unknown as RuntimeContext;
}

const withKey = contextWith("test-key");
const withoutKey = contextWith(undefined);

/**
 * Expected no-credential reason per registered lane. A new adapter must add
 * its row here, which keeps the auth two-state assertion real (not vacuous)
 * for every lane the suite iterates.
 */
const EXPECTED_AUTH_REASON: Record<string, RegExp> = {
  api: /OpenAI API key missing/,
  "grok-api": /xAI API key missing/,
  "gemini-api": /Gemini API key or Vertex service account missing/,
  minimax: /MiniMax API key missing/,
  atlascloud: /Atlas Cloud API key missing/,
  "88api": /88API image key missing/,
  comfy: /workflow/i,
  nai: /NovelAI API token missing/,
};

test("at least one adapter is registered", () => {
  assert.ok(listProviderAdapters(withKey).length >= 1);
});

test("every adapter implements the required members", () => {
  for (const adapter of listProviderAdapters(withKey)) {
    assert.equal(typeof adapter.laneId, "string", "adapter must name its lane");
    assert.equal(typeof adapter.validateAuth, "function");
    assert.equal(typeof adapter.listModels, "function");
    assert.equal(typeof adapter.normalizeError, "function");
  }
});

test("every adapter lane exists in the capability registry", () => {
  const known = new Set(REGISTRY.map((manifest) => manifest.id as string));
  for (const adapter of listProviderAdapters(withKey)) {
    assert.ok(known.has(adapter.laneId), `${adapter.laneId} is not a registry lane`);
  }
});

test("listModels comes from the registry, not a hand-written list", () => {
  for (const adapter of listProviderAdapters(withKey)) {
    const manifest = getProvider(adapter.laneId);
    if (manifest.catalogAccess === "runtime") {
      // A runtime-catalog lane's registry models are [] by construction, so
      // comparing the two would pass vacuously and assert nothing. Branch
      // explicitly and check the invariant that actually holds: the adapter
      // projects exactly the workflows its context carries.
      assert.deepEqual(
        adapter.listModels().map((model) => model.id),
        (withKey.comfyWorkflows ?? []).map((workflow) => workflow.id),
        `${adapter.laneId} must report exactly the runtime catalog`,
      );
      assert.deepEqual(
        getProviderAdapter(withoutKey, adapter.laneId)!.listModels(),
        [],
        `${adapter.laneId} must report nothing when its catalog is empty`,
      );
      continue;
    }
    assert.deepEqual(
      adapter.listModels().map((model) => model.id),
      manifest.models.map((model) => model.id),
      `${adapter.laneId} must report exactly the registry's models`,
    );
  }
});

test("no adapter source hard-codes a model id", () => {
  // A literal here would drift from the registry silently, which is the exact
  // failure the capability registry was built to prevent.
  for (const adapter of listProviderAdapters(withKey)) {
    const source = readFileSync(
      new URL(`../lib/providers/adapters/${adapter.laneId}.ts`, import.meta.url),
      "utf8",
    );
    for (const model of getProvider(adapter.laneId).models) {
      assert.ok(
        !source.includes(`"${model.id}"`),
        `${adapter.laneId}.ts hard-codes model id ${model.id}; derive it from the registry`,
      );
    }
  }
});

test("validateAuth reflects live credentials from the runtime context", () => {
  // Not process.env: routes/keys.ts updates the context while the server runs,
  // so an env read would report a lane unauthenticated right after setup.
  // Iterates every registered adapter so the two-state assertion stays real
  // for each new lane instead of only covering the reference implementation.
  for (const adapter of listProviderAdapters(withKey)) {
    const expectedReason = EXPECTED_AUTH_REASON[adapter.laneId];
    assert.ok(expectedReason, `add ${adapter.laneId} to EXPECTED_AUTH_REASON`);

    assert.deepEqual(adapter.validateAuth(), { ok: true }, `${adapter.laneId} with key`);

    const absent = getProviderAdapter(withoutKey, adapter.laneId);
    assert.ok(absent);
    const result = absent!.validateAuth();
    assert.equal(result.ok, false, `${adapter.laneId} without key`);
    assert.match(result.reason ?? "", expectedReason);
  }
});

test("the Comfy image adapter ignores catalog-only video workflows", () => {
  const videoOnly = {
    comfyWorkflows: [{ ...FIXTURE_COMFY_WORKFLOW, id: "h3", mediaKind: "video" }],
  } as unknown as RuntimeContext;
  const adapter = getProviderAdapter(videoOnly, "comfy");
  assert.deepEqual(adapter?.validateAuth(), { ok: false, reason: "No ComfyUI workflow registered" });
  assert.deepEqual(adapter?.listModels(), []);
});

test("normalizeError owns the lane's error vocabulary", () => {
  for (const adapter of listProviderAdapters(withKey)) {
    const prefix = getProvider(adapter.laneId).errorPrefix;
    if (!prefix) continue;

    const unauthorized = adapter.normalizeError(Object.assign(new Error("bad key"), { status: 401 }));
    assert.ok(unauthorized.code.startsWith(prefix), `${adapter.laneId} must prefix its codes with ${prefix}`);
    assert.equal(unauthorized.retryable, false, "a rejected credential is not worth retrying");
    assert.equal(unauthorized.status, 401);

    const throttled = adapter.normalizeError(Object.assign(new Error("slow down"), { status: 429 }));
    assert.equal(throttled.retryable, true, "throttling is transient");

    const upstream = adapter.normalizeError(Object.assign(new Error("boom"), { status: 502 }));
    assert.equal(upstream.retryable, true);

    const unknown = adapter.normalizeError("something odd");
    assert.ok(unknown.code.startsWith(prefix));
    assert.equal(unknown.retryable, false, "an unrecognized failure is not assumed retryable");
  }
});

test("an existing provider-specific code is preserved, not double-prefixed", () => {
  const adapter = getProviderAdapter(withKey, "minimax");
  const normalized = adapter!.normalizeError(
    Object.assign(new Error("empty payload"), { status: 502, code: "MINIMAX_IMAGE_INVALID" }),
  );
  assert.equal(normalized.code, "MINIMAX_IMAGE_INVALID");
});

test("an unregistered lane returns null so its current path is untouched", () => {
  // OAuth proxy readiness, Grok health and Antigravity binary detection are async.
  for (const lane of ["oauth", "grok", "agy"] as const) {
    assert.equal(getProviderAdapter(withKey, lane), null, `${lane} needs async readiness before descriptor registration`);
  }
});

for (const { name, credentials, expected } of [
  { name: "key-only credentials", credentials: { geminiApiKey: "key" }, expected: { ok: true } },
  { name: "Vertex-only credentials", credentials: { vertexServiceAccountJson: "{}" }, expected: { ok: true } },
  { name: "both credentials", credentials: { geminiApiKey: "key", vertexServiceAccountJson: "{}" }, expected: { ok: true } },
  { name: "neither credential", credentials: {}, expected: { ok: false, reason: "Gemini API key or Vertex service account missing" } },
]) {
  test(`gemini-api ${expected.ok ? "accepts" : "rejects"} ${name}`, () => {
    const ctx = { ...withoutKey, ...credentials } as RuntimeContext;
    assert.deepEqual(getProviderAdapter(ctx, "gemini-api")?.validateAuth(), expected);
  });
}

test("legacy lanes own their execution", () => {
  for (const lane of ["nai", "minimax", "atlascloud", "88api", "comfy"] as const) {
    assert.equal(typeof getProviderAdapter(withKey, lane)?.prepareImageExecution, "function", lane);
  }
  for (const lane of ["api", "grok-api", "gemini-api"] as const) {
    const adapter = getProviderAdapter(withKey, lane);
    assert.ok(adapter, `${lane} descriptor must be registered`);
    assert.equal(adapter.prepareImageExecution, undefined, lane);
  }
});

test("api normalizes errors without a provider prefix", () => {
  const adapter = getProviderAdapter(withKey, "api")!;
  assert.deepEqual(adapter.normalizeError(Object.assign(new Error("busy"), { code: "rate_limit", statusCode: 429 })), {
    code: "rate_limit", message: "busy", status: 429, retryable: true,
  });
  assert.deepEqual(adapter.normalizeError("unknown failure"), {
    code: "UNKNOWN", message: "unknown failure", retryable: false,
  });
});

test("88API descriptor image auth never substitutes the video key", () => {
  for (const [image, video, expected] of [[undefined, undefined, false], [undefined, "video", false],
    ["image", undefined, true], ["image", "video", true], ["   ", "video", false]] as const) {
    const ctx = { ...withoutKey, api88ImageKey: image, api88VideoKey: video } as RuntimeContext;
    assert.equal(getProviderAdapter(ctx, "88api")?.validateAuth().ok, expected);
  }
});
