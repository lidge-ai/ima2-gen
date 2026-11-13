import {
  ColorMode,
  Hierarchical,
  PathSimplifyMode,
  Preset,
  optimize,
  vectorize,
  type Config,
} from "@neplex/vectorizer";
import sharp from "sharp";

/**
 * Raster -> SVG tracing (VTracer core).
 *
 * Traces bitmap regions into real vector paths. This is the opposite of
 * ui/src/lib/canvas/svgExport.ts, which embeds a raster <image> inside SVG
 * chrome without converting any pixels.
 *
 * Quality boundary (measured, see devlog/_plan/260831_vectorize_assets/000_plan.md):
 * keyed cutouts, flat art, logos and sprites trace cleanly; photographic gradients
 * and small text degrade. Callers should present it as a cutout/flat-art tool.
 */

export const VECTOR_PRESETS = ["auto", "flat", "detailed", "mono"] as const;
export type VectorPreset = (typeof VECTOR_PRESETS)[number];

export type VectorizeOptions = {
  preset?: VectorPreset | undefined;
  colorPrecision?: number | undefined;
  filterSpeckle?: number | undefined;
  cornerThreshold?: number | undefined;
  optimize?: boolean | undefined;
};

export type VectorizeResult = {
  svg: string;
  bytes: number;
  pathCount: number;
  elapsedMs: number;
  preset: VectorPreset;
  width: number;
  height: number;
};

/** Tracing cost scales with area; mirrors the decompression-bomb guard in imageThumb. */
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_INPUT_DIMENSION = 8000;
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const RASTER_INPUT = /\.(png|jpe?g|webp)$/i;

export function isRasterPath(path: string): boolean {
  return RASTER_INPUT.test(path);
}

export function isVectorPreset(value: unknown): value is VectorPreset {
  return typeof value === "string" && (VECTOR_PRESETS as readonly string[]).includes(value);
}

type VectorizeError = Error & { status: number; code: string };

function vectorizeError(status: number, code: string, message: string): VectorizeError {
  const error = new Error(message) as VectorizeError;
  error.status = status;
  error.code = code;
  return error;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Base config per named preset. Numeric overrides promote a preset to an explicit
 * Config so a caller can tune one axis without restating all nine fields.
 */
function baseConfig(preset: VectorPreset): Config {
  const shared = {
    hierarchical: Hierarchical.Stacked,
    mode: PathSimplifyMode.Spline,
    layerDifference: 5,
    lengthThreshold: 5,
    maxIterations: 2,
    spliceThreshold: 45,
    pathPrecision: 5,
  };
  if (preset === "mono") {
    return { ...shared, colorMode: ColorMode.Binary, colorPrecision: 6, filterSpeckle: 4, cornerThreshold: 60 };
  }
  if (preset === "flat") {
    return { ...shared, colorMode: ColorMode.Color, colorPrecision: 6, filterSpeckle: 8, cornerThreshold: 60 };
  }
  return { ...shared, colorMode: ColorMode.Color, colorPrecision: 8, filterSpeckle: 4, cornerThreshold: 60 };
}

function hasOverride(options: VectorizeOptions): boolean {
  return options.colorPrecision !== undefined
    || options.filterSpeckle !== undefined
    || options.cornerThreshold !== undefined;
}

/**
 * Without overrides we pass the library's own Preset enum: measured on a 1254x1254
 * keyed asset, Preset.Photo produced 722 paths against Poster's 4993 at visually
 * indistinguishable quality, so auto uses Photo while detailed uses Poster.
 */
function resolveConfig(preset: VectorPreset, options: VectorizeOptions): Config | Preset {
  if (!hasOverride(options)) {
    if (preset === "mono") return Preset.Bw;
    if (preset === "flat") return baseConfig("flat");
    if (preset === "detailed") return Preset.Poster;
    return Preset.Photo;
  }
  const config = baseConfig(preset);
  if (options.colorPrecision !== undefined) config.colorPrecision = clamp(Math.round(options.colorPrecision), 1, 8);
  if (options.filterSpeckle !== undefined) config.filterSpeckle = clamp(Math.round(options.filterSpeckle), 0, 128);
  if (options.cornerThreshold !== undefined) config.cornerThreshold = clamp(Math.round(options.cornerThreshold), 0, 180);
  return config;
}

async function probeDimensions(input: Buffer): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(input).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    throw vectorizeError(400, "VECTORIZE_DECODE_FAILED", "input could not be decoded as a raster image");
  }
}

function countPaths(svg: string): number {
  return (svg.match(/<path/g) || []).length;
}

/** Trace an encoded raster buffer into an SVG document. */
export async function vectorizeImageBuffer(
  input: Buffer,
  options: VectorizeOptions = {},
): Promise<VectorizeResult> {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw vectorizeError(400, "VECTORIZE_INPUT_EMPTY", "input buffer is empty");
  }
  if (input.length > MAX_INPUT_BYTES) {
    throw vectorizeError(400, "VECTORIZE_INPUT_TOO_LARGE", "input exceeds 40MB");
  }

  const { width, height } = await probeDimensions(input);
  if (width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
    throw vectorizeError(
      400,
      "VECTORIZE_DIMENSIONS_TOO_LARGE",
      "input exceeds " + MAX_INPUT_DIMENSION + "px on a side",
    );
  }

  const preset: VectorPreset = isVectorPreset(options.preset) ? options.preset : "auto";
  const started = Date.now();
  let svg: string;
  try {
    svg = await vectorize(input, resolveConfig(preset, options));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw vectorizeError(400, "VECTORIZE_DECODE_FAILED", "tracing failed: " + message);
  }

  if (options.optimize !== false) {
    try {
      svg = await optimize(svg, { multipass: true });
    } catch {
      // Optimization is a size win, not a correctness requirement: a failure here
      // must not discard an otherwise valid trace.
    }
  }

  svg = svg.replace(/<svg\b[^>]*>/, (root) =>
    /\sviewBox\s*=/.test(root) ? root : root.replace(/\s*\/?>$/, (end) => ` viewBox="0 0 ${width} ${height}"${end}`),
  );

  const bytes = Buffer.byteLength(svg, "utf8");
  if (bytes > MAX_OUTPUT_BYTES) {
    throw vectorizeError(413, "VECTORIZE_OUTPUT_TOO_LARGE", "traced SVG exceeds 24MB");
  }

  return { svg, bytes, pathCount: countPaths(svg), elapsedMs: Date.now() - started, preset, width, height };
}
