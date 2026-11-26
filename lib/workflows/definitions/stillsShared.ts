import type { MediaStep, ModelSlot, ResolvedSlot, WorkflowField, WorkflowValues } from "../types.js";
import { inputsFrom, intOf, joinPrompt, lookPrompt, option, refsOf, textOf } from "./shared.js";

export const imageSlot: ModelSlot = {
  name: "image", label: "Image", task: "text-to-image", defaultModel: "google/nano-banana-pro",
  alternatives: ["bytedance/seedream-5.5", "openai/gpt-image-2.6", "kling/kling-image-3-omni", "black-forest-labs/flux-kontext-max"],
  rationale: "Google's image-generation guide describes up to 14 reference images and 1K/2K/4K output: https://ai.google.dev/gemini-api/docs/image-generation (read 2026-11-26).",
};

export const promptField: WorkflowField = { name: "prompt", type: "text", label: "Prompt", required: true, maxLength: 4000, multiline: true };
export const countField: WorkflowField = { name: "n", type: "integer", label: "Count", required: false, min: 1, max: 4, default: 1 };
export const resolutionField = (sizes: readonly string[]): WorkflowField => ({
  name: "resolution", type: "enum", label: "Resolution", required: false,
  options: sizes.map((size) => option(size, size.toUpperCase())), default: "2k",
});

export function stillStep(values: WorkflowValues, slot: ResolvedSlot, framing: string, defaultAspect: string, fixedCount = false): MediaStep {
  const count = fixedCount ? 1 : intOf(values, "n", 1);
  const resolution = textOf(values, "resolution") ?? "2k";
  const aspectRatio = textOf(values, "aspectRatio") ?? defaultAspect;
  const refs = [...refsOf(values, "images"), ...refsOf(values, "characterImage")];
  return {
    id: "render", label: "Render", kind: "media", dependsOn: [], final: true,
    slot: "image", model: slot.model, ...(slot.route !== undefined && { route: slot.route }), outputKind: "image",
    units: { unit: "image", quantity: count, variant: resolution },
    async build(rt) {
      return {
        model: slot.model, task: refs.length ? "image-to-image" : "text-to-image",
        prompt: joinPrompt(framing, textOf(values, "prompt"), lookPrompt(values)),
        aspectRatio, resolution, count, inputs: await inputsFrom(rt, refs, "reference-image"),
      };
    },
  };
}
