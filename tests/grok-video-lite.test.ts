import assert from "node:assert/strict";
import { it } from "node:test";
import * as models from "../lib/imageModels.ts";
import type { GrokVideoPlan } from "../lib/grokVideoAdapter.ts";

const { buildVideoGenerationPayload } = await import("../lib/grokVideoAdapter.ts");
const LITE = "grok-imagine-video-1.5-lite";
const plan = (mode: GrokVideoPlan["mode"], resolution: GrokVideoPlan["resolution"] = "720p"): GrokVideoPlan =>
  ({ prompt: "p", mode, duration: 5, resolution, aspectRatio: "auto", webSearchCalls: 0 });

it("registers grok-imagine-video-1.5-lite as a Grok video model", () => {
  assert.equal(models.isGrokVideoModel(LITE), true);
  assert.equal((models.normalizeGrokVideoModel(LITE) as { model?: string }).model, LITE);
});

it("rejects reference images and voices on Lite before any upstream call", () => {
  const check = (models as Record<string, unknown>).validateGrokVideoInputs as
    ((model: string, inputs: { referenceCount: number; voiceCount: number }) => { ok?: true; code?: string }) | undefined;
  assert.equal(typeof check, "function");
  assert.equal(check!(LITE, { referenceCount: 1, voiceCount: 0 }).code, "GROK_VIDEO_REF_UNSUPPORTED_MODEL");
  assert.equal(check!(LITE, { referenceCount: 0, voiceCount: 1 }).code, "GROK_VIDEO_AUDIO_UNSUPPORTED_MODEL");
  assert.equal(check!(LITE, { referenceCount: 0, voiceCount: 0 }).ok, true);
  assert.equal(check!("grok-imagine-video-1.5", { referenceCount: 14, voiceCount: 3 }).ok, true);
  assert.throws(() => buildVideoGenerationPayload(plan("reference-to-video"), { model: LITE, referenceImageUrls: ["A"] }),
    (e: { code?: string }) => e.code === "GROK_VIDEO_REF_UNSUPPORTED_MODEL");
});

it("allows native 1080p text- and image-to-video on 1.5 and Lite only", () => {
  for (const model of ["grok-imagine-video-1.5", LITE]) {
    for (const mode of ["text-to-video", "image-to-video"] as const) {
      assert.equal("ok" in models.validateVideoResolutionForRequest(model, "1080p", mode), true, `${model} ${mode}`);
    }
  }
  assert.equal("ok" in models.validateVideoResolutionForRequest("grok-imagine-video", "1080p", "text-to-video"), false);
  assert.equal("ok" in models.validateVideoResolutionForRequest("grok-imagine-video-1.5", "1080p", "reference-to-video"), false);
  const payload = buildVideoGenerationPayload(plan("text-to-video", "1080p"), { model: LITE });
  assert.deepEqual([payload.model, payload.resolution, "image" in payload], [LITE, "1080p", false]);
});
