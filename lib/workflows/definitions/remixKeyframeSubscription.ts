import type { LocalStep, MediaStep, ResolvedSlot, WorkflowDefinition, WorkflowField, WorkflowPreset, WorkflowStep, WorkflowValues } from "../types.js";
import { checkReferenceLimit } from "../validate.js";
import { keepSoundStep, referenceImagesField, sourceOf, sourceVideoField } from "./remixShared.js";
import { frameLabel, inputsFrom, joinPrompt, option, refsOf, textOf } from "./shared.js";
import {
  anchorTimes, BILLING_NOTE, GPT_FRAME_SLOT, XAI_PIN_MAX_KEYFRAMES, XAI_PIN_SLOT, pinnedDuration, REQUIRES,
} from "./subscription.js";

type Mode = "motion" | "swap";

interface Anchor { id: string; sourceSec: string; outputSec: number; role: "first" | "key" | "last" }

/** First frame, interior keyframes on the 1/3 s grid, last frame; source times scaled to the output length. */
function anchors(values: WorkflowValues): { duration: number; list: Anchor[] } {
  const sourceSec = sourceOf(values).durationSec ?? 0;
  const duration = pinnedDuration(sourceSec);
  const count = typeof values.anchors === "number" ? values.anchors : XAI_PIN_MAX_KEYFRAMES;
  const scale = sourceSec / duration;
  const keys = anchorTimes(duration, count).map((t, i): Anchor => ({ id: "key-" + (i + 1), sourceSec: (t * scale).toFixed(3), outputSec: t, role: "key" }));
  return { duration, list: [{ id: "first", sourceSec: "first", outputSec: 0, role: "first" }, ...keys, { id: "last", sourceSec: "last", outputSec: duration, role: "last" }] };
}

function frameStep(anchor: Anchor): LocalStep {
  return {
    id: "frame-" + anchor.id, label: "Take " + frameLabel(anchor.id), kind: "local", op: "frame", dependsOn: [],
    async run(rt) {
      const source = sourceOf(rt.values);
      if (!source.path) throw new Error("source file missing");
      const out = rt.tempPath(anchor.id + ".png");
      await rt.local.frame(source.path, out, anchor.sourceSec, rt.signal);
      return [{ kind: "image", mimeType: "image/png", path: out }];
    },
  };
}

function compositePrompt(mode: Mode, values: WorkflowValues, refCount: number): string {
  const refs = Array.from({ length: refCount }, (_, i) => "image " + (i + 2)).join(", ");
  const target = textOf(values, "target");
  return joinPrompt(
    mode === "motion"
      ? "Edit image 1. Replace the people or things performing in it with the subjects from " + refs + ", in that order. Keep each pose, position, scale, framing, background and lighting exactly."
      : "Edit image 1. Replace only " + (target ?? "the main subject") + " with the one from " + refs + ". Keep everything else in image 1 exactly as it is.",
    textOf(values, "prompt"),
  );
}

function compositeStep(mode: Mode, anchor: Anchor, slot: ResolvedSlot, values: WorkflowValues): MediaStep {
  const step: MediaStep = {
    id: "swap-" + anchor.id, label: "Put the subject into " + frameLabel(anchor.id), kind: "media", slot: "composite",
    model: slot.model, outputKind: "image", dependsOn: ["frame-" + anchor.id], units: { unit: "image", quantity: 1 },
    async build(rt) {
      const frame = rt.artifactsOf("frame-" + anchor.id)[0];
      if (!frame) throw new Error("frame missing");
      const refs = refsOf(values, "images");
      const inputs = [await rt.asInput(frame, "source-image"), ...await inputsFrom(rt, refs, "reference-image")];
      return { model: slot.model, task: "image-to-image", prompt: compositePrompt(mode, values, refs.length), count: 1, inputs };
    },
  };
  if (slot.route) step.route = slot.route;
  return step;
}

/**
 * Pinned regeneration. Keyframe images travel as reference-image inputs listed in
 * vendorOptions.keyframes ({ inputIndex, timestampS }); the adapter sends those as keyframes, not references.
 */
function renderStep(list: readonly Anchor[], duration: number, slot: ResolvedSlot, values: WorkflowValues): MediaStep {
  const keys = list.filter((a) => a.role === "key");
  const sound = textOf(values, "sound") ?? "source";
  const resolution = textOf(values, "resolution") ?? "720p";
  const step: MediaStep = {
    id: "render", label: "Regenerate the clip between the pinned frames", kind: "media", slot: "render", model: slot.model,
    outputKind: "video", dependsOn: list.map((a) => "swap-" + a.id), units: { unit: "second", quantity: duration, variant: resolution },
    async build(rt) {
      const pinned = async (id: string, role: "first-frame" | "last-frame" | "reference-image") => rt.asInput(rt.artifactsOf("swap-" + id)[0]!, role);
      const inputs = [await pinned("first", "first-frame"), await pinned("last", "last-frame")];
      const keyframes: { inputIndex: number; timestampS: number }[] = [];
      for (const key of keys) {
        keyframes.push({ inputIndex: inputs.length, timestampS: key.outputSec });
        inputs.push(await pinned(key.id, "reference-image"));
      }
      inputs.push(...await inputsFrom(rt, refsOf(values, "images"), "reference-image"));
      return {
        model: slot.model, task: "reference-to-video", durationSec: duration, resolution, audio: sound === "model",
        prompt: joinPrompt("Animate smoothly from the first frame through each pinned frame to the last frame, matching each pinned pose at its time. Keep the people and objects consistent with the reference images.", textOf(values, "prompt")),
        inputs, vendorOptions: { keyframes },
      };
    },
  };
  if (slot.route) step.route = slot.route;
  return step;
}

function steps(mode: Mode, values: WorkflowValues, models: Readonly<Record<string, ResolvedSlot>>): WorkflowStep[] {
  const composite = models.composite;
  const render = models.render;
  if (!composite || !render) throw new Error("subscription remix slots missing");
  const { duration, list } = anchors(values);
  const out: WorkflowStep[] = [...list.map(frameStep), ...list.map((a) => compositeStep(mode, a, composite, values))];
  const clip = renderStep(list, duration, render, values);
  out.push(clip);
  if ((textOf(values, "sound") ?? "source") === "source" && sourceOf(values).hasAudio === true) return [...out, keepSoundStep(values)];
  clip.final = true;
  return out;
}

const LOSSES: WorkflowPreset["losses"] = [
  { aspect: "motion", detail: "Motion is regenerated between up to 6 pinned frames (first, 4 keyframes, last); it matches the source only at those frames." },
  { aspect: "identity", detail: "The subject is drawn into each pinned frame by GPT; between frames Grok keeps it from the reference images, so details can drift." },
  { aspect: "length", detail: "Output length is the source length rounded to whole seconds (1-15 s)." },
  { aspect: "resolution", detail: "720p at most; pinned frames make a reference-to-video request, which has no 1080p." },
  { aspect: "audio", detail: "The source sound is laid back on regenerated motion and can drift out of sync." },
];

function fields(mode: Mode): WorkflowField[] {
  const list: WorkflowField[] = [
    sourceVideoField(),
    referenceImagesField(mode === "motion" ? "1-8 images of the people or things that should perform, in order." : "1-8 images of the replacements, in order."),
  ];
  if (mode === "swap") list.push({ name: "target", type: "text", label: "What to replace", required: false, maxLength: 500 });
  list.push(
    { name: "prompt", type: "text", label: "Notes", required: false, maxLength: 4000, multiline: true },
    { name: "anchors", type: "integer", label: "Pinned keyframes", required: false, min: 0, max: XAI_PIN_MAX_KEYFRAMES, default: XAI_PIN_MAX_KEYFRAMES, help: "More keyframes follow the source motion more closely and cost one GPT edit each." },
    { name: "resolution", type: "enum", label: "Resolution", required: false, default: "720p", options: [option("480p", "480p"), option("720p", "720p")] },
    { name: "sound", type: "enum", label: "Sound", required: false, default: "source", options: [option("source", "Keep the source sound"), option("model", "Let Grok make sound"), option("none", "Silent")] },
  );
  return list;
}

function definition(mode: Mode): WorkflowDefinition {
  const basedOn = mode === "motion" ? "remix-motion-transfer" : "remix-object-swap";
  const id = mode === "motion" ? "remix-motion-transfer-subscription" : "remix-object-swap-subscription";
  return {
    id,
    label: mode === "motion" ? "Remix: motion transfer (subscriptions only)" : "Remix: object swap (subscriptions only)",
    description: "Draws your subject into pinned frames of the source with GPT, then regenerates the clip between those frames with Grok 1.5.",
    preset: { id: "subscription", label: "Subscriptions only", basedOn, requires: REQUIRES, losses: LOSSES, billingNote: BILLING_NOTE },
    fields: fields(mode),
    slots: [GPT_FRAME_SLOT, XAI_PIN_SLOT],
    plan(values, models, env) {
      const keyCount = anchors(values).list.filter((a) => a.role === "key").length;
      checkReferenceLimit(env, models.render?.model ?? XAI_PIN_SLOT.defaultModel, refsOf(values, "images").length + keyCount, "images");
      return { workflowId: id, steps: steps(mode, values, models) };
    },
  };
}

export const remixMotionTransferSubscription = definition("motion");
export const remixObjectSwapSubscription = definition("swap");
