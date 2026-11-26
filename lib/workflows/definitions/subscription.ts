/**
 * Subscription-only Remix (Jun, 2026-11-26): runs on a ChatGPT subscription (GPT OAuth image edits)
 * and a Grok subscription (Grok OAuth video). Numbers checked against this repo on 2026-11-26:
 * - Grok edit (/v1/videos/edits, routes/videoExtended.ts): base grok-imagine-video only; body is
 *   model + prompt + video, no image input. xAI docs: source up to 8.7 s, output capped at 720p.
 * - Grok 1.5 pins (lib/grokVideoPins.ts): first frame, last_frame and up to 4 keyframes on a 1/3 s
 *   grid strictly inside the duration; pins make reference-to-video, capped at 720p; 1-15 s.
 * - GPT OAuth images (lib/codexBackend): gpt-image-2 edits with reference images.
 */
import type { ModelSlot, WorkflowPreset } from "../types.js";

export const GROK_OAUTH_ROUTE = "xai-oauth";
export const GPT_OAUTH_ROUTE = "openai-oauth";
export const GROK_EDIT_MAX_SEC = 8.7;
export const GROK_PIN_MAX_KEYFRAMES = 4;
export const GROK_PIN_MAX_SEC = 15;

export const REQUIRES: WorkflowPreset["requires"] = [
  { route: GPT_OAUTH_ROUTE, label: "ChatGPT subscription (GPT OAuth) for still-frame edits" },
  { route: GROK_OAUTH_ROUTE, label: "Grok subscription (Grok OAuth) for video" },
];

export const BILLING_NOTE = "xAI's pricing page says paid plans include API access billed separately from the plan's usage pool "
  + "(https://x.ai/pricing, read 2026-11-26). Whether ima2's Grok OAuth video calls draw from the subscription is unverified; "
  + "estimates show xAI API prices.";

export const GPT_FRAME_SLOT: ModelSlot = {
  name: "composite", label: "Put the subject into a frame (GPT)", task: "image-to-image",
  defaultModel: "openai/gpt-image-2", alternatives: ["openai/gpt-image-2.6"], defaultRoute: GPT_OAUTH_ROUTE,
  rationale: "GPT OAuth edits stills with reference images (lib/codexBackend CODEX_IMAGE_MODEL gpt-image-2). "
    + "ChatGPT has no video model since Sora's API shut down (developers.openai.com video-generation guide, read 2026-11-26).",
};

export const GROK_PIN_SLOT: ModelSlot = {
  name: "render", label: "Regenerate the clip between pinned frames (Grok 1.5)", task: "reference-to-video",
  defaultModel: "xai/grok-imagine-video-1.5", alternatives: [], defaultRoute: GROK_OAUTH_ROUTE,
  rationale: "Grok Imagine Video 1.5 reference-to-video pins a first frame, a last frame and up to 4 keyframes "
    + "(lib/grokVideoPins.ts; docs.x.ai reference-to-video, read 2026-11-26), up to 14 reference images, 720p.",
};

export const GROK_EDIT_SLOT: ModelSlot = {
  name: "edit", label: "Restyle each segment (Grok edit)", task: "video-to-video",
  defaultModel: "xai/grok-imagine-video", alternatives: [], defaultRoute: GROK_OAUTH_ROUTE,
  rationale: "Grok's video edit takes a prompt and a source of up to 8.7 s, output capped at 720p "
    + "(docs.x.ai video editing, read 2026-11-26; base model only per skills/ima2/SKILL.md).",
};

/** Even segments no longer than maxSec. */
export function segmentPlan(totalSec: number, maxSec: number): { startSec: number; durationSec: number }[] {
  const count = Math.max(1, Math.ceil((totalSec - 0.05) / maxSec));
  const length = totalSec / count;
  return Array.from({ length: count }, (_, i) => ({ startSec: i * length, durationSec: length }));
}

/** Output length for pinned regeneration: whole seconds, 1-15. */
export function pinnedDuration(sourceSec: number): number {
  return Math.min(GROK_PIN_MAX_SEC, Math.max(1, Math.round(sourceSec)));
}

/**
 * Interior keyframe times on the 1/3 s grid, evenly spread, strictly inside (0, duration),
 * one per grid slot. Fewer than asked when the clip is too short to hold them.
 */
export function anchorTimes(durationSec: number, count: number): number[] {
  const slots = new Set<number>();
  for (let k = 1; k <= count; k += 1) {
    const slot = Math.round((durationSec * k / (count + 1)) * 3);
    if (slot > 0 && slot < durationSec * 3) slots.add(slot);
  }
  return [...slots].sort((a, b) => a - b).map((slot) => Math.round((slot / 3) * 1000) / 1000);
}

/** "720p" unless the source's short side is 480 px or less (Grok edits keep the source size up to 720p). */
export function cappedVariant(width: number | undefined, height: number | undefined): string {
  const short = Math.min(width ?? 720, height ?? 720);
  return short <= 480 ? "480p" : "720p";
}
