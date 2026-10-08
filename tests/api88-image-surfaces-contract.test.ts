import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { prepareImageExecution } from "../lib/providers/execution/index.ts";
import type { ImageExecutionRequest } from "../lib/providers/execution/types.ts";
import { reconcileCoreSelection } from "../ui/src/lib/coreSelection.ts";
import { getImageModelOptionsForProvider } from "../ui/src/lib/imageModels.ts";
import { readFileSync } from "node:fs";

const originalFetch = globalThis.fetch;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const b64 = png.toString("base64");
test.afterEach(() => { globalThis.fetch = originalFetch; });
function request(surface: ImageExecutionRequest["surface"]): ImageExecutionRequest {
  const base = { provider: "88api" as const, requestId: "synthetic-job", signal: new AbortController().signal,
    prompt: "effective with context", rawPrompt: "raw", references: [],
    options: { model: "gpt-image-2", quality: "high", size: "1024x1024", moderation: "low", mode: "auto" as const,
      reasoningEffort: "none", webSearchEnabled: false } };
  switch (surface) {
    case "classic": return { ...base, surface, providerUrl: null, background: null, backgroundConstraint: undefined, nai: {}, comfy: {} };
    case "node": return { ...base, surface, sourceImage: b64, contextMode: "parent-only", searchMode: "off", partialImages: 0, nai: {} };
    case "edit": return { ...base, surface, sourceImage: `data:image/png;base64,${b64}`, mask: null };
    case "multimode": return { ...base, surface, providerUrl: null, maxImages: 3, nai: {} };
  }
}

for (const surface of ["classic", "node", "edit", "multimode"] as const) {
  test(`${surface} dispatches one Images request through the public seam`, async () => {
    let calls = 0;
    globalThis.fetch = (async (input, init) => {
      calls++;
      if (String(input) === "https://cdn.example/multimode.png?sig=a%2Fb") {
        assert.equal(new Headers(init?.headers).has("Authorization"), false); return new Response(png);
      }
      assert.equal(String(input), `https://surface.example/v1/images/${surface === "node" || surface === "edit" ? "edits" : "generations"}`);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer image-key");
      if (init?.body instanceof FormData) assert.equal(init.body.get("prompt"), "effective with context");
      else assert.equal(JSON.parse(String(init?.body)).prompt, "effective with context");
      return Response.json({ data: [surface === "multimode" ? { url: "https://cdn.example/multimode.png?sig=a%2Fb" } : { b64_json: b64 }] });
    }) as typeof fetch;
    const ctx = createTestRuntimeContext({ api88ImageKey: "image-key", api88VideoKey: "video-key",
      config: { ...config, api88Provider: { ...config.api88Provider, baseUrl: "https://surface.example" } } });
    const prepared = await prepareImageExecution(ctx, request(surface));
    const result = await prepared.execute(); const expectedCalls = surface === "multimode" ? 2 : 1;
    assert.equal(calls, expectedCalls);
    if (result.kind === "sequence") {
      assert.equal(result.value.images[0]?.mime, "image/png");
      assert.equal(result.value.images[0]?.providerUrl, "https://cdn.example/multimode.png?sig=a%2Fb");
    }
    else assert.equal(result.value.mime, "image/png");
    ctx.api88ImageKey = undefined;
    await assert.rejects(() => prepared.execute(), { code: "API88_IMAGE_KEY_MISSING" });
    assert.equal(calls, expectedCalls);
  });
}

test("seven visible image rows and independent video selection", () => {
  const rows = getImageModelOptionsForProvider("88api"); assert.equal(rows.length, 7);
  for (const row of rows) { assert.equal(row.providerHint, "88api"); assert.equal(row.value.startsWith("grok-"), false); }
  assert.equal(reconcileCoreSelection({ provider: "88api", imageModel: "grok-imagine-image" }).imageModel, "gpt-image-2");
  assert.equal(reconcileCoreSelection({ provider: "88api", imageModel: "gemini-nano-banana-2.1" }).provider, "88api");
  assert.equal(reconcileCoreSelection({ provider: "88api", videoModelSelected: "grok-imagine-video-1.5" }).videoModelSelected, "grok-imagine-video-1.5");
});

test("video route dispatches 88api before Grok model and credential resolution", () => {
  const source = readFileSync(new URL("../routes/video.ts", import.meta.url), "utf8");
  const guard = source.indexOf('if (req.body?.provider === "88api")');
  assert.ok(guard >= 0);
  assert.ok(guard < source.indexOf("normalizeGrokVideoModel(rawModel"));
  assert.ok(guard < source.indexOf("await resolveGrokCredential"));
  assert.doesNotMatch(source, /API88_VIDEO_NOT_READY/);
});
