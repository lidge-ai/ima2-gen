import type { MediaModelSpec } from "../providers/media/contract.js";
import type { CostUnits } from "./types.js";

/**
 * Output sizes BytePlus Seedance renders per resolution and aspect ratio (official table,
 * https://docs.byteplus.com/en/docs/ModelArk/seedance-2-5, read 2026-11-26).
 */
const SIZES: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>> = {
  "480p": { "16:9": [854, 480], "4:3": [752, 560], "1:1": [640, 640], "3:4": [560, 752], "9:16": [480, 854], "21:9": [992, 432] },
  "720p": { "16:9": [1280, 720], "4:3": [1112, 834], "1:1": [960, 960], "3:4": [834, 1112], "9:16": [720, 1280], "21:9": [1470, 630] },
  "1080p": { "16:9": [1920, 1080], "4:3": [1664, 1248], "1:1": [1440, 1440], "3:4": [1248, 1664], "9:16": [1080, 1920], "21:9": [2206, 946] },
  "4k": { "16:9": [3840, 2160], "4:3": [3326, 2494], "1:1": [2880, 2880], "3:4": [2494, 3326], "9:16": [2160, 3840], "21:9": [4398, 1886] },
};
const FPS = 24;

function nearestRatio(width: number | undefined, height: number | undefined): string {
  if (!width || !height) return "16:9";
  const target = Math.log(width / height);
  let best = "16:9";
  let gap = Infinity;
  for (const ratio of Object.keys(SIZES["720p"]!)) {
    const [w, h] = SIZES["720p"]![ratio]!;
    const d = Math.abs(Math.log(w / h) - target);
    if (d < gap) { gap = d; best = ratio; }
  }
  return best;
}

export interface TokenEstimate {
  units: CostUnits;
  /** Shown with the step estimate: the formula and its inputs. */
  note: string;
}

/**
 * Token units for a model billed per token (BytePlus Seedance), from the official formula:
 * tokens = (input video s + output s) x output width x height x frame rate / 1024.
 * Undefined when the model lists no token price for this resolution and input kind.
 */
export function videoTokenUnits(
  spec: MediaModelSpec | undefined,
  opts: { resolution: string; outSec: number; inSec: number; width?: number | undefined; height?: number | undefined },
): TokenEstimate | undefined {
  const resolution = opts.resolution.toLowerCase();
  const variant = (opts.inSec > 0 ? "video-in " : "no-video-in ") + resolution;
  if (!spec?.pricing.some((p) => p.unit === "1k-tokens" && p.variant === variant)) return undefined;
  const ratio = nearestRatio(opts.width, opts.height);
  const size = SIZES[resolution]?.[ratio];
  if (!size) return undefined;
  const [w, h] = size;
  const seconds = opts.inSec + opts.outSec;
  const tokens = Math.round((seconds * w * h * FPS) / 1024);
  const minimum = opts.inSec > 0 ? "; inputs with video are billed at least a per-resolution minimum, so the bill can be higher" : "";
  return {
    units: { unit: "1k-tokens", quantity: tokens / 1000, variant },
    note: "estimate: (" + round(opts.inSec) + " s in + " + round(opts.outSec) + " s out) x " + w + "x" + h + " x " + FPS + " fps / 1024 = " + tokens + " tokens (BytePlus formula)" + minimum,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
