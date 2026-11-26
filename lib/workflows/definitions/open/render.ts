/** Render step of the open-pipeline Remix presets, in three strategies by model capability. */
import type { MediaInput } from "../../../providers/media/contract.js";
import type { MediaStep, PlanEnv, ResolvedSlot, StepRuntime, WorkflowValues } from "../../types.js";
import { sourceOf } from "../remixShared.js";
import { refsOf, textOf } from "../shared.js";
import { STYLE_PRESETS } from "../styles.js";
import { motionRenderPrompt, restyleRenderPrompt, swapRenderPrompt } from "./prompts.js";
import { captionOf, renderSeconds, TEXT_ONLY_EDIT, userReferences, type FramePoint, type OpenMode, type RenderStrategy } from "./stages.js";

export interface RenderSpec {
  mode: OpenMode;
  strategy: RenderStrategy;
  slot: ResolvedSlot;
  values: WorkflowValues;
  points: readonly FramePoint[];
  /** Output length for pins; source-derived otherwise. */
  pinDuration: number;
  hasCaption: boolean;
  /** Whether subject-<point> steps exist (the image slot could run). */
  hasSubject: boolean;
}

function refNames(count: number, offset: number): string {
  if (count === 0) return "the subjects described in the notes";
  return Array.from({ length: count }, (_, i) => "image " + (i + 1 + offset)).join(", ");
}

async function anchor(rt: StepRuntime, id: string, role: MediaInput["role"]): Promise<MediaInput | undefined> {
  const artifact = rt.artifactsOf("subject-" + id)[0];
  return artifact ? rt.asInput(artifact, role) : undefined;
}

async function referenceInputs(rt: StepRuntime, spec: RenderSpec): Promise<{ inputs: MediaInput[]; prompt: string }> {
  const caption = await captionOf(rt, spec.hasCaption);
  const first = spec.hasSubject ? await anchor(rt, "first", "reference-image") : undefined;
  const users = await userReferences(rt, spec.values);
  const images = [...(first ? [first] : []), ...users];
  const inputs = [await rt.asInput(sourceOf(spec.values), "reference-video"), ...images];
  return { inputs, prompt: motionRenderPrompt(caption, textOf(spec.values, "prompt"), refNames(images.length, 0)) };
}

async function editInputs(rt: StepRuntime, spec: RenderSpec): Promise<{ inputs: MediaInput[]; prompt: string }> {
  const caption = await captionOf(rt, spec.hasCaption);
  const textOnly = TEXT_ONLY_EDIT.has(spec.slot.model);
  const inputs = [await rt.asInput(sourceOf(spec.values), "source-video")];
  if (!textOnly) {
    const first = spec.hasSubject ? await anchor(rt, "first", "reference-image") : undefined;
    if (first) inputs.push(first);
    if (spec.mode === "swap") inputs.push(...await userReferences(rt, spec.values));
  }
  const notes = textOf(spec.values, "prompt");
  if (spec.mode === "swap") {
    return { inputs, prompt: swapRenderPrompt(caption, textOf(spec.values, "target"), notes, refNames(inputs.length - 1, 0), textOnly) };
  }
  const style = STYLE_PRESETS[textOf(spec.values, "style") ?? ""]?.prompt;
  return { inputs, prompt: restyleRenderPrompt(caption, style, notes, textOnly || !spec.hasSubject) };
}

/** Pinned regeneration (Grok 1.5): keyframes ride as reference-image inputs listed in vendorOptions.keyframes. */
async function pinInputs(rt: StepRuntime, spec: RenderSpec): Promise<{ inputs: MediaInput[]; prompt: string; keyframes: { inputIndex: number; timestampS: number }[] }> {
  const caption = await captionOf(rt, spec.hasCaption);
  const inputs: MediaInput[] = [];
  const keyframes: { inputIndex: number; timestampS: number }[] = [];
  for (const point of spec.points) {
    const role = point.role === "first" ? "first-frame" : point.role === "last" ? "last-frame" : "reference-image";
    const input = await anchor(rt, point.id, role);
    if (!input) continue;
    if (point.role === "key") keyframes.push({ inputIndex: inputs.length, timestampS: point.outputSec });
    inputs.push(input);
  }
  const users = await userReferences(rt, spec.values);
  inputs.push(...users);
  const prompt = motionRenderPrompt(caption, textOf(spec.values, "prompt"), refNames(users.length, inputs.length - users.length));
  return { inputs, prompt: "Animate smoothly through the pinned frames, matching each pinned pose at its time.\n\n" + prompt, keyframes };
}

export function renderStep(spec: RenderSpec, env: PlanEnv): MediaStep {
  const { slot, values, strategy } = spec;
  const resolution = textOf(values, "resolution") ?? "720p";
  const sound = textOf(values, "sound") ?? "source";
  const sourceSec = sourceOf(values).durationSec ?? 0;
  const seconds = strategy === "pins" ? spec.pinDuration : renderSeconds(sourceSec, env.catalog(slot.model));
  const anchors = spec.hasSubject ? (strategy === "pins" ? spec.points.map((p) => "subject-" + p.id) : ["subject-first"]) : [];
  const step: MediaStep = {
    id: "render", label: strategy === "edit" ? "Edit the source video" : strategy === "pins" ? "Regenerate between pinned frames" : "Render with the source as motion reference",
    kind: "media", slot: "render", model: slot.model, outputKind: "video",
    dependsOn: [...anchors, ...(spec.hasCaption ? ["caption"] : [])],
    units: { unit: "second", quantity: seconds, variant: resolution + (sound === "model" ? "+audio" : "") },
    async build(rt) {
      const audio = sound === "model";
      if (strategy === "pins") {
        const { inputs, prompt, keyframes } = await pinInputs(rt, spec);
        return { model: slot.model, task: "reference-to-video", prompt, durationSec: seconds, resolution, audio, inputs, vendorOptions: { keyframes } };
      }
      if (strategy === "reference") {
        const { inputs, prompt } = await referenceInputs(rt, spec);
        return { model: slot.model, task: "reference-to-video", prompt, durationSec: seconds, resolution, audio, inputs };
      }
      const { inputs, prompt } = await editInputs(rt, spec);
      return { model: slot.model, task: "video-to-video", prompt, resolution, audio, inputs };
    },
  };
  if (slot.route) step.route = slot.route;
  return step;
}

export function userImageCount(values: WorkflowValues): number {
  return refsOf(values, "images").length;
}
