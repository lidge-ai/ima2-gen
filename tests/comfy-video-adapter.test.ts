import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { config } from "../config.js";
import { generateVideoViaComfy } from "../lib/comfyImageAdapter.ts";
import { detectVideoMimeFromB64 } from "../lib/refs.ts";
import { putWorkflow } from "../lib/comfyWorkflowStore.ts";

const ORIGIN = "http://127.0.0.1:8188";

/**
 * Real container bytes. The adapter reads magic bytes rather than trusting the
 * declared type, so a fabricated buffer would prove nothing.
 */
const MP4_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x20]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.alloc(16, 0x11),
]);
const WEBM_BYTES = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.alloc(24, 0x22),
]);
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const VIDEO_GRAPH = {
  "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "92": { class_type: "SaveVideo", inputs: { filename_prefix: "ima2" } },
};
const VIDEO_BIND = { prompt: { node: "6", input: "text" }, output: { node: "92" } };

const originalConfigDir = config.storage.configDir;
const scratch: string[] = [];

async function withVideoWorkflow<T>(fn: (id: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ima2-comfy-video-"));
  scratch.push(dir);
  (config.storage as { configDir: string }).configDir = dir;
  await putWorkflow({
    id: "vid", label: "VID", origin: ORIGIN, mediaKind: "video",
    graph: VIDEO_GRAPH, bind: VIDEO_BIND, params: [],
  } as never);
  try {
    return await fn("vid");
  } finally {
    (config.storage as { configDir: string }).configDir = originalConfigDir;
  }
}

afterEach(async () => {
  (config.storage as { configDir: string }).configDir = originalConfigDir;
  while (scratch.length > 0) await rm(scratch.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function ctx(): any {
  return {
    config: {
      ...config,
      comfy: { ...config.comfy, pollIntervalMs: 1, generationTimeoutMs: 5_000, healthTimeoutMs: 50 },
    },
  };
}

type Route = (url: string, init?: any) => Response | Promise<Response>;

function stub(routes: Array<[RegExp, Route]>) {
  const calls: Array<{ url: string; init: any }> = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [pattern, handler] of routes) {
      if (pattern.test(url)) return handler(url, init);
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** How ComfyUI core actually reports a saved video: PreviewVideo -> images + animated. */
const HISTORY_CORE = (pid: string) => json({
  [pid]: {
    status: { status_str: "success", completed: true, messages: [] },
    outputs: { "92": { images: [{ filename: "clip_00001_.mp4", subfolder: "video", type: "output" }], animated: [true] } },
  },
});

describe("comfy video magic bytes", () => {
  it("names the container it found instead of guessing", () => {
    assert.equal(detectVideoMimeFromB64(MP4_BYTES.toString("base64")), "video/mp4");
    assert.equal(detectVideoMimeFromB64(WEBM_BYTES.toString("base64")), "video/webm");
    assert.equal(detectVideoMimeFromB64(PNG_BYTES.toString("base64")), null);
    assert.equal(detectVideoMimeFromB64(null), null);
  });
});

describe("comfy video collection", () => {
  it("reads a core SaveVideo result from the images key", async () => {
    await withVideoWorkflow(async (id) => {
      const { impl, calls } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p1", node_errors: {} })],
        [/\/history\//, () => HISTORY_CORE("p1")],
        [/\/view\?/, () => new Response(MP4_BYTES, { status: 200 })],
      ]);
      const result = await generateVideoViaComfy("a bicycle rolling", ctx(), { model: id, fetchImpl: impl });
      assert.equal(result.mime, "video/mp4");
      assert.equal(result.effectiveModel, "vid");
      const view = calls.find((c) => c.url.includes("/view?"))!;
      assert.match(view.url, /filename=clip_00001_\.mp4/);
      assert.match(view.url, /subfolder=video/);
    });
  });

  it("reads the VideoHelperSuite gifs key", async () => {
    await withVideoWorkflow(async (id) => {
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p2", node_errors: {} })],
        [/\/history\//, () => json({
          p2: {
            status: { status_str: "success", completed: true, messages: [] },
            outputs: { "92": { gifs: [{ filename: "vhs_00001_.mp4", subfolder: "", type: "output" }] } },
          },
        })],
        [/\/view\?/, () => new Response(MP4_BYTES, { status: 200 })],
      ]);
      const result = await generateVideoViaComfy("clip", ctx(), { model: id, fetchImpl: impl });
      assert.equal(result.mime, "video/mp4");
    });
  });

  it("skips a still frame from an unbound node instead of returning it as video", async () => {
    await withVideoWorkflow(async (id) => {
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p3", node_errors: {} })],
        [/\/history\//, () => json({
          p3: {
            status: { status_str: "success", completed: true, messages: [] },
            outputs: {
              // A PreviewImage sitting beside the real output, with no animated flag.
              "40": { images: [{ filename: "preview_00001_.png", subfolder: "", type: "output" }] },
              "77": { videos: [{ filename: "real_00001_.mp4", subfolder: "", type: "output" }] },
            },
          },
        })],
        [/\/view\?/, () => new Response(MP4_BYTES, { status: 200 })],
      ]);
      const result = await generateVideoViaComfy("clip", ctx(), { model: id, fetchImpl: impl });
      assert.equal(result.mime, "video/mp4");
    });
  });
});

describe("comfy video validation", () => {
  it("refuses a PNG served as the video output", async () => {
    await withVideoWorkflow(async (id) => {
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p4", node_errors: {} })],
        [/\/history\//, () => HISTORY_CORE("p4")],
        [/\/view\?/, () => new Response(PNG_BYTES, { status: 200 })],
      ]);
      await assert.rejects(
        () => generateVideoViaComfy("clip", ctx(), { model: id, fetchImpl: impl }),
        (error: any) => error.code === "COMFY_VIDEO_INVALID",
      );
    });
  });

  it("names WebM rather than calling it invalid", async () => {
    await withVideoWorkflow(async (id) => {
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p5", node_errors: {} })],
        [/\/history\//, () => HISTORY_CORE("p5")],
        [/\/view\?/, () => new Response(WEBM_BYTES, { status: 200 })],
      ]);
      await assert.rejects(
        () => generateVideoViaComfy("clip", ctx(), { model: id, fetchImpl: impl }),
        (error: any) => error.code === "COMFY_VIDEO_FORMAT_UNSUPPORTED" && /webm/i.test(error.message),
      );
    });
  });
});

describe("comfy video history race", () => {
  it("waits out a completed run whose outputs have not landed yet", async () => {
    await withVideoWorkflow(async (id) => {
      let historyCalls = 0;
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p6", node_errors: {} })],
        [/\/history\//, () => {
          historyCalls += 1;
          if (historyCalls <= 2) {
            return json({ p6: { status: { status_str: "success", completed: true, messages: [] }, outputs: {} } });
          }
          return HISTORY_CORE("p6");
        }],
        [/\/view\?/, () => new Response(MP4_BYTES, { status: 200 })],
      ]);
      const result = await generateVideoViaComfy("clip", ctx(), { model: id, fetchImpl: impl });
      assert.equal(result.mime, "video/mp4");
      // Proof the retry branch fired rather than the first read succeeding.
      assert.ok(historyCalls >= 3, `expected retries, saw ${historyCalls} history reads`);
    });
  });
});
