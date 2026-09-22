import type { Quality } from "../types";

// Rough cost-per-image for gpt-image-2 sizes (preset-based estimate).
// Size auto/custom fall back to the nearest keyed size or 1024².
export const COST_MAP: Partial<Record<Quality, Record<string, number>>> = {
  low: {
    "1024x1024": 0.006,
    "1024x1536": 0.005,
    "1536x1024": 0.005,
    "1024x1360": 0.005,
    "1360x1024": 0.005,
    "1024x1824": 0.006,
    "1824x1024": 0.006,
    "2048x2048": 0.012,
    "2048x1152": 0.009,
    "1152x2048": 0.009,
    "3840x2160": 0.023,
    "2160x3840": 0.023,
    auto: 0.006,
  },
  medium: {
    "1024x1024": 0.053,
    "1024x1536": 0.041,
    "1536x1024": 0.041,
    "1024x1360": 0.041,
    "1360x1024": 0.041,
    "1024x1824": 0.05,
    "1824x1024": 0.05,
    "2048x2048": 0.106,
    "2048x1152": 0.08,
    "1152x2048": 0.08,
    "3840x2160": 0.2,
    "2160x3840": 0.2,
    auto: 0.053,
  },
  high: {
    "1024x1024": 0.211,
    "1024x1536": 0.165,
    "1536x1024": 0.165,
    "1024x1360": 0.165,
    "1360x1024": 0.165,
    "1024x1824": 0.2,
    "1824x1024": 0.2,
    "2048x2048": 0.422,
    "2048x1152": 0.32,
    "1152x2048": 0.32,
    "3840x2160": 0.8,
    "2160x3840": 0.8,
    auto: 0.211,
  },
};

// Source: https://ai.google.dev/gemini-api/docs/pricing (image output tokens × per-token rate)
// Flash 3.1: $60/1M tok — 512px=747tok, 1K=1120tok, 2K=1680tok, 4K=2520tok
const GEMINI_FLASH_COST: Record<string, number> = {
  "512": 0.045,
  "1K": 0.067,
  "2K": 0.101,
  "4K": 0.151,
};

// Pro 3: $120/1M tok — 1K/2K=1120tok, 4K=2000tok
const GEMINI_PRO_COST: Record<string, number> = {
  "512": 0.134,
  "1K": 0.134,
  "2K": 0.134,
  "4K": 0.240,
};

function geminiResTier(maxDim: number): string {
  if (maxDim <= 512) return "512";
  if (maxDim <= 1024) return "1K";
  if (maxDim <= 2048) return "2K";
  return "4K";
}

export function estimateGeminiApiCost(size: string, model?: string | null): number {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return 0.003;
  const maxDim = Math.max(Number(match[1]), Number(match[2]));
  const tier = geminiResTier(maxDim);
  const isPro = model === "nano-banana-pro";
  const costMap = isPro ? GEMINI_PRO_COST : GEMINI_FLASH_COST;
  return costMap[tier] ?? costMap["1K"] ?? 0.003;
}

export function estimateCost(quality: Quality, size: string, provider?: string, model?: string | null): number {
  if (provider === "gemini-api") return estimateGeminiApiCost(size, model);
  return COST_MAP[quality]?.[size] ?? 0;
}
