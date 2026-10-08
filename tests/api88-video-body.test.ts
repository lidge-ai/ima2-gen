import test from "node:test";
import assert from "node:assert/strict";
import { buildApi88VideoBody, type Api88VideoInput } from "../lib/api88/videoBody.ts";
import { API88_VIDEO_SPECS } from "../lib/api88/videoSpecs.ts";

const prompt = "A cube turns slowly";
const image = "https://cdn.example/reference.png?signature=a%2Fb&x=1";
const data = "data:image/png;base64,iVBORw0KGgo=";
const defaults: Array<[string, number, Record<string, unknown>]> = [
  ["gemini-omni-flash", 5, { size: "16:9" }],
  ["grok-imagine-video", 8, { size: "16:9", metadata: { resolution: "480p" } }],
  ["grok-imagine-video-1.5", 8, { size: "16:9", metadata: { resolution: "480p" } }],
  ["kling-3.0-turbo-720p", 5, { ratio: "16:9" }],
  ["kling-3.0-turbo-1080p", 5, { ratio: "16:9" }],
  ["kling-3.0-turbo-2k", 5, { ratio: "16:9" }],
  ["kling-3.0-turbo-4k", 5, { ratio: "16:9" }],
  ["minimax-h3-768p", 4, { ratio: "1:1" }],
  ["SD2.0 480P", 5, { ratio: "1:1" }],
  ["SD2.0 720P", 5, { ratio: "1:1" }],
  ["SD2.0 1080P", 5, { ratio: "1:1" }],
  ["SD2.0 4k", 5, { ratio: "1:1" }],
  ["SD2.5 480P", 5, { ratio: "auto" }],
  ["SD2.5 720P", 5, { ratio: "auto" }],
  ["SD2.5 1080P", 5, { ratio: "auto" }],
  ["Seedance-2.0-720p官方版", 4, { ratio: "16:9" }],
  ["Seedance-2.0-fast-720p官方版", 4, { ratio: "16:9" }],
  ["Seedance-2.5-720p官方版", 4, { ratio: "16:9" }],
  ["seedance-2.0-mini-480p", 5, { ratio: "16:9" }],
  ["seedance-2.0-mini-720p", 5, { ratio: "16:9" }],
  ["veo-3.1", 8, { size: "1280x720" }],
  ["veo-3.1-fast", 8, { size: "1280x720" }],
  ["wan3.0-video-480p", 5, { ratio: "16:9" }],
  ["wan3.0-video-720p", 5, { ratio: "16:9" }],
  ["wan3.0-video-1080p", 5, { ratio: "16:9" }],
];
const code = (value: unknown) => (value as { code?: string }).code;

for (const [model, duration, fields] of defaults) {
  test(`${model}: exact text and reference body snapshots`, () => {
    assert.deepEqual(buildApi88VideoBody({ model, prompt }), { model, prompt, duration, ...fields });
    const reference = model.startsWith("veo-") ? data : image;
    assert.deepEqual(buildApi88VideoBody({ model, prompt, images: [reference] }),
      { model, prompt, duration, ...fields, images: [reference] });
    assert.equal(buildApi88VideoBody({ model, prompt }).model, model);
    assert.equal("resolution" in buildApi88VideoBody({ model, prompt }), false);
  });
}
test("snapshots cover the exact 25-row inventory", () => {
  assert.equal(defaults.length, 25);
  assert.deepEqual(defaults.map(([id]) => id), Object.keys(API88_VIDEO_SPECS));
});
test("duration, ratio and fixed-resolution validation precede transport", () => {
  for (const change of [{ duration: 3 }, { aspectRatio: "auto" }, { resolution: "720p" }]) {
    assert.throws(() => buildApi88VideoBody({ model: "kling-3.0-turbo-4k", prompt, ...change }),
      (error: unknown) => code(error) === "API88_VIDEO_INVALID_REQUEST");
  }
  assert.equal(buildApi88VideoBody({ model: "SD2.5 720P", prompt, duration: 30 }).duration, 30);
  assert.throws(() => buildApi88VideoBody({ model: "SD2.5 720P ", prompt }),
    (error: unknown) => code(error) === "API88_VIDEO_MODEL_INVALID");
});
test("Veo encodes portrait dimensions, frames and audio under metadata", () => {
  assert.deepEqual(buildApi88VideoBody({ model: "veo-3.1", prompt, resolution: "1080p", aspectRatio: "9:16",
    firstFrame: data, lastFrame: data, generateAudio: false }), {
    model: "veo-3.1", prompt, duration: 8, size: "1080x1920", images: [data, data],
    metadata: { video_mode: "frames", generateAudio: false },
  });
  assert.throws(() => buildApi88VideoBody({ model: "veo-3.1", prompt, duration: 6, images: [data] }));
  assert.throws(() => buildApi88VideoBody({ model: "veo-3.1", prompt, images: [image] }));
  assert.throws(() => buildApi88VideoBody({ model: "veo-3.1", prompt, images: [data, data, data], videoMode: "frames" }));
  assert.deepEqual(buildApi88VideoBody({ model: "veo-3.1", prompt, images: [data, data, data] }).metadata,
    { video_mode: "reference" });
});
test("URL-only families refuse local input and keep URL query byte-exact", () => {
  for (const model of ["grok-imagine-video", "SD2.5 720P", "Seedance-2.0-720p官方版"]) {
    assert.throws(() => buildApi88VideoBody({ model, prompt, images: [data] }),
      (error: unknown) => code(error) === "API88_VIDEO_REFERENCE_NEEDS_URL");
    assert.deepEqual(buildApi88VideoBody({ model, prompt, images: [image] }).images, [image]);
    assert.throws(() => buildApi88VideoBody({ model, prompt, images: ["https://127.0.0.1/a.png"] }));
  }
});
test("family reference placements, caps, exclusive frames and audio flags", () => {
  const model = "kling-3.0-turbo-720p";
  assert.deepEqual(buildApi88VideoBody({ model, prompt, generateAudio: false,
    referenceVideos: [{ url: "https://cdn.example/input.mp4", duration: 8 }] }), {
    model, prompt, duration: 5, ratio: "16:9", generate_audio: false,
    metadata: { referenceVideos: ["https://cdn.example/input.mp4"] },
  });
  const omni = buildApi88VideoBody({ model: "gemini-omni-flash", prompt,
    referenceVideos: [{ url: "https://cdn.example/input.mp4", duration: 10 }] });
  assert.equal(omni.video, "https://cdn.example/input.mp4");
  assert.equal("metadata" in omni, false);
  assert.throws(() => buildApi88VideoBody({ model: "wan3.0-video-480p", prompt, images: Array(11).fill(image) }));
  assert.throws(() => buildApi88VideoBody({ model: "minimax-h3-768p", prompt,
    referenceAudioUrls: [{ url: "https://cdn.example/audio.mp3", duration: 5 }] }));
  assert.throws(() => buildApi88VideoBody({ model: "SD2.0 720P", prompt,
    images: Array(9).fill(image), referenceVideos: Array(3).fill({ url: "https://cdn.example/v.mp4", duration: 1 }),
    referenceAudioUrls: [{ url: "https://cdn.example/a.mp3", duration: 1 }] }));
  assert.throws(() => buildApi88VideoBody({ model: "SD2.5 720P", prompt, firstFrame: image, images: [image] }));
  assert.throws(() => buildApi88VideoBody({ model: "SD2.5 720P", prompt, lastFrame: image }));
  const input: Api88VideoInput = { model: "SD2.5 720P", prompt, generateAudio: false };
  assert.equal(buildApi88VideoBody(input).generate_audio, false);
  assert.throws(() => buildApi88VideoBody({ model: "SD2.0 720P", prompt, generateAudio: false }));
});
