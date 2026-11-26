import type { MediaInput } from "../../providers/media/contract.js";
import type {
  LocalStep, MediaStep, ModelSlot, ResolvedSlot, StepRuntime, WorkflowField, WorkflowMediaRef,
  WorkflowStep, WorkflowValues,
} from "../types.js";
import { inputsFrom, joinPrompt, option, refsOf, textOf, videoResolutionField, wholeSeconds } from "./shared.js";

/** Source limits shared by every Remix workflow (4-15 s, 200 MB), matching Sume's public Remix schema. */
export function sourceVideoField(): WorkflowField {
  return {
    name: "video", type: "media", accept: "video", label: "Source video", required: true, min: 1, max: 1,
    minDurationSec: 4, maxDurationSec: 15, maxBytes: 200 * 1024 * 1024,
    help: "A 4-15 second clip. The output follows its length and aspect ratio.",
  };
}

export function referenceImagesField(help: string): WorkflowField {
  return { name: "images", type: "media", accept: "image", label: "Reference images", required: true, min: 1, max: 8, help };
}

export function soundField(): WorkflowField {
  return {
    name: "sound", type: "enum", label: "Sound", required: false, default: "source",
    options: [option("source", "Keep the source sound"), option("generate", "Let the model make new sound"), option("none", "Silent")],
  };
}

export function tierField(): WorkflowField {
  return {
    name: "tier", type: "enum", label: "Quality", required: false, default: "standard",
    options: [option("standard", "Standard"), option("lite", "Lite (faster, cheaper model)")],
  };
}

export const REMIX_FIELDS_TAIL: readonly WorkflowField[] = [videoResolutionField(), soundField()];

const RENDER_EVIDENCE = "BytePlus ModelArk Seedance 2.5 guide (https://docs.byteplus.com/en/docs/ModelArk/seedance-2-5, read 2026-11-26): "
  + "explicit edit mode on a 4-30 s source video with up to 30 reference images; output follows the source length (up to 0.4 s shorter). "
  + "BytePlus restricts direct upload of real human faces; see the portrait workflow there.";

/** The video edit slot used by every Remix workflow. */
export function renderSlot(withLite: boolean): ModelSlot {
  const slot: ModelSlot = {
    name: "render", label: "Video edit", task: "video-to-video",
    defaultModel: "bytedance/seedance-2.5",
    alternatives: ["bytedance/seedance-2.5-flash", "bytedance/seedance-2", "bytedance/seedance-2-mini", "google/gemini-omni-flash-1.2"],
    rationale: RENDER_EVIDENCE,
  };
  if (withLite) slot.tierModels = { lite: "bytedance/seedance-2.5-flash" };
  return slot;
}

export function sourceOf(values: WorkflowValues): WorkflowMediaRef {
  const ref = refsOf(values, "video")[0];
  if (!ref) throw new Error("source video missing after validation");
  return ref;
}

export interface RenderSpec {
  slot: ResolvedSlot;
  values: WorkflowValues;
  dependsOn: readonly string[];
  instruction: string;
  /** Extra inputs that come from earlier steps (e.g. a stylized first frame). */
  extraInputs?(rt: StepRuntime): Promise<MediaInput[]>;
  includeUserImages: boolean;
}

/** The edit call: source video plus reference images, prompt = our instruction + the user's text. */
export function renderStep(spec: RenderSpec): MediaStep {
  const { values, slot } = spec;
  const source = sourceOf(values);
  const resolution = textOf(values, "resolution") ?? "720p";
  const sound = textOf(values, "sound") ?? "source";
  const seconds = wholeSeconds(source);
  const step: MediaStep = {
    id: "render", label: "Edit the source video", kind: "media", slot: "render",
    model: slot.model, outputKind: "video", dependsOn: spec.dependsOn,
    units: { unit: "second", quantity: seconds, variant: resolution + (sound === "generate" ? "+audio" : "") },
    async build(rt) {
      const inputs: MediaInput[] = [await rt.asInput(source, "source-video")];
      if (spec.extraInputs) inputs.push(...await spec.extraInputs(rt));
      if (spec.includeUserImages) inputs.push(...await inputsFrom(rt, refsOf(values, "images"), "reference-image"));
      return {
        model: slot.model, task: "video-to-video", prompt: joinPrompt(spec.instruction, textOf(values, "prompt")),
        durationSec: seconds, resolution, audio: sound === "generate", inputs,
      };
    },
  };
  if (slot.route) step.route = slot.route;
  return step;
}

/** Puts the source's own sound back on the edited video. */
export function keepSoundStep(values: WorkflowValues): LocalStep {
  const source = sourceOf(values);
  return {
    id: "sound", label: "Put the source sound back", kind: "local", op: "mux-audio", dependsOn: ["render"], final: true,
    async run(rt) {
      const video = rt.artifactsOf("render")[0];
      if (!video || !source.path) throw new Error("render output or source file missing");
      const out = rt.tempPath("with-sound.mp4");
      await rt.local.muxAudio(video.path, source.path, out, rt.signal);
      return [{ kind: "video", mimeType: "video/mp4", path: out }];
    },
  };
}

/** Render, then restore source audio when asked and present. */
export function finishRemix(values: WorkflowValues, before: readonly WorkflowStep[], render: MediaStep): WorkflowStep[] {
  const keep = (textOf(values, "sound") ?? "source") === "source" && sourceOf(values).hasAudio === true;
  if (!keep) render.final = true;
  return keep ? [...before, render, keepSoundStep(values)] : [...before, render];
}

/** "image 1 (face), image 2 ..." helper text for prompts. */
export function imageList(count: number): string {
  return Array.from({ length: count }, (_, i) => "image " + (i + 1)).join(", ");
}
