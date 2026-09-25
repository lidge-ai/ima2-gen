// WP5 (050): /api/mcp/generate — atomic commit, terminal envelope, rollback.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ima2-mcp-media-"));
process.env.IMA2_CONFIG_DIR = dir;
process.env.IMA2_DB_PATH = join(dir, "db.sqlite");
process.env.IMA2_GENERATED_DIR = join(dir, "generated");
mkdirSync(join(dir, "generated"), { recursive: true });

const db = await import("../lib/db.ts");
const { subscribe } = await import("../lib/eventBus.ts");
const { registerMcpMediaRoutes } = await import("../routes/mcpMedia.ts");
after(() => { db.closeDb(); rmSync(dir, { recursive: true, force: true }); });

const fakeManager = { status: () => ({ provider: "runway", state: "connected" }) };

function makeDeps(overrides: { failSidecar?: boolean; capture?: Array<Record<string, unknown>> } = {}) {
  const tempMedia = join(dir, "temp-media.png");
  writeFileSync(tempMedia, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return {
    execute: async (_manager: unknown, _adapter: unknown, request: Record<string, unknown>) => {
      overrides.capture?.push(request);
      return { taskId: "task-1", outputUrls: ["https://cdn.example.com/out.png?sig=secret"] };
    },
    download: async () => ({
      tempPath: tempMedia, contentType: "image/png", bytes: 4,
      sanitizedUrl: "https://cdn.example.com/out.png",
      cleanup: async () => {},
    }),
    writeSidecar: overrides.failSidecar
      ? async () => { throw new Error("SIDECAR_WRITE_FAILED"); }
      : undefined,
  };
}

async function withApp(deps: ReturnType<typeof makeDeps>, run: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  registerMcpMediaRoutes(app, {
    config: {
      storage: { generatedDir: join(dir, "generated") },
      ids: { generatedHexBytes: 4 },
      mcp: { enabledProviders: ["runway"], tokenDir: dir, snapshotDir: dir },
    },
    mcpConnectionManager: fakeManager,
  } as never, deps as never);
  const server = await new Promise<import("node:http").Server>((resolve) => { const v = app.listen(0, "127.0.0.1", () => resolve(v)); });
  try {
    const address = server.address() as import("node:net").AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function waitForEvent(requestId: string, name: string, timeoutMs = 8000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`timeout waiting ${name}`)); }, timeoutMs);
    const stop = subscribe((ev) => {
      if (ev.jobId === requestId && ev.event === name) { clearTimeout(timer); stop(); resolve(ev.data); }
    });
  });
}

test("contract violations reject with 400 before any upload or tool call", async () => {
  const uploads: string[] = [];
  const framePath = join(dir, "generated", "frame-contract.png");
  writeFileSync(framePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const deps = {
    ...makeDeps(),
    upload: async (_manager: unknown, path: string) => { uploads.push(path); return "https://runway.example/hosted.png"; },
  };
  await withApp(deps as never, async (base) => {
    const response = await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "runway", kind: "video", prompt: "pan", model: "gen-4-turbo",
        parameters: { resolution: "1080p" }, startFrameFilename: "frame-contract.png",
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "MCP_PARAMETER_UNSUPPORTED");
    assert.deepEqual(uploads, []);
  });
});

test("element reference filenames upload then forward as provider-hosted URLs", async () => {
  const uploads: string[] = [];
  const captured: Array<Record<string, unknown>> = [];
  writeFileSync(join(dir, "generated", "ref-a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const deps = {
    ...makeDeps({ capture: captured }),
    upload: async (_manager: unknown, path: string) => {
      uploads.push(path);
      return `https://runway.example/hosted-${uploads.length}.png`;
    },
  };
  await withApp(deps as never, async (base) => {
    const response = await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "runway", kind: "video", prompt: "walk cycle", model: "seedance-2",
        referenceFilenames: ["ref-a.png"], requestId: "mcp-test-refs",
      }),
    });
    assert.equal(response.status, 202);
    await waitForEvent("mcp-test-refs", "done");
    assert.equal(uploads.length, 1);
    assert.deepEqual(captured[0].referenceImages, [{ url: "https://runway.example/hosted-1.png" }]);
  });
});

test("tagged references keep their @alias through upload", async () => {
  const captured: Array<Record<string, unknown>> = [];
  writeFileSync(join(dir, "generated", "ref-tag.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const deps = {
    ...makeDeps({ capture: captured }),
    upload: async () => "https://runway.example/hosted-tagged.png",
  };
  await withApp(deps as never, async (base) => {
    const response = await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "runway", kind: "video", prompt: "@Jipy waves", model: "seedance-2",
        references: [{ filename: "ref-tag.png", tag: "Jipy" }], requestId: "mcp-test-tagged",
      }),
    });
    assert.equal(response.status, 202);
    await waitForEvent("mcp-test-tagged", "done");
    assert.deepEqual(captured[0].referenceImages, [{ url: "https://runway.example/hosted-tagged.png", tag: "Jipy" }]);
  });
});

test("invalid reference tags reject with a typed 400 before upload", async () => {
  const uploads: string[] = [];
  writeFileSync(join(dir, "generated", "ref-invalid-tag.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const deps = {
    ...makeDeps(),
    upload: async (_manager: unknown, path: string) => { uploads.push(path); return "https://runway.example/hosted.png"; },
  };
  await withApp(deps as never, async (base) => {
    const response = await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "runway", kind: "video", prompt: "x", model: "seedance-2",
        references: [{ filename: "ref-invalid-tag.png", tag: "x".repeat(33) }],
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "INVALID_MCP_REFERENCE_TAG");
    assert.deepEqual(uploads, []);
  });
});

test("end-frame and reference-video inputs reject traversal, bad extensions, and oversize files", async () => {
  writeFileSync(join(dir, "generated", "bad-end.mp4"), "bad");
  writeFileSync(join(dir, "generated", "bad-video.png"), "bad");
  writeFileSync(join(dir, "generated", "huge-end.png"), "x");
  writeFileSync(join(dir, "generated", "huge-video.mov"), "x");
  truncateSync(join(dir, "generated", "huge-end.png"), 50 * 1024 * 1024 + 1);
  truncateSync(join(dir, "generated", "huge-video.mov"), 100 * 1024 * 1024 + 1);
  const uploads: string[] = [];
  const deps = {
    ...makeDeps(),
    upload: async (_manager: unknown, path: string) => { uploads.push(path); return "https://runway.example/hosted"; },
  };
  await withApp(deps as never, async (base) => {
    const cases = [
      { field: "endFrameFilename", value: "../escape.png", code: "INVALID_END_FRAME" },
      { field: "endFrameFilename", value: "bad-end.mp4", code: "INVALID_END_FRAME" },
      { field: "endFrameFilename", value: "huge-end.png", code: "INVALID_END_FRAME" },
      { field: "referenceVideoFilename", value: "../escape.mov", code: "INVALID_REFERENCE_VIDEO" },
      { field: "referenceVideoFilename", value: "bad-video.png", code: "INVALID_REFERENCE_VIDEO" },
      { field: "referenceVideoFilename", value: "huge-video.mov", code: "INVALID_REFERENCE_VIDEO" },
    ];
    for (const item of cases) {
      const response = await fetch(`${base}/api/mcp/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "runway", kind: "video", prompt: "x", model: "seedance-2",
          startFrameUrl: "https://cdn.example.com/start.png", [item.field]: item.value,
        }),
      });
      assert.equal(response.status, 400, `${item.field}:${item.value}`);
      assert.equal((await response.json() as { error: { code: string } }).error.code, item.code);
    }
    assert.deepEqual(uploads, []);
  });
});

test("role gates reject end-frame and video-reference requests before upload", async () => {
  writeFileSync(join(dir, "generated", "role-end.png"), "image");
  writeFileSync(join(dir, "generated", "role-video.mp4"), "video");
  const uploads: string[] = [];
  const deps = {
    ...makeDeps(),
    upload: async (_manager: unknown, path: string) => { uploads.push(path); return "https://runway.example/hosted"; },
  };
  await withApp(deps as never, async (base) => {
    for (const body of [
      { model: "gen-4-turbo", startFrameUrl: "https://cdn.example.com/start.png", endFrameFilename: "role-end.png" },
      { model: "veo-3.1", referenceVideoFilename: "role-video.mp4" },
    ]) {
      const response = await fetch(`${base}/api/mcp/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "runway", kind: "video", prompt: "x", ...body }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "MCP_INPUT_ROLE_UNSUPPORTED");
    }
    assert.deepEqual(uploads, []);
  });
});

test("reference media upload sequentially with MIME mapping, progress, and end-frame lineage", async () => {
  for (const [name, bytes] of [
    ["order-start.png", "start"], ["order-end.webp", "end"],
    ["order-ref.jpg", "ref"], ["order-video.mov", "video"],
  ]) writeFileSync(join(dir, "generated", name), bytes);
  const uploads: Array<{ name: string; mimeType: string }> = [];
  const captured: Array<Record<string, unknown>> = [];
  const progress: Array<Record<string, unknown>> = [];
  const stop = subscribe((event) => {
    if (event.jobId === "mcp-test-media-order" && event.event === "progress") progress.push(event.data);
  });
  const deps = {
    ...makeDeps({ capture: captured }),
    upload: async (_manager: unknown, path: string, options: { mimeType: string }) => {
      uploads.push({ name: basename(path), mimeType: options.mimeType });
      return `https://runway.example/upload-${uploads.length}`;
    },
  };
  await withApp(deps as never, async (base) => {
    const response = await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "runway", kind: "video", prompt: "x", model: "seedance-2",
        requestId: "mcp-test-media-order", startFrameFilename: "order-start.png",
        endFrameFilename: "order-end.webp", references: [{ filename: "order-ref.jpg", tag: "hero" }],
        referenceVideoFilename: "order-video.mov",
      }),
    });
    assert.equal(response.status, 202);
    const done = await waitForEvent("mcp-test-media-order", "done");
    assert.deepEqual(uploads, [
      { name: "order-start.png", mimeType: "image/png" },
      { name: "order-end.webp", mimeType: "image/webp" },
      { name: "order-ref.jpg", mimeType: "image/jpeg" },
      { name: "order-video.mov", mimeType: "video/quicktime" },
    ]);
    assert.deepEqual(captured[0].startFrameUrl, "https://runway.example/upload-1");
    assert.deepEqual(captured[0].endFrameUrl, "https://runway.example/upload-2");
    assert.deepEqual(captured[0].referenceImages, [{ url: "https://runway.example/upload-3", tag: "hero" }]);
    assert.deepEqual(captured[0].referenceVideoUrl, "https://runway.example/upload-4");
    assert.deepEqual(progress.filter((event) => event.phase === "uploading"), [
      { phase: "uploading", current: 1, total: 4 },
      { phase: "uploading", current: 2, total: 4 },
      { phase: "uploading", current: 3, total: 4 },
      { phase: "uploading", current: 4, total: 4 },
    ]);
    const sidecar = JSON.parse(readFileSync(join(dir, "generated", String(done.filename) + ".json"), "utf8"));
    assert.deepEqual(sidecar.parent, { filename: "order-start.png", mediaType: "image", role: "start-frame" });
    assert.deepEqual(sidecar.endFrameParent, { filename: "order-end.webp", mediaType: "image", role: "end-frame" });
    assert.deepEqual(sidecar.referenceParents, [
      { filename: "order-ref.jpg", role: "image-reference", tag: "hero" },
      { filename: "order-video.mov", role: "video-reference" },
    ]);
  });
  stop();
});

test("reference filenames are rejected for models without image_references", async () => {
  const uploads: string[] = [];
  writeFileSync(join(dir, "generated", "ref-b.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const deps = {
    ...makeDeps(),
    upload: async (_manager: unknown, path: string) => { uploads.push(path); return "https://runway.example/hosted.png"; },
  };
  await withApp(deps as never, async (base) => {
    const response = await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "runway", kind: "video", prompt: "x", model: "gen-4-turbo",
        referenceFilenames: ["ref-b.png"],
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "MCP_INPUT_ROLE_UNSUPPORTED");
    assert.deepEqual(uploads, []);
  });
});

test("happy path: 202 then atomic commit with terminal envelope + sidecar core fields", async () => {
  await withApp(makeDeps(), async (base) => {
    const response = await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "runway", kind: "image", prompt: "fox", model: "gen-4", requestId: "mcp-test-1" }),
    });
    assert.equal(response.status, 202);
    const done = await waitForEvent("mcp-test-1", "done");
    assert.equal(done.provider, "runway");
    assert.equal(done.mediaType, "image");
    assert.match(String(done.filename), /_mcp\.png$/);
    assert.match(String(done.url), /^\/generated\//);
    const sidecar = JSON.parse(readFileSync(join(dir, "generated", String(done.filename) + ".json"), "utf8"));
    assert.equal(sidecar.provider, "runway");
    assert.equal(sidecar.providerTaskId, "task-1");
    assert.equal(sidecar.providerUrl, "https://cdn.example.com/out.png");
    assert.ok(!JSON.stringify(sidecar).includes("sig=secret"), "signed query must not persist");
    assert.ok(existsSync(join(dir, "generated", String(done.filename))));
  });
});

test("sidecar failure rolls back media and emits error, never done", async () => {
  await withApp(makeDeps({ failSidecar: true }), async (base) => {
    let sawDone = false;
    const stop = subscribe((ev) => { if (ev.jobId === "mcp-test-2" && ev.event === "done") sawDone = true; });
    await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "runway", kind: "image", prompt: "fox", requestId: "mcp-test-2" }),
    });
    const error = await waitForEvent("mcp-test-2", "error");
    stop();
    assert.equal(error.code, "SIDECAR_WRITE_FAILED");
    assert.equal(sawDone, false);
    const leftovers = (await import("node:fs")).readdirSync(join(dir, "generated")).filter((f) => f.includes("mcp") && !f.endsWith(".json"));
    assert.equal(leftovers.filter((f) => f.includes("mcp-test-2")).length, 0);
  });
});

test("route forwards bounded scalar presets and persists the selected values", async () => {
  const capture: Array<Record<string, unknown>> = [];
  await withApp(makeDeps({ capture }), async (base) => {
    const response = await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // seedance-2 declares duration/resolution/generateAudio, so this stays
        // inside the capability contract the route now enforces up front.
        provider: "runway", kind: "video", prompt: "fox", model: "seedance-2", requestId: "mcp-test-params",
        parameters: { duration: 8, resolution: "720p", generateAudio: false },
      }),
    });
    assert.equal(response.status, 202);
    const done = await waitForEvent("mcp-test-params", "done");
    assert.deepEqual(capture[0].parameters, { duration: 8, resolution: "720p", generateAudio: false });
    const sidecar = JSON.parse(readFileSync(join(dir, "generated", String(done.filename) + ".json"), "utf8"));
    assert.deepEqual(sidecar.mcpParameters, { duration: 8, resolution: "720p", generateAudio: false });
  });
});

test("guards: unknown provider 400, locked provider 409, disconnected 409", async () => {
  await withApp(makeDeps(), async (base) => {
    const bad = await fetch(`${base}/api/mcp/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "nope", kind: "image", prompt: "x" }) });
    assert.equal(bad.status, 400);
    // higgsfield is now executable — a valid request reaches the execution path (202 accepted)
    const higgs = await fetch(`${base}/api/mcp/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "higgsfield", kind: "image", prompt: "x" }) });
    assert.equal(higgs.status, 202);
    const malformed = await fetch(`${base}/api/mcp/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "runway", kind: "image", prompt: "x", parameters: ["bad"] }) });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json() as { error: { code: string } }).error.code, "INVALID_MCP_PARAMETERS");
  });
});

test("higgsfield media inputs upload via media_upload path, never runway init_upload", async () => {
  writeFileSync(join(dir, "generated", "hf-start.png"), "image");
  writeFileSync(join(dir, "generated", "hf-ref.png"), "image");
  const uploads: string[] = [];
  const higgsfieldUploads: string[] = [];
  const captured: Array<Record<string, unknown>> = [];
  const deps = {
    ...makeDeps({ capture: captured }),
    upload: async (_manager: unknown, path: string) => { uploads.push(path); return "https://runway.example/wrong"; },
    uploadHiggsfield: async (_manager: unknown, path: string) => {
      higgsfieldUploads.push(basename(path));
      return `media-uuid-${higgsfieldUploads.length}`;
    },
  };
  await withApp(deps as never, async (base) => {
    const response = await fetch(`${base}/api/mcp/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "higgsfield", kind: "video", prompt: "x", model: "cinematic_studio_3_0",
        requestId: "mcp-test-hf-media", startFrameFilename: "hf-start.png",
        referenceFilenames: ["hf-ref.png"],
      }),
    });
    assert.equal(response.status, 202);
    await waitForEvent("mcp-test-hf-media", "done");
    assert.deepEqual(higgsfieldUploads, ["hf-start.png", "hf-ref.png"]);
    assert.deepEqual(uploads, []);
    // Uploaded media_ids flow into the execute request as provider values.
    assert.equal(captured[0].startFrameUrl, "media-uuid-1");
    assert.deepEqual(captured[0].referenceImages, [{ url: "media-uuid-2" }]);
  });
});
