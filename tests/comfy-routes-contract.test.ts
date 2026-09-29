import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import express from "express";

import { config } from "../config.js";
import { registerComfyRoutes } from "../routes/comfy.ts";
import { putWorkflow } from "../lib/comfyWorkflowStore.ts";
import { resolveProviderOptions } from "../lib/providerOptions.ts";

const GRAPH = {
  "3": { class_type: "KSampler", inputs: { seed: 1, steps: 20 } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "positive" }, _meta: { title: "Positive" } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "negative" }, _meta: { title: "Negative" } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "x" } },
};
const BIND = { prompt: { node: "6", input: "text" }, output: { node: "9" } };
const VIDEO_GRAPH = {
  "129": { class_type: "RandomNoise", inputs: { noise_seed: 42 } },
  "131": { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "waves", width: 864, height: 480, length: 243 } },
  "92": { class_type: "SaveVideo", inputs: { video: ["130", 0], filename_prefix: "video/h3" } },
};
const VIDEO_BIND = { prompt: { node: "131", input: "prompt" }, output: { node: "92" } };

const originalConfigDir = config.storage.configDir;
const originalFetch = globalThis.fetch;
const scratch: string[] = [];

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ima2-comfy-routes-"));
  scratch.push(dir);
  (config.storage as { configDir: string }).configDir = dir;

  const app = express();
  app.use(express.json({ limit: "20mb" }));
  registerComfyRoutes(app, { config } as never);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  // Probe results are fixture-owned, never dependent on a live local ComfyUI.
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(`${base}/api/`)) return originalFetch(input, init);
    throw new Error("Fixture ComfyUI origin is unreachable");
  };
  try {
    return await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    (config.storage as { configDir: string }).configDir = originalConfigDir;
  }
}

afterEach(async () => {
  (config.storage as { configDir: string }).configDir = originalConfigDir;
  while (scratch.length > 0) await rm(scratch.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("comfy workflow routes", () => {
  it("inspects a graph without saving it, and flags what a human must confirm", async () => {
    await withServer(async (base) => {
      const res = await post(base, "/api/comfy/inspect", { graph: GRAPH });
      const body = await res.json();
      assert.equal(res.status, 200);
      // Two CLIPTextEncode nodes cannot be told apart by the machine.
      assert.equal(body.needsConfirmation, true);
      const prompts = body.candidates.filter((c: any) => c.field === "prompt");
      assert.equal(prompts.length, 2);
      assert.ok(prompts.every((c: any) => c.unambiguous === false));

      // Inspect must not persist: it is the confirm step's input, not a write.
      const listed = await (await fetch(base + "/api/comfy/workflows")).json();
      assert.deepEqual(listed.workflows, []);
    });
  });

  it("infers and stores a video workflow, and rejects an explicit kind mismatch", async () => {
    await withServer(async (base) => {
      const inspected = await post(base, "/api/comfy/inspect", { graph: VIDEO_GRAPH });
      const inspectBody = await inspected.json();
      assert.equal(inspectBody.mediaKind, "video");
      assert.ok(inspectBody.candidates.some((candidate: any) => candidate.field === "prompt" && candidate.node === "131"));
      const created = await post(base, "/api/comfy/workflows", {
        id: "minimax-h3", label: "MiniMax H3", mediaKind: "video",
        origin: "http://127.0.0.1:8188", graph: VIDEO_GRAPH, bind: VIDEO_BIND,
      });
      assert.equal(created.status, 200);
      assert.equal((await created.json()).workflow.mediaKind, "video");
      const mismatch = await post(base, "/api/comfy/workflows", {
        id: "bad-kind", mediaKind: "image", graph: VIDEO_GRAPH, bind: VIDEO_BIND,
      });
      assert.equal(mismatch.status, 400);
      assert.equal((await mismatch.json()).error.code, "COMFY_WORKFLOW_MEDIA_KIND_MISMATCH");
    });
  });

  it("refuses a UI workflow save with an actionable message", async () => {
    await withServer(async (base) => {
      const res = await post(base, "/api/comfy/inspect", { graph: { nodes: [{ id: 1 }], links: [] } });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error.code, "COMFY_WORKFLOW_GRAPH_INVALID");
      assert.match(body.error.message, /Export \(API\)/);
    });
  });

  it("registers, lists with health, and deletes a workflow", async () => {
    await withServer(async (base) => {
      const created = await post(base, "/api/comfy/workflows", {
        id: "sdxl", label: "SDXL", origin: "http://127.0.0.1:8188", graph: GRAPH, bind: BIND,
      });
      const createdBody = await created.json();
      assert.equal(created.status, 200);
      assert.equal(createdBody.workflow.id, "sdxl");
      // Unbound scalar inputs become the workflow's own tunable parameters.
      assert.ok(createdBody.workflow.params.some((p: any) => p.input === "steps"));

      const listed = await (await fetch(base + "/api/comfy/workflows")).json();
      assert.equal(listed.workflows.length, 1);
      assert.ok("health" in listed.workflows[0], "each row carries its own liveness");

      const removed = await fetch(base + "/api/comfy/workflows/sdxl", { method: "DELETE" });
      assert.equal(removed.status, 200);
      const after = await (await fetch(base + "/api/comfy/workflows")).json();
      assert.deepEqual(after.workflows, []);

      const missing = await fetch(base + "/api/comfy/workflows/sdxl", { method: "DELETE" });
      assert.equal(missing.status, 404);
    });
  });

  it("requires confirmed bindings before it will save", async () => {
    await withServer(async (base) => {
      const res = await post(base, "/api/comfy/workflows", { id: "x", graph: GRAPH });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error.code, "COMFY_WORKFLOW_BIND_INVALID");
    });
  });

  it("separates a malformed origin from an unreachable one", async () => {
    await withServer(async (base) => {
      // A URL with no port is the user's typo; telling them to start ComfyUI
      // would send them looking in the wrong place.
      const bad = await post(base, "/api/comfy/probe", { origin: "http://127.0.0.1" });
      assert.equal(bad.status, 400);
      assert.equal((await bad.json()).error.code, "COMFY_URL_NOT_LOCAL");

      // A well-formed but dead address is a 200 that reports ok:false.
      const dead = await post(base, "/api/comfy/probe", { origin: "http://127.0.0.1:9" });
      const deadBody = await dead.json();
      assert.equal(dead.status, 200);
      assert.equal(deadBody.ok, true);
      assert.equal(deadBody.health.ok, false);
    });
  });

  it("rejects a non-loopback origin at registration", async () => {
    await withServer(async (base) => {
      const res = await post(base, "/api/comfy/workflows", {
        id: "remote", origin: "http://example.com:8188", graph: GRAPH, bind: BIND,
      });
      assert.equal(res.status, 400);
    });
  });
});

describe("comfy provider option resolution", () => {
  // The guard survives the video lane landing, but its meaning narrowed: the
  // workflow is runnable, just not on the image endpoint. The old code said
  // execution was unsupported, which is no longer true.
  it("redirects a registered video workflow off the classic image path", () => {
    const result = resolveProviderOptions({
      comfyWorkflows: [{ id: "minimax-h3", mediaKind: "video" }],
    } as never, { provider: "comfy", rawModel: "minimax-h3" });
    assert.equal(result.code, "COMFY_VIDEO_WRONG_ENDPOINT");
    assert.equal(result.status, 400);
    assert.match(result.error ?? "", /\/api\/video\/generate/);
  });

  it("requires an explicit workflow id and invents no default", () => {
    // Every other lane defaults an empty model to a flagship. Comfy has no
    // meaningful "first" workflow, so a silent pick would run a graph on a
    // local GPU that nobody asked for.
    const empty = resolveProviderOptions(null, { provider: "comfy" });
    assert.equal(empty.code, "COMFY_WORKFLOW_REQUIRED");
    assert.equal(empty.status, 400);

    const bad = resolveProviderOptions(null, { provider: "comfy", rawModel: "Has Space" });
    assert.equal(bad.code, "INVALID_COMFY_WORKFLOW_ID");

    const ok = resolveProviderOptions(null, { provider: "comfy", rawModel: "sdxl-base" });
    assert.equal(ok.provider, "comfy");
    assert.equal(ok.model, "sdxl-base");
    assert.equal(ok.webSearchEnabled, false);
  });

  it("does not collapse comfy into oauth", async () => {
    await withServer(async () => {
      await putWorkflow({ id: "wf", label: "WF", origin: "http://127.0.0.1:8188", graph: GRAPH, bind: BIND, params: [] } as never);
      // providerOptions ends with an api-or-oauth fallback; an unrecognised
      // provider would silently become oauth and bill a different lane.
      const resolved = resolveProviderOptions(null, { provider: "comfy", rawModel: "wf" });
      assert.equal(resolved.provider, "comfy");
    });
  });
});

describe("comfy surface guards", () => {
  // Multimode, node and agent have no comfy dispatch in this unit. Without an
  // explicit refusal the request reaches generateViaResponses and bills OAuth
  // for an image the user asked ComfyUI to make — with no error to trace.
  // These guards are removed in wp7 when those surfaces gain real support.
  const sources = [
    // Actual node/multimode HTTP status, envelopes, precedence and zero-dispatch
    // assertions live in provider-surface-boundary.test.ts.
    ["lib/agentImageVideoGen.ts", /throw err/],
  ] as const;

  it("refuses comfy on every surface that cannot dispatch it", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join: joinPath } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

    for (const [file, envelope] of sources) {
      const source = readFileSync(joinPath(repoRoot, file), "utf8");
      const start = source.search(/provider[^\n]*===\s*"comfy"/);
      assert.ok(start > 0, `${file} must refuse comfy explicitly`);
      const guard = source.slice(start, start + 900);
      assert.match(guard, /COMFY_SURFACE_UNSUPPORTED/, `${file} must name the refusal code`);
      // Each surface has its own failure idiom; a copied snippet would either
      // not compile or would return the wrong envelope shape.
      assert.match(guard, envelope, `${file} must use its own error idiom`);

      // The guard has to run BEFORE resolveProviderOptions, or comfy's
      // missing-model error masks the real reason with a confusing message.
      const guardAt = source.indexOf("COMFY_SURFACE_UNSUPPORTED");
      const resolveAt = source.indexOf("resolveProviderOptions(ctx");
      assert.ok(guardAt > 0 && resolveAt > 0 && guardAt < resolveAt, `${file}: guard must precede provider resolution`);
    }
  });
});
