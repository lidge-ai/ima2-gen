// MiniMax web-UI registration. The adapter can produce a good error message,
// but the user only sees it if the code survives SSE parsing and the error
// registry — an unregistered code collapses to a generic "Generation failed".
import test from "node:test";
import assert from "node:assert/strict";
import { parseSseErrorPayload } from "../ui/src/lib/sseStreamError.ts";
import { resolveErrorSpec } from "../ui/src/lib/errorCodes.ts";
import {
  MINIMAX_IMAGE_MODEL_OPTIONS,
  OPENAI_IMAGE_MODEL_OPTIONS,
  getImageModelOptionsForProvider,
  isMinimaxImageModel,
} from "../ui/src/lib/imageModels.ts";

test("a MiniMax model-requires-reference error reaches the user as its own toast", () => {
  // Exactly what routes/events.ts publishes for a failed job.
  const parsed = parseSseErrorPayload({
    error: {
      message: "MiniMax image-01-live requires a reference image outside the China region. "
        + "Attach a reference or switch to image-01.",
      code: "MINIMAX_MODEL_REQUIRES_REFERENCE",
    },
    code: "MINIMAX_MODEL_REQUIRES_REFERENCE",
    status: 400,
  });

  assert.equal(parsed.code, "MINIMAX_MODEL_REQUIRES_REFERENCE");

  const { code, spec } = resolveErrorSpec(parsed);
  // Collapsing to UNKNOWN would replace the actionable text with a generic one.
  assert.notEqual(code, "UNKNOWN");
  assert.equal(code, "MINIMAX_MODEL_REQUIRES_REFERENCE");
  assert.equal(spec.surface, "toast");
  assert.equal(spec.toastKey, "toast.minimaxModelRequiresReference");
});

test("minimax models are offered for the minimax provider only", () => {
  const values = MINIMAX_IMAGE_MODEL_OPTIONS.map((option) => option.value);
  assert.deepEqual(values, ["image-01", "image-01-live", "MiniMax-H3-Image", "MiniMax-H3-Image-Highspeed"]);

  assert.deepEqual(
    getImageModelOptionsForProvider("minimax").map((option) => option.value),
    values,
  );
  // They must not leak into the default GPT list.
  for (const option of OPENAI_IMAGE_MODEL_OPTIONS) {
    assert.equal(isMinimaxImageModel(option.value), false);
  }
});
