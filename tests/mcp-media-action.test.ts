// WP6 (060): media-action route — containment, dispatch, lineage sidecar.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { McpMediaDeps } from "../routes/mcpMedia.ts";

const dir = mkdtempSync(join(tmpdir(), "ima2-mcp-action-"));
process.env.IMA2_CONFIG_DIR = dir;
process.env.IMA2_DB_PATH = join(dir, "db.sqlite");
process.env.IMA2_GENERATED_DIR = join(dir, "generated");
mkdirSync(join(dir, "generated"), { recursive: true });
mkdirSync(join(dir, "snapshots"), { recursive: true });
// Stop config's package-root fallback before importing runtime modules.
writeFileSync(join(dir, "config.json"), "{}");

const db = await import("../lib/db.ts");
const { subscribe } = await import("../lib/eventBus.ts");
const { registerMcpMediaRoutes } = await import("../routes/mcpMedia.ts");
after(() => { db.closeDb(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

// Local snapshot so the router sees live runway tools.
writeFileSync(join(dir, "snapshots", "runway.json"), JSON.stringify({
  provenance: { provider: "runway", endpoint: "https://mcp.runwayml.com/mcp", fetchedAt: "t", entitlementTag: "u", originalHash: "sha256:0", sanitizedHash: "sha256:0" },
  tools: [{ name: "upscale_image" }, { name: "upscale_video" }, { name: "edit_video" }],
}));

// Seed gallery files.
writeFileSync(join(dir, "generated", "src-image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
writeFileSync(join(dir, "generated", "clip-a.mp4"), Buffer.from("a"));
writeFileSync(join(dir, "generated", "clip-b.mp4"), Buffer.from("b"));

const keyframePreviewResponse = {
  content: [{ type: "text", text: "Edited keyframe generated (t=0.5s). The video edit has NOT been submitted yet.\n\nKeyframe URL: https://cdn.example.com/kf.png" }],
  structuredContent: {
    kind: "keyframe_preview", prompt: "add snow", keyframeTimestampSeconds: 0.5,
    keyframeUrl: "https://cdn.example.com/kf.png", nextTool: "edit_video",
    nextArguments: { video: { url: "https://cdn.example.com/src.mp4" }, keyframeImage: { url: "https://cdn.example.com/kf.png" } },
  },
};

const fakeManager = {
  status: () => ({ provider: "runway", state: "connected", snapshotDiff: { drifted: [], missing: [], added: [] } }),
  callTool: async (_provider: string, toolName: string) => {
    if (toolName === "edit_video") return keyframePreviewResponse;
    throw new Error(`unexpected tool ${toolName}`);
  },
};

const tempOut = join(dir, "action-result.bin");
const deps = {
  upload: async () => "https://runway.example/datasets/abc.png",
  executePlan: async (_m: unknown, _a: unknown, plan: { toolName: string }) => {
    assert.equal(plan.toolName, "upscale_image");
    return { taskId: "task-act-1", outputUrls: ["https://cdn.example.com/up.png"] };
  },
  download: async () => {
    writeFileSync(tempOut, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return { tempPath: tempOut, contentType: "image/png", bytes: 4, sanitizedUrl: "https://cdn.example.com/up.png", cleanup: async () => {} };
  },
  concat: async (_inputs: string[], outputPath: string) => { copyFileSync(join(dir, "generated", "clip-a.mp4"), outputPath); },
};

async function withApp(run: (base: string) => Promise<void>, overrides: Partial<McpMediaDeps> = {}) {
  const app = express();
  app.use(express.json());
  registerMcpMediaRoutes(app, {
    config: {
      storage: { generatedDir: join(dir, "generated"), packageRoot: dir },
      ids: { generatedHexBytes: 4 },
      mcp: { enabledProviders: ["runway"], tokenDir: dir, snapshotDir: join(dir, "snapshots") },
    },
    mcpConnectionManager: fakeManager,
  } as never, { ...deps, ...overrides });
  const server = await new Promise<import("node:http").Server>((resolve) => { const v = app.listen(0, "127.0.0.1", () => resolve(v)); });
  try {
    const address = server.address() as import("node:net").AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

// 30 s: on a slow Windows runner the done event arrived 1.1 s after an 8 s wait gave up.
function waitForEvent(requestId: string, name: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`timeout waiting ${name} after ${timeoutMs} ms`)); }, timeoutMs);
    const stop = subscribe((ev) => {
      if (ev.jobId === requestId && (ev.event === name || (name === "terminal" && ["done", "error"].includes(ev.event)))) {
        clearTimeout(timer); stop(); resolve({ ...ev.data, event: ev.event });
      }
    });
  });
}

test("path traversal in files[] is rejected before any work", async () => withApp(async (base) => {
  const response = await fetch(`${base}/api/mcp/media-action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "upscale-image", files: ["../../etc/passwd"] }),
  });
  assert.equal(response.status, 400);
}));

test("native upscale-image dispatches plan, records parent lineage in sidecar", async () => withApp(async (base) => {
  const donePromise = waitForEvent("act-1", "done");
  const response = await fetch(`${base}/api/mcp/media-action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "upscale-image", files: ["src-image.png"], requestId: "act-1" }),
  });
  assert.equal(response.status, 202);
  const body = await response.json() as { mode: string; plan: string };
  assert.equal(body.mode, "native");
  assert.equal(body.plan, "upscale_image");
  const done = await donePromise;
  const sidecar = JSON.parse(readFileSync(join(dir, "generated", String(done.filename) + ".json"), "utf8"));
  assert.deepEqual(sidecar.parent, { filename: "src-image.png", mediaType: "image", role: "source" });
  assert.equal(sidecar.workflow, "image.upscale");
}));

test("stitch falls back to local concat with fallback metadata (native call 0)", async () => withApp(async (base) => {
  const donePromise = waitForEvent("act-2", "done");
  const response = await fetch(`${base}/api/mcp/media-action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "stitch", files: ["clip-a.mp4", "clip-b.mp4"], requestId: "act-2" }),
  });
  assert.equal((await response.json() as { mode: string }).mode, "fallback");
  const done = await donePromise;
  const sidecar = JSON.parse(readFileSync(join(dir, "generated", String(done.filename) + ".json"), "utf8"));
  assert.equal(sidecar.fallback, true);
  assert.equal(sidecar.provider, "local-ffmpeg");
  assert.deepEqual(sidecar.inputs, ["clip-a.mp4", "clip-b.mp4"]);
}));

test("stitch keeps hostile requestId as correlation and confines output, copy and cleanup", async (t) => {
  const root = join(dir, "generated");
  const requestId = "/../../audit-victim";
  const sentinel = join(dir, "audit-victim.mp4");
  writeFileSync(sentinel, "outside sentinel");
  const targets: string[] = [], copies: string[][] = [], removed: string[] = [], unlinked: string[] = [], order: string[] = [];
  const originalCopy = fsPromises.copyFile, originalRm = fsPromises.rm, originalUnlink = fsPromises.unlink;
  t.mock.method(fsPromises, "copyFile", async (src, dest, mode) => {
    copies.push([String(src), String(dest)]);
    assert.equal(dirname(String(src)), root); assert.equal(dirname(String(dest)), root);
    return originalCopy(src, dest, mode);
  });
  t.mock.method(fsPromises, "rm", async (path, options) => {
    removed.push(String(path)); order.push("cleanup");
    assert.equal(dirname(String(path)), root);
    assert.equal(removed.length, 1, "cleanup must have exactly one owner");
    return originalRm(path, options);
  });
  t.mock.method(fsPromises, "unlink", async (path) => {
    unlinked.push(String(path));
    assert.equal(dirname(String(path)), root);
    return originalUnlink(path);
  });
  syncBuiltinESMExports();
  const stop = subscribe((ev) => { if (ev.jobId === requestId && ["done", "error"].includes(ev.event)) order.push(ev.event); });
  t.after(() => { stop(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  await withApp(async (base) => {
    const terminal = waitForEvent(requestId, "terminal");
    const response = await fetch(`${base}/api/mcp/media-action`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stitch", files: ["clip-a.mp4", "clip-b.mp4"], requestId }),
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json() as { requestId: string }).requestId, requestId);
    const done = await terminal;
    assert.equal(done.event, "done"); assert.equal(done.requestId, requestId);
    const finalPath = join(root, String(done.filename));
    assert.equal(readFileSync(finalPath, "utf8"), "a");
    assert.equal(JSON.parse(readFileSync(finalPath + ".json", "utf8")).requestId, requestId);
    assert.deepEqual(copies, [[targets[0], finalPath]]);
  }, { concat: async (inputs, output) => {
    targets.push(output);
    assert.equal(dirname(output), root);
    assert.match(basename(output), /^\.tmp-concat-[a-f0-9]{32}\.mp4$/);
    copyFileSync(inputs[0]!, output);
  } });
  assert.equal(targets.length, 1); assert.deepEqual(removed, targets);
  assert.ok(unlinked.every((path) => dirname(path) === root));
  assert.equal(existsSync(targets[0]!), false);
  assert.deepEqual(order, ["cleanup", "done"]);
  assert.equal(readFileSync(sentinel, "utf8"), "outside sentinel");
});

for (const failure of ["concat", "concat-and-cleanup", "sidecar", "cleanup"] as const) {
  test(`stitch ${failure} failure cleans only its owned tempfile before one error`, async (t) => {
    const root = join(dir, "generated"), requestId = `/../../audit-${failure}`;
    const sentinel = join(dir, `audit-${failure}.mp4`);
    writeFileSync(sentinel, "outside sentinel");
    const removed: string[] = [], copies: string[][] = [], unlinked: string[] = [], order: string[] = [];
    let output = "";
    const originalRm = fsPromises.rm, originalCopy = fsPromises.copyFile;
    t.mock.method(fsPromises, "rm", async (path, options) => {
      removed.push(String(path));
      assert.equal(dirname(String(path)), root);
      if (String(path) === output) {
        order.push("cleanup");
        if (failure.includes("cleanup")) throw new Error("CLEANUP_FAILED");
      }
      return originalRm(path, options);
    });
    t.mock.method(fsPromises, "copyFile", async (src, dest, mode) => {
      copies.push([String(src), String(dest)]);
      assert.equal(dirname(String(src)), root); assert.equal(dirname(String(dest)), root);
      return originalCopy(src, dest, mode);
    });
    t.mock.method(fsPromises, "unlink", async (path) => {
      unlinked.push(String(path));
      throw new Error("unexpected unlink on failed stitch");
    });
    syncBuiltinESMExports();
    const stop = subscribe((ev) => { if (ev.jobId === requestId && ["done", "error"].includes(ev.event)) order.push(ev.event); });
    t.after(() => { stop(); t.mock.restoreAll(); syncBuiltinESMExports(); });
    await withApp(async (base) => {
      const terminal = waitForEvent(requestId, "terminal");
      const response = await fetch(`${base}/api/mcp/media-action`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stitch", files: ["clip-a.mp4", "clip-b.mp4"], requestId }),
      });
      assert.equal(response.status, 202);
      const result = await terminal;
      assert.equal(result.event, "error");
      assert.equal(result.code, failure.startsWith("concat") ? "CONCAT_FAILED" : failure === "sidecar" ? "SIDECAR_FAILED" : "CLEANUP_FAILED");
    }, { concat: async (_inputs, target) => {
      output = target;
      assert.equal(dirname(output), root);
      writeFileSync(output, "partial concat output");
      if (failure.startsWith("concat")) throw new Error("CONCAT_FAILED");
    }, ...(failure === "sidecar" ? { writeSidecar: async () => { throw new Error("SIDECAR_FAILED"); } } : {}) });
    assert.equal(removed.filter((path) => path === output).length, 1);
    assert.equal(existsSync(output), failure.includes("cleanup"));
    assert.equal(copies.length, failure.startsWith("concat") ? 0 : 1);
    assert.deepEqual(unlinked, []);
    if (failure === "sidecar") assert.equal(existsSync(copies[0]![1]!), false);
    assert.deepEqual(order, ["cleanup", "error"]);
    assert.equal(readFileSync(sentinel, "utf8"), "outside sentinel");
  });
}

test("reframe is unavailable (higgsfield locked) with typed 409", async () => withApp(async (base) => {
  const response = await fetch(`${base}/api/mcp/media-action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reframe", files: ["clip-a.mp4"] }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "MEDIA_ACTION_UNAVAILABLE");
}));

test("edit-video-preview runs synchronously (no polling) and commits an approval-pending image (wp5b2)", async () => withApp(async (base) => {
  const donePromise = waitForEvent("act-3", "done");
  const response = await fetch(`${base}/api/mcp/media-action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "edit-video-preview", files: ["clip-a.mp4"], prompt: "add snow", keyframeTimestampSeconds: 0.5, requestId: "act-3" }),
  });
  assert.equal(response.status, 202);
  const done = await donePromise;
  const sidecar = JSON.parse(readFileSync(join(dir, "generated", String(done.filename) + ".json"), "utf8"));
  assert.equal(sidecar.workflow, "video.edit.preview");
  assert.equal(sidecar.mediaType, "image");
  assert.equal(sidecar.approvalStatus, "pending");
  assert.equal(sidecar.keyframeTimestampSeconds, 0.5);
  assert.deepEqual(sidecar.parent, { filename: "clip-a.mp4", mediaType: "video", role: "source" });
  assert.deepEqual(sidecar.keyframeSubmit?.keyframeImage, { url: "https://cdn.example.com/kf.png" });
}));

test("upscale-image accepts allowlisted parameters and records them in the sidecar (054)", async () => withApp(async (base) => {
  const donePromise = waitForEvent("act-4", "done");
  const response = await fetch(`${base}/api/mcp/media-action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "upscale-image", files: ["src-image.png"], parameters: { scaleFactor: 2, sharpen: 25 }, requestId: "act-4" }),
  });
  assert.equal(response.status, 202);
  const done = await donePromise;
  const sidecar = JSON.parse(readFileSync(join(dir, "generated", String(done.filename) + ".json"), "utf8"));
  assert.deepEqual(sidecar.mcpParameters, { scaleFactor: 2, sharpen: 25 });
}));

test("upscale-image rejects non-allowlisted parameter keys with 400", async () => withApp(async (base) => {
  const response = await fetch(`${base}/api/mcp/media-action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "upscale-image", files: ["src-image.png"], parameters: { turbo: true } }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "INVALID_MEDIA_PARAMETERS");
}));

test("video.upscale rejects parameters entirely (provider schema has none)", async () => withApp(async (base) => {
  const response = await fetch(`${base}/api/mcp/media-action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "upscale-video", files: ["clip-a.mp4"], parameters: { scaleFactor: 2 } }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "INVALID_MEDIA_PARAMETERS");
}));
