import assert from "node:assert/strict";
import { it } from "node:test";
import type { GrokVideoPlan } from "../lib/grokVideoAdapter.ts";

const { buildVideoGenerationPayload } = await import("../lib/grokVideoAdapter.ts");
const r2v = (resolution: GrokVideoPlan["resolution"] = "720p", duration = 3): GrokVideoPlan =>
  ({ prompt: "p", mode: "reference-to-video", duration, resolution, aspectRatio: "auto", webSearchCalls: 0 });
const SRC = "data:image/png;base64,AAAA";
const code = (fn: () => unknown) => { try { fn(); return "ok"; } catch (e) { return (e as { code?: string }).code; } };

it("sends last_frame, keyframes and a pinned first frame on 1.5", () => {
  const payload = buildVideoGenerationPayload(r2v(), { model: "grok-imagine-video-1.5", sourceImageUrl: SRC,
    pins: { lastFrame: SRC, keyframes: [{ image: SRC, timestampS: 1 }] } } as never);
  assert.deepEqual(payload.image, { url: SRC });
  assert.deepEqual(payload.last_frame, { url: SRC });
  assert.deepEqual(payload.keyframes, [{ image: { url: SRC }, timestamp_s: 1 }]);
});

it("refuses pins on other models, at 1080p, and with invalid keyframes", () => {
  const pins = (keyframes: Array<{ image: string; timestampS: number }>) => ({ lastFrame: SRC, keyframes });
  for (const model of ["grok-imagine-video", "grok-imagine-video-1.5-lite"]) {
    assert.equal(code(() => buildVideoGenerationPayload(r2v(), { model, sourceImageUrl: SRC, pins: pins([]) } as never)), "GROK_VIDEO_PINS_UNSUPPORTED_MODEL");
  }
  assert.equal(code(() => buildVideoGenerationPayload(r2v("1080p"), { model: "grok-imagine-video-1.5", sourceImageUrl: SRC, pins: pins([]) } as never)), "INVALID_VIDEO_RESOLUTION");
  const five = Array.from({ length: 5 }, (_, i) => ({ image: SRC, timestampS: 0.4 + i * 0.4 }));
  assert.equal(code(() => buildVideoGenerationPayload(r2v(), { model: "grok-imagine-video-1.5", pins: pins(five) } as never)), "GROK_VIDEO_KEYFRAMES_INVALID");
  for (const t of [0, 3, 4]) {
    assert.equal(code(() => buildVideoGenerationPayload(r2v(), { model: "grok-imagine-video-1.5", pins: pins([{ image: SRC, timestampS: t }]) } as never)), "GROK_VIDEO_KEYFRAMES_INVALID");
  }
  const sameSlot = [{ image: SRC, timestampS: 1 }, { image: SRC, timestampS: 1.1 }];
  assert.equal(code(() => buildVideoGenerationPayload(r2v(), { model: "grok-imagine-video-1.5", pins: pins(sameSlot) } as never)), "GROK_VIDEO_KEYFRAMES_INVALID");
});

it("sends generate_audio false only on 1.5 and Lite when sound is turned off", () => {
  const t2v: GrokVideoPlan = { ...r2v(), mode: "text-to-video" };
  assert.equal(buildVideoGenerationPayload(t2v, { model: "grok-imagine-video-1.5", generateAudio: false } as never).generate_audio, false);
  assert.equal(buildVideoGenerationPayload(t2v, { model: "grok-imagine-video-1.5-lite", generateAudio: false } as never).generate_audio, false);
  assert.equal("generate_audio" in buildVideoGenerationPayload(t2v, { model: "grok-imagine-video-1.5" }), false);
  assert.equal(code(() => buildVideoGenerationPayload(t2v, { model: "grok-imagine-video", generateAudio: false } as never)), "GROK_VIDEO_AUDIO_TOGGLE_UNSUPPORTED");
});
