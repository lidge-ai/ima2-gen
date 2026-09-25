export type GrokImageSizeParams = {
  aspect_ratio?: string;
  resolution?: "1k" | "2k";
};

const SUPPORTED_ASPECTS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "19.5:9",
  "9:19.5",
  "20:9",
  "9:20",
] as const;

const PRESET_MAP: Record<string, GrokImageSizeParams> = {
  "1024x1024": { aspect_ratio: "1:1", resolution: "1k" },
  "1536x1024": { aspect_ratio: "3:2", resolution: "1k" },
  "1024x1536": { aspect_ratio: "2:3", resolution: "1k" },
  "1360x1024": { aspect_ratio: "4:3", resolution: "1k" },
  "1024x1360": { aspect_ratio: "3:4", resolution: "1k" },
  "1824x1024": { aspect_ratio: "16:9", resolution: "1k" },
  "1024x1824": { aspect_ratio: "9:16", resolution: "1k" },
  "2048x2048": { aspect_ratio: "1:1", resolution: "2k" },
  "2048x1152": { aspect_ratio: "16:9", resolution: "2k" },
  "1152x2048": { aspect_ratio: "9:16", resolution: "2k" },
  "3840x2160": { aspect_ratio: "16:9", resolution: "2k" },
  "2160x3840": { aspect_ratio: "9:16", resolution: "2k" },
};

function parseSize(size: string): { w: number; h: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

function aspectValue(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || !h || w === undefined) return 1;
  return w / h;
}

function closestAspect(w: number, h: number): string {
  const target = w / h;
  return SUPPORTED_ASPECTS.reduce((best, aspect) => {
    const bestDistance = Math.abs(Math.log(target / aspectValue(best)));
    const distance = Math.abs(Math.log(target / aspectValue(aspect)));
    return distance < bestDistance ? aspect : best;
  }, "1:1");
}

export function mapSizeToGrokImageParams(size: string | null | undefined): GrokImageSizeParams {
  if (!size || size === "auto") return { aspect_ratio: "auto" };

  // Native format from GrokSizePicker: "grok:<aspect_ratio>:<resolution>"
  if (size.startsWith("grok:")) {
    const parts = size.split(":");
    if (parts.length < 3) return { aspect_ratio: "auto" };
    const res = parts[parts.length - 1];
    const aspect = parts.slice(1, -1).join(":");
    return {
      aspect_ratio: SUPPORTED_ASPECTS.some((supported) => supported === aspect) ? aspect : "auto",
      resolution: res === "2k" ? "2k" : "1k",
    };
  }

  const preset = PRESET_MAP[size];
  if (preset) return preset;

  const parsed = parseSize(size);
  if (!parsed) return { aspect_ratio: "auto" };

  return {
    aspect_ratio: closestAspect(parsed.w, parsed.h),
    resolution: Math.max(parsed.w, parsed.h) >= 2048 || parsed.w * parsed.h >= 2_000_000 ? "2k" : "1k",
  };
}
