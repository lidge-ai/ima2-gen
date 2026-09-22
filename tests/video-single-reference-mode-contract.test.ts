import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deriveVideoMode as deriveFromSlot, normalizeVideoGenerationRequest, isVideoGenerationError } from "../lib/videoGenerationRequest.js";
import { deriveVideoMode as deriveFromCount } from "../lib/imageModels.js";
import { buildVideoGenerationPayload } from "../lib/grokVideoAdapter.js";

// devlog/_plan/260820_grok15_multi_reference_video/030_single_ref_mode_choice.md (issue #157).
//
// A single reference image used to be forced into image-to-video, which locks it as the
// first frame. That made the reference tray unable to do the one thing it is named for.
// xAI accepts a 1-image reference-to-video request (verified 2026-08-20, 000_research.md);
// the restriction was ours.

function plan(mode: "text-to-video" | "image-to-video" | "reference-to-video") {
  return { prompt: "p", mode, duration: 6, resolution: "720p" as const, aspectRatio: "16:9" as const, webSearchCalls: 0 };
}

test("one reference image is a legal reference-to-video payload", () => {
  const payload = buildVideoGenerationPayload(plan("reference-to-video"), {
    model: "grok-imagine-video-1.5",
    referenceImageUrls: ["https://example.invalid/a.png"],
  });
  assert.deepEqual(payload.reference_images, [{ url: "https://example.invalid/a.png" }]);
  assert.equal(payload.image, undefined, "a reference must not become the locked first frame");
});

test("reference-to-video with nothing to reference is still rejected", () => {
  // Relaxing the floor to 1 must not open a path to an empty reference_images array.
  assert.throws(
    () => buildVideoGenerationPayload(plan("reference-to-video"), { model: "grok-imagine-video-1.5", referenceImageUrls: [] }),
    /at least 1 reference image/,
  );
});

test("the slot the caller used decides the mode, not the count", () => {
  assert.equal(deriveFromSlot({ referenceImages: ["a"] }), "reference-to-video");
  assert.equal(deriveFromSlot({ sourceImage: "data:..." }), "image-to-video");
  // Same single image, opposite meanings, distinguished only by the field it arrived in.
});

test("the count-only helper keeps its historical default for callers without slot info", () => {
  assert.equal(deriveFromCount(1), "image-to-video");
  assert.equal(deriveFromCount(2), "reference-to-video");
});

test("an explicit mode still wins over any derivation", () => {
  const result = normalizeVideoGenerationRequest({ prompt: "x", mode: "reference-to-video", referenceImages: ["a"] });
  assert.ok(!isVideoGenerationError(result));
  assert.equal(result.request.mode, "reference-to-video");
});

// CONTRACT REVERSED (issue #164). The previous version of this test asserted that every
// surface routes a lone attachment into the reference slot. That was v3.8.0's mistake:
// #157 asked to let the user CHOOSE between animating the image and using it as a guide,
// and forcing the reference slot just replaced one fixed answer with another — it also
// removed the only way to reach image-to-video from the composer.
//
// The contract this pins now: one attachment is the user's choice, defaulting to the
// pre-v3.8.0 behavior; two or more can only be references.
test("both surfaces let a lone attachment be a first frame or a reference", () => {
  const store = readFileSync(new URL("../ui/src/store/storeVideoImpl.ts", import.meta.url), "utf8");
  assert.match(
    store,
    /videoSingleRefMode/,
    "the UI store must consult the user's choice for a single attachment",
  );
  // Anh nen (neu co) duoc xet TRUOC lua chon nay - xem test "a base image on a
  // video node is not thrown away by an attachment" - nen khop giua dong.
  assert.match(
    store,
    /sourceImage:.*singleRefAsSource \? refs\[0\]/,
    "choosing the first frame must actually send the image in the source slot",
  );
  const cli = readFileSync(new URL("../bin/lib/videoMcp.ts", import.meta.url), "utf8");
  assert.match(
    cli,
    /references\.length === 1 && !asReference/,
    "the CLI must honor --as-reference rather than fixing one --ref to a single slot",
  );
  assert.ok(
    !/1 and 10 when using 2 or more/.test(cli),
    "the CLI must not re-impose the removed 10s reference ceiling",
  );
});

test("a single attachment defaults to being animated, not merely referenced", () => {
  // Compatibility pin: dragging one photo in and asking for a video meant "animate this"
  // before v3.8.0, and that has to keep being what happens without extra input.
  // (UI sources are not compiled for node:test, so this is read as source.)
  const persistence = readFileSync(new URL("../ui/src/store/storePersistence.ts", import.meta.url), "utf8");
  assert.match(
    persistence,
    /singleRefMode:\s*"image-to-video"/,
    "the stored default for a lone attachment must stay image-to-video",
  );
});

test("two or more attachments stay references no matter what the user picked", () => {
  // The API accepts no other shape at that count, so the single-ref choice must not
  // leak upward into counts where there is nothing to choose.
  const uiModels = readFileSync(new URL("../ui/src/lib/imageModels.ts", import.meta.url), "utf8");
  assert.match(
    uiModels,
    /if \(refCount >= 2\) return "reference-to-video";/,
    "two or more attachments must resolve to reference-to-video before the choice applies",
  );
  assert.match(
    uiModels,
    /if \(refCount === 1\) return singleRefMode;/,
    "exactly one attachment must defer to the user's choice",
  );
});

test("a base image on a video node is not thrown away by an attachment", () => {
  // Loi da xay ra that: dieu kien giai anh nen la `refs.length === 0`, nen chi
  // can dinh mot anh vao node video la anh nen bi bo han. May chu nhan duoc mot
  // tham chieu, sinh ra mot nguoi mau khac, du prompt van doi "keep the exact
  // same face as the base image".
  const impl = readFileSync(new URL("../ui/src/store/storeVideoImpl.ts", import.meta.url), "utf8");
  assert.match(
    impl,
    /if \(node && node\.data\.parentServerNodeId\) \{/,
    "the parent base image must be resolved even when the node carries attachments",
  );
  assert.doesNotMatch(impl, /refs\.length === 0 && node\.data\.parentServerNodeId/);
  // Mot trong hai, khong phai ca hai: co anh nen thi khong gui kem tham chieu.
  assert.match(impl, /referenceImages:[^\n]*!coAnhNen/);
  assert.match(impl, /const coAnhNen = Boolean\(parentSourceFilename \|\| parentVideoFrameRef\)/);
});

test("the workflow engine sends the base frame by filename, not parentNodeId", () => {
  // /api/video/generate khong doc `parentNodeId` (chi /api/node/generate doc),
  // nen gui truong do la mat anh nen trong im lang.
  const engine = readFileSync(new URL("../lib/wfEngine.ts", import.meta.url), "utf8");
  const videoCall = engine.slice(engine.indexOf('"/api/video/generate"'));
  assert.match(videoCall.slice(0, 400), /\.\.\.anhVao/);
  assert.match(engine, /sourceFilename: tenNen/);
  assert.doesNotMatch(videoCall.slice(0, 400), /parentNodeId/);
});
