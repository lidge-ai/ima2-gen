import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GROK_VIDEO_MODEL_15,
  GROK_VIDEO_MODEL_15_DATED_ALIAS,
  GROK_VIDEO_MODEL_15_PREVIEW_ALIAS,
  VALID_GROK_VIDEO_MODELS,
  canonicalGrokVideoModel,
  maxRef2vDuration,
  normalizeGrokVideoModel,
  validateVideoResolutionForRequest,
} from "../lib/imageModels.js";
import {
  GROK_VIDEO_MODEL_15 as UI_MODEL_15,
  GROK_VIDEO_MODEL_15_DATED_ALIAS as UI_DATED_ALIAS,
  isVideoModelValue,
  maxVideoDurationUI,
  normalizeVideoModelValue,
} from "../ui/src/lib/imageModels.ts";

// devlog/_plan/260908_xai_imagine_spec_resync/000_research.md
//
// GET /v1/video-generation-models reports two aliases for grok-imagine-video-1.5:
// -preview and -2026-05-30. The dated one was missing here, so a legal model id was
// refused locally with INVALID_GROK_VIDEO_MODEL before the request reached xAI.

const ALIASES = [GROK_VIDEO_MODEL_15_PREVIEW_ALIAS, GROK_VIDEO_MODEL_15_DATED_ALIAS];

test("every advertised 1.5 alias is accepted and folded onto the canonical id", () => {
  for (const alias of ALIASES) {
    assert.equal(VALID_GROK_VIDEO_MODELS.has(alias), true, alias + " must be a legal model id");
    assert.equal(canonicalGrokVideoModel(alias), GROK_VIDEO_MODEL_15);
    const normalized = normalizeGrokVideoModel(alias);
    assert.equal("model" in normalized && normalized.model, GROK_VIDEO_MODEL_15);
  }
});

test("an alias behaves identically to the canonical id at every gate", () => {
  // Three call sites used to inline their own alias check. One of them would have been
  // missed when the dated alias arrived, and the symptom differs per gate: a rejected
  // 1080p request here, a wrongly clamped duration there.
  for (const alias of ALIASES) {
    assert.deepEqual(
      validateVideoResolutionForRequest(alias, "1080p", "text-to-video"),
      validateVideoResolutionForRequest(GROK_VIDEO_MODEL_15, "1080p", "text-to-video"),
    );
    assert.deepEqual(
      validateVideoResolutionForRequest(alias, "1080p", "image-to-video"),
      validateVideoResolutionForRequest(GROK_VIDEO_MODEL_15, "1080p", "image-to-video"),
    );
    assert.equal(maxRef2vDuration(alias), maxRef2vDuration(GROK_VIDEO_MODEL_15));
  }
});

test("canonicalization leaves a non-Grok model id alone", () => {
  // comfy passes its workflow id through the same field. Rewriting it would be worse
  // than leaving it: the id is the caller's, not xAI's.
  assert.equal(canonicalGrokVideoModel("some-comfy-workflow"), "some-comfy-workflow");
  assert.equal(maxRef2vDuration("some-comfy-workflow"), null);
});

test("the UI knows the same alias set as the server", () => {
  // The two files cannot import each other across the build boundary, so the values are
  // duplicated. This is the seam that keeps the copies honest.
  assert.equal(UI_DATED_ALIAS, GROK_VIDEO_MODEL_15_DATED_ALIAS);
  assert.equal(UI_MODEL_15, GROK_VIDEO_MODEL_15);
  for (const alias of ALIASES) {
    assert.equal(isVideoModelValue(alias), true, "UI must accept " + alias);
    assert.equal(normalizeVideoModelValue(alias), GROK_VIDEO_MODEL_15);
  }
});

test("the UI duration bound agrees with the server's per-model ceiling", () => {
  for (const model of [GROK_VIDEO_MODEL_15, ...ALIASES]) {
    assert.equal(maxVideoDurationUI(model, "reference-to-video"), maxRef2vDuration(model));
  }
  assert.equal(maxVideoDurationUI("grok-imagine-video", "reference-to-video"), maxRef2vDuration("grok-imagine-video"));
  // Outside r2v, and for a lane xAI does not own, the shared 15s bound applies.
  assert.equal(maxVideoDurationUI("grok-imagine-video", "image-to-video"), 15);
  assert.equal(maxVideoDurationUI("some-comfy-workflow", "reference-to-video"), 15);
});

