import type { LocalStep, MediaStep, ResolvedSlot, WorkflowDefinition, WorkflowStep, WorkflowValues } from "../types.js";
import { keepSoundStep, sourceOf, sourceVideoField } from "./remixShared.js";
import { joinPrompt, option, textOf } from "./shared.js";
import { KEEP_PEOPLE, STYLE_PRESETS } from "./styles.js";
import { BILLING_NOTE, cappedVariant, XAI_EDIT_MAX_SEC, XAI_EDIT_SLOT, REQUIRES, segmentPlan } from "./subscription.js";

function prompt(values: WorkflowValues): string {
  const preset = STYLE_PRESETS[textOf(values, "style") ?? ""];
  return joinPrompt(
    "Restyle this video. Keep every motion, camera move, framing and timing exactly as filmed; change only the look.",
    KEEP_PEOPLE,
    preset ? "Style: " + preset.prompt : undefined,
    textOf(values, "prompt"),
  );
}

function cutStep(index: number, startSec: number, durationSec: number): LocalStep {
  return {
    id: "cut-" + (index + 1), label: "Cut segment " + (index + 1), kind: "local", op: "cut", dependsOn: [],
    async run(rt) {
      const source = sourceOf(rt.values);
      if (!source.path) throw new Error("source file missing");
      const out = rt.tempPath("segment.mp4");
      await rt.local.cut(source.path, startSec, durationSec, out, rt.signal);
      return [{ kind: "video", mimeType: "video/mp4", path: out }];
    },
  };
}

function editStep(index: number, seconds: number, slot: ResolvedSlot, values: WorkflowValues): MediaStep {
  const source = sourceOf(values);
  const step: MediaStep = {
    id: "edit-" + (index + 1), label: "Restyle segment " + (index + 1), kind: "media", slot: "edit", model: slot.model,
    outputKind: "video", dependsOn: ["cut-" + (index + 1)],
    units: { unit: "second", quantity: Math.ceil(seconds - 0.05), variant: cappedVariant(source.width, source.height) },
    async build(rt) {
      const segment = rt.artifactsOf("cut-" + (index + 1))[0];
      if (!segment) throw new Error("segment missing");
      return { model: slot.model, task: "video-to-video", prompt: prompt(values), inputs: [await rt.asInput(segment, "source-video")] };
    },
  };
  if (slot.route) step.route = slot.route;
  return step;
}

function joinStep(count: number): LocalStep {
  const ids = Array.from({ length: count }, (_, i) => "edit-" + (i + 1));
  return {
    id: "render", label: "Join the segments", kind: "local", op: "concat", dependsOn: ids,
    async run(rt) {
      const out = rt.tempPath("joined.mp4");
      await rt.local.concat(ids.map((id) => rt.artifactsOf(id)[0]?.path ?? ""), out, rt.signal);
      return [{ kind: "video", mimeType: "video/mp4", path: out }];
    },
  };
}

function plan(values: WorkflowValues, slot: ResolvedSlot): WorkflowStep[] {
  const source = sourceOf(values);
  const segments = segmentPlan(source.durationSec ?? 0, XAI_EDIT_MAX_SEC);
  const steps: WorkflowStep[] = [];
  segments.forEach((s, i) => steps.push(cutStep(i, s.startSec, s.durationSec), editStep(i, s.durationSec, slot, values)));
  let last: WorkflowStep;
  if (segments.length > 1) {
    last = joinStep(segments.length);
    steps.push(last);
  } else {
    const only = steps[1] as MediaStep;
    only.id = "render";
    last = only;
  }
  if ((textOf(values, "sound") ?? "source") === "source" && source.hasAudio === true) return [...steps, keepSoundStep(values)];
  last.final = true;
  return steps;
}

export const remixRestyleSubscription: WorkflowDefinition = {
  id: "remix-restyle-subscription",
  label: "Remix: restyle (subscriptions only)",
  description: "Restyles a 4-15 second clip with Grok's video edit, in segments of up to 8.7 seconds, and puts the source sound back.",
  preset: {
    id: "subscription", label: "Subscriptions only", basedOn: "remix-restyle", requires: [REQUIRES[1]!], billingNote: BILLING_NOTE,
    losses: [
      { aspect: "style", detail: "The style comes from text only; Grok's edit takes no style image." },
      { aspect: "style", detail: "Clips over 8.7 s are edited in separate segments, so the look can shift at a cut." },
      { aspect: "resolution", detail: "720p at most; no 1080p." },
    ],
  },
  fields: [
    sourceVideoField(),
    { name: "style", type: "enum", label: "Style", required: false, options: Object.entries(STYLE_PRESETS).map(([k, s]) => option(k, s.label)) },
    { name: "prompt", type: "text", label: "Look", required: false, maxLength: 2000, multiline: true, help: "Describe the look; added after the style." },
    { name: "sound", type: "enum", label: "Sound", required: false, default: "source", options: [option("source", "Keep the source sound"), option("model", "Use the edit's sound")] },
  ],
  slots: [XAI_EDIT_SLOT],
  check(values) {
    return values.style === undefined && values.prompt === undefined ? "choose a style or describe the look" : null;
  },
  plan(values, models) {
    const slot = models.edit;
    if (!slot) throw new Error("edit slot missing");
    // Each segment stays inside Grok's 8.7 s edit limit; renaming the single edit keeps "render" as the clip step.
    return { workflowId: "remix-restyle-subscription", steps: plan(values, slot) };
  },
};
