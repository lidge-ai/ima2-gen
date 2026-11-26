import type { MediaSelection } from "./mediaSelection";

export type MediaInputRole = "first-frame" | "source-image" | "reference-image";
export type MediaInput = { role: MediaInputRole; filename?: string; ref?: string; url?: string };

export function buildMediaSubmitBody(selection: MediaSelection, prompt: string, requestId: string,
  sessionId: string | null, inputs: MediaInput[]): Record<string, unknown> {
  return { requestId, sessionId, prompt, model: selection.model, adapter: selection.adapter,
    task: selection.task, durationSec: selection.durationSec, resolution: selection.resolution,
    aspectRatio: selection.aspectRatio, audio: selection.audio,
    negativePrompt: selection.negativePrompt, seed: selection.seed, inputs };
}
