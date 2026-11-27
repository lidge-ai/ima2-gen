/**
 * Resolution values come from many providers in their own spelling: "1K" and "1k", "480P",
 * "720p-sr", "1080p-esr & 60fps". These helpers read one as a size plus an optional upscale tier
 * so screens can list each size once, in size order, under a readable name.
 */
export type UpscaleTier = "sr" | "esr";

export interface ResolutionParts {
  /** "720p", "4K", "1.5K": lower-case p, upper-case K. */
  base: string;
  /** Provider upscaling applied after rendering ("sr" super resolution, "esr" enhanced). */
  tier?: UpscaleTier;
  fps?: number;
}

const SIZE = /^(\d+(?:\.\d+)?)\s*([pk])/i;

/** Null when the value is not a size (for example "2x" or "auto"). */
export function resolutionParts(value: string): ResolutionParts | null {
  const text = value.trim();
  const size = SIZE.exec(text);
  if (!size) return null;
  const unit = size[2]!.toLowerCase() === "k" ? "K" : "p";
  const rest = text.slice(size[0].length).toLowerCase();
  const words = rest.split(/[^a-z0-9]+/).filter(Boolean);
  const tier = words.includes("esr") ? "esr" : words.includes("sr") ? "sr" : undefined;
  const fps = /(\d+)\s*fps/.exec(rest);
  return {
    base: size[1] + unit,
    ...(tier ? { tier } : {}),
    ...(fps ? { fps: Number(fps[1]) } : {}),
  };
}

/** Same option written in another case ("1K" and "1k", "480P" and "480p"). */
export function sameResolution(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function order(value: string): number[] | null {
  const parts = resolutionParts(value);
  if (!parts) return null;
  const n = Number.parseFloat(parts.base);
  const lines = parts.base.endsWith("K") ? n * 1000 : n;
  return [lines, parts.tier === "esr" ? 2 : parts.tier === "sr" ? 1 : 0, parts.fps ?? 0];
}

/** Each size once (first spelling wins), smallest first; values that are not sizes keep their order at the end. */
export function tidyResolutions(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (const value of values) if (!unique.some((seen) => sameResolution(seen, value))) unique.push(value);
  const sized = unique.filter((value) => order(value) !== null);
  const other = unique.filter((value) => order(value) === null);
  sized.sort((a, b) => {
    const x = order(a)!;
    const y = order(b)!;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
  });
  return [...sized, ...other];
}
