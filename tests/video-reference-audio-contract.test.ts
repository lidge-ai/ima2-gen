import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildVideoGenerationPayload, buildGrokVideoPlannerPayload } from "../lib/grokVideoAdapter.js";
import { MAX_REFERENCE_AUDIOS } from "../lib/imageModels.js";

// devlog/_plan/260820_grok15_multi_reference_video/040_reference_audio.md (issue #158).
//
// grok-imagine-video-1.5 can give the subject a preset voice via reference_audios.
// Verified against api.x.ai on 2026-08-20: 3 voices accepted, 4 rejected with
// "Maximum allowed is 3", and the base model rejects the field outright.

function plan(mode: "text-to-video" | "image-to-video" | "reference-to-video" = "reference-to-video") {
  return { prompt: "p", mode, duration: 6, resolution: "720p" as const, aspectRatio: "16:9" as const, webSearchCalls: 0 };
}

test("preset voices ride along as reference_audios", () => {
  const payload = buildVideoGenerationPayload(plan(), {
    model: "grok-imagine-video-1.5",
    referenceImageUrls: ["https://example.invalid/a.png"],
    referenceAudios: ["eve", "leo"],
  });
  assert.deepEqual(payload.reference_audios, [{ voice_id: "eve" }, { voice_id: "leo" }]);
});

test("more voices than xAI accepts fails here instead of upstream", () => {
  assert.equal(MAX_REFERENCE_AUDIOS, 3);
  assert.throws(
    () => buildVideoGenerationPayload(plan(), {
      model: "grok-imagine-video-1.5",
      referenceImageUrls: ["https://example.invalid/a.png"],
      referenceAudios: ["eve", "leo", "rex", "sal"],
    }),
    (e: any) => e.code === "GROK_VIDEO_AUDIO_TOO_MANY",
  );
});

test("voices on the base model are refused, not silently dropped", () => {
  // The base model returns 400 for reference_audios. Stripping the voice to make the
  // call succeed would hand back a video missing the thing that was asked for.
  assert.throws(
    () => buildVideoGenerationPayload(plan("text-to-video"), {
      model: "grok-imagine-video",
      referenceAudios: ["eve"],
    }),
    (e: any) => e.code === "GROK_VIDEO_AUDIO_UNSUPPORTED_MODEL",
  );
});

test("a request without voices is untouched", () => {
  const payload = buildVideoGenerationPayload(plan(), {
    model: "grok-imagine-video-1.5",
    referenceImageUrls: ["https://example.invalid/a.png"],
  });
  assert.equal(payload.reference_audios, undefined);
});

test("the planner is told how to address the voices", () => {
  // A voice nobody is assigned to in the prompt does not get used, and the planner
  // rewrites the prompt — so it has to know the tag convention.
  const payload = buildGrokVideoPlannerPayload("say hello", {
    model: "grok-imagine-video-1.5",
    mode: "reference-to-video",
    duration: 6,
    resolution: "720p",
    aspectRatio: "16:9",
    referenceImageUrls: ["https://example.invalid/a.png"],
    referenceAudios: ["eve"],
  }) as { messages: Array<{ content: unknown }> };
  const text = JSON.stringify(payload);
  assert.match(text, /<AUDIO_0>/);
});

test("no Grok video request resubmits on another model after a 400", () => {
  // A retry on a different model can spend on a model the user did not choose (plan G4).
  const source = readFileSync(new URL("../lib/grokVideoAdapter.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /video:fallback|effectiveModel = GROK_VIDEO_MODEL_BASE/);
});
