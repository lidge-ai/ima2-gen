/**
 * Images 2.6 output formats beyond still rasters: animated GIF (generations and
 * edits). Both are Image API features, gated per model and per organization/project
 * ("Requires access to the GIF preview for the selected model"), so ima2 offers them
 * only on the API key lane with a 2.6 image model. The ChatGPT/Codex OAuth image
 * endpoint answers GIF requests with "GIF output is not enabled for this request."
 * https://developers.openai.com/api/reference/resources/images/methods/generate
 */
import { isImage26Model } from "./oauthNormalize.js";

export const GIF_FRAME_COUNT = { min: 2, max: 16, default: 9 } as const;
export const GIF_FRAME_DURATION_MS = { min: 20, max: 2000, default: 200 } as const;

export interface ImageOutputSpec {
  format: "gif";
  /** Extra Image API request fields (frame_count, frame_duration_ms). */
  fields: Record<string, number>;
  /** Values recorded in sidecars; absent ones mean "OpenAI default". */
  meta: { frameCount?: number; frameDurationMs?: number };
}

interface OutputInput {
  format: unknown;
  provider: string | undefined;
  imageToolModel: string | undefined;
  frameCount?: unknown;
  frameDurationMs?: unknown;
}

type OutputResult = { output: ImageOutputSpec | null; error?: undefined; code?: undefined; status?: undefined }
  | { output?: undefined; error: string; code: string; status: 400 };

const fail = (code: string, error: string): OutputResult => ({ error, code, status: 400 });

function boundedInt(value: unknown, bounds: { min: number; max: number }): number | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= bounds.min && n <= bounds.max ? n : null;
}

export function resolveImageOutput(input: OutputInput): OutputResult {
  const frameCount = boundedInt(input.frameCount, GIF_FRAME_COUNT);
  const frameDurationMs = boundedInt(input.frameDurationMs, GIF_FRAME_DURATION_MS);
  if (input.format !== "gif") {
    if (frameCount !== undefined || frameDurationMs !== undefined) {
      return fail("GIF_OPTIONS_WITHOUT_GIF", "frameCount and frameDurationMs are only valid with format \"gif\"");
    }
    return { output: null };
  }
  if (input.provider !== "api" || !isImage26Model(input.imageToolModel)) {
    return fail("GIF_OUTPUT_UNSUPPORTED",
      "GIF output needs the OpenAI API key lane with a GPT Image 2.6 image model (gpt-image-2.6-flare or gpt-image-2.6-sunburst)");
  }
  if (frameCount === null) {
    return fail("INVALID_GIF_FRAME_COUNT", `frameCount must be an integer from ${GIF_FRAME_COUNT.min} to ${GIF_FRAME_COUNT.max}`);
  }
  if (frameDurationMs === null) {
    return fail("INVALID_GIF_FRAME_DURATION",
      `frameDurationMs must be an integer from ${GIF_FRAME_DURATION_MS.min} to ${GIF_FRAME_DURATION_MS.max}`);
  }
  return {
    output: {
      format: "gif",
      fields: {
        ...(frameCount !== undefined ? { frame_count: frameCount } : {}),
        ...(frameDurationMs !== undefined ? { frame_duration_ms: frameDurationMs } : {}),
      },
      meta: {
        ...(frameCount !== undefined ? { frameCount } : {}),
        ...(frameDurationMs !== undefined ? { frameDurationMs } : {}),
      },
    },
  };
}
