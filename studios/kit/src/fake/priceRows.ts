import type { MediaPrice } from "../types.ts";

/**
 * Published rows written the way the providers write them, which a studio-side matcher misread: "audio off"
 * (PixVerse, per resolution and sound) and "768P to 2K output" (MiniMax H3 Regeneration). The server's rule
 * prices them, so the fake answers estimates with that rule too.
 */
const pixverseRow = (resolution: string, sound: "off" | "on", references: boolean, credits: number): MediaPrice => ({
  unit: "second", usd: credits / 225, source: "fixture:fake", checkedAt: "2026-11-28",
  variant: resolution + " audio " + sound + ", " + (references ? "video references" : "no video references") + "; " + credits + " credits/s, 225 credits/USD",
});
export const PRICE_ROWS: Readonly<Record<string, Readonly<Record<string, readonly MediaPrice[]>>>> = {
  "pixverse/pixverse-v6": {
    pixverse: [
      pixverseRow("720p", "off", false, 9), pixverseRow("1080p", "off", false, 15),
      pixverseRow("720p", "on", false, 12), pixverseRow("1080p", "on", false, 20),
      pixverseRow("720p", "off", true, 18), pixverseRow("720p", "on", true, 24),
    ],
  },
  "minimax/hailuo-h3-regen": {
    minimax: [{ unit: "second", usd: 0.05, variant: "768P to 2K output; input billed separately", source: "fixture:fake", checkedAt: "2026-11-28" }],
  },
};
