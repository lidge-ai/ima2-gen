/**
 * Remix presets built on the stage layout of the open Genjutsu reproductions
 * (D3voz/openjutsu, SydFloyd/openjutsu, Henge): analyse the source, caption it, segment the
 * target, prepare the subject in anchor frames, guided render, restore the source sound.
 * Every stage runs on a commercial model through the media adapters, with the user's keys.
 */
import { WorkflowError } from "../../errors.js";
import type { ModelSlot, PlanEnv, SlotCredit, PlanNote, ResolvedSlot, StepRuntime, WorkflowCombo, WorkflowDefinition, WorkflowField, WorkflowStep, WorkflowValues } from "../../types.js";
import { checkReferenceLimit } from "../../validate.js";
import { referenceImagesField, sourceVideoField } from "../remixShared.js";
import { inputsFrom, option, refsOf, textOf, videoResolutionField } from "../shared.js";
import { STYLE_PRESETS } from "../styles.js";
import { restylePrompt, subjectPrompt } from "./prompts.js";
import { renderStep } from "./render.js";
import {
  captionStep, checkRenderFit, framePoints, frameStep, scenesStep, segmentStep, strategyFor, subjectStep, userReferences, withSound,
  type OpenMode,
} from "./stages.js";

/** Open projects whose stage layout these presets follow (licences read 2026-11-26). */
const OPEN_CREDITS: readonly SlotCredit[] = [
  { name: "D3voz/openjutsu", url: "https://github.com/D3voz/openjutsu", license: "MIT" },
  { name: "SydFloyd/openjutsu", url: "https://github.com/SydFloyd/openjutsu", license: "Apache-2.0" },
  { name: "alisson-anjos/Henge", url: "https://github.com/alisson-anjos/Henge", license: "MIT" },
];

const IMAGE_EDITORS = ["bytedance/seedream-5.5", "openai/gpt-image-2.6", "openai/gpt-image-2", "google/nano-banana-2.1", "google/nano-banana-pro", "black-forest-labs/flux-2-pro", "black-forest-labs/flux-kontext-pro", "kling/kling-image-o1"];
/** GPT image over the ChatGPT sign-in (lib/codexBackend), tried first for every image stage. */
const GPT_OAUTH_IMAGE = "openai/gpt-image-2";
const EDITORS_AFTER = (next: string): string[] => [next, ...IMAGE_EDITORS.filter((m) => m !== next && m !== GPT_OAUTH_IMAGE)];

function subjectSlot(mode: OpenMode): ModelSlot {
  // Without a ChatGPT sign-in the next keyed editor takes over: GPT Image by key for swaps (mask edits),
  // FLUX Kontext for restyles, Seedream for motion anchors.
  const next = mode === "swap" ? "openai/gpt-image-2.6" : mode === "restyle" ? "black-forest-labs/flux-kontext-pro" : "bytedance/seedream-5.5";
  return {
    name: "subject", label: mode === "restyle" ? "Restyle the first frame" : "Put the subject into the first frame", task: "image-to-image", optional: true,
    defaultModel: GPT_OAUTH_IMAGE, alternatives: EDITORS_AFTER(next), modelRoutes: { [GPT_OAUTH_IMAGE]: "openai-oauth" },
    description: mode === "restyle" ? "Redraws the first frame of the source in the chosen style."
      : mode === "swap" ? "Puts the replacement into the source's first frame." : "Puts your subject into the source's first frame.",
    credits: OPEN_CREDITS,
    // Route order (subscription first, then keyed editors) reaches people as the plan's "fallback" note.
    rationale: "The open pipelines anchor identity or look in the first frame before video generation; an image edit model does that here."
      + (mode === "swap" ? " OpenAI edits take the segment mask as the edit area." : ""),
  };
}

const SEGMENT_SLOT: ModelSlot = {
  name: "segment", label: "Mask the target", task: "image-segment", optional: true, defaultModel: "meta/sam-3", alternatives: [],
  description: "Marks the target to replace in the first frame.",
  credits: OPEN_CREDITS,
  rationale: "openjutsu tracks the target with SAM 3.1 before the swap; hosted SAM 3 (fal-ai/sam-3/image) masks it in the first frame.",
};

const REFERENCE_RENDERERS = ["bytedance/seedance-2", "bytedance/seedance-2-fast", "bytedance/seedance-2-mini", "bytedance/seedance-2.5-flash", "kling/kling-4-omni", "alibaba/wan-3.0", "minimax/minimax-h3", "xai/grok-imagine-video-1.5"];
const EDIT_RENDERERS = ["bytedance/seedance-2.5-flash", "bytedance/seedance-2", "bytedance/seedance-2-mini", "kling/kling-4-omni", "kling/kling-o1", "kling/kling-3-omni", "xai/grok-imagine-video"];

function renderSlot(mode: OpenMode): ModelSlot {
  const motion = mode === "motion";
  return {
    name: "render", label: motion ? "Render with the source as motion reference" : "Edit the source video",
    task: motion ? "reference-to-video" : "video-to-video", defaultModel: "bytedance/seedance-2.5",
    alternatives: motion ? REFERENCE_RENDERERS : EDIT_RENDERERS,
    description: motion ? "Renders a new clip that follows the source's motion and camera."
      : mode === "swap" ? "Edits the source clip to match the prepared first frame." : "Edits the source clip to match the restyled first frame.",
    credits: OPEN_CREDITS,
    rationale: "The open pipelines' guide-conditioned render (MiniMax H3 / Wan Animate / VACE with masks and pose) has no public API with the same inputs; "
      + (motion ? "models that take a reference video carry the motion instead, and Grok 1.5 regenerates between pinned anchor frames."
        : "video edit models take the source video plus the prepared first frame."),
  };
}

const COMBOS: Readonly<Record<OpenMode, readonly WorkflowCombo[]>> = {
  motion: [
    { id: "byteplus", label: "BytePlus only", models: { subject: "bytedance/seedream-5.5", render: "bytedance/seedance-2" }, routes: { subject: "byteplus", render: "byteplus" } },
    { id: "subscription", label: "Subscriptions only (ChatGPT + Grok)", models: { subject: "openai/gpt-image-2", render: "xai/grok-imagine-video-1.5" }, routes: { subject: "openai-oauth", render: "xai-oauth" }, note: "Motion is regenerated between pinned frames; 720p, whole-second length." },
    { id: "kling", label: "Kling only", models: { subject: "kling/kling-image-o1", render: "kling/kling-4-omni" } },
  ],
  swap: [
    { id: "byteplus", label: "BytePlus only", models: { subject: "bytedance/seedream-5.5", render: "bytedance/seedance-2.5" }, routes: { subject: "byteplus", render: "byteplus" }, note: "No mask step; the target is named in the prompt." },
    { id: "subscription", label: "Subscriptions only (ChatGPT + Grok)", models: { subject: "openai/gpt-image-2", render: "xai/grok-imagine-video" }, routes: { subject: "openai-oauth", render: "xai-oauth" }, note: "Grok's edit takes text only (no image): up to 8.7 s, 720p." },
    { id: "fal", label: "fal (SAM 3 + Nano Banana + Kling O1)", models: { segment: "meta/sam-3", subject: "google/nano-banana-2.1", render: "kling/kling-o1" }, routes: { segment: "fal", subject: "fal", render: "fal" } },
  ],
  restyle: [
    { id: "byteplus", label: "BytePlus only", models: { subject: "bytedance/seedream-5.5", render: "bytedance/seedance-2.5" }, routes: { subject: "byteplus", render: "byteplus" } },
    { id: "subscription", label: "Subscriptions only (ChatGPT + Grok)", models: { subject: "openai/gpt-image-2", render: "xai/grok-imagine-video" }, routes: { subject: "openai-oauth", render: "xai-oauth" }, note: "Grok's edit takes text only: the styled frame is not used; up to 8.7 s, 720p." },
    { id: "bfl-byteplus", label: "FLUX Kontext + Seedance", models: { subject: "black-forest-labs/flux-kontext-pro", render: "bytedance/seedance-2.5" }, routes: { render: "byteplus" } },
  ],
};

const SOUND_FIELD: WorkflowField = {
  name: "sound", type: "enum", label: "Sound", required: false, default: "source",
  options: [option("source", "Keep the source sound"), option("model", "Let the model make sound"), option("none", "Silent")],
};
const NOTES_FIELD: WorkflowField = { name: "prompt", type: "text", label: "Notes", required: false, maxLength: 4000, multiline: true };

function fields(mode: OpenMode): WorkflowField[] {
  const list: WorkflowField[] = [sourceVideoField()];
  if (mode === "motion") list.push(referenceImagesField("1-8 images of the people or things that should perform, in order."));
  if (mode === "swap") {
    list.push(referenceImagesField("1-8 images of the replacements, in order."));
    list.push({ name: "target", type: "text", label: "What to replace", required: true, maxLength: 500, help: "Used for the mask and the prompt, e.g. the paper boat." });
  }
  if (mode === "restyle") {
    list.push({ name: "style", type: "enum", label: "Style", required: false, options: Object.entries(STYLE_PRESETS).map(([k, s]) => option(k, s.label)) });
    list.push({ name: "styleImage", type: "media", accept: "image", label: "Style reference", required: false, min: 1, max: 1 });
  }
  list.push(NOTES_FIELD);
  if (mode === "motion") {
    list.push({ name: "anchors", type: "integer", label: "Pinned keyframes", required: false, min: 0, max: 4, default: 4, help: "Only for models that regenerate between pinned frames (Grok 1.5)." });
  }
  list.push(videoResolutionField(), SOUND_FIELD);
  return list;
}

function subjectReferences(mode: OpenMode, values: WorkflowValues) {
  return (rt: StepRuntime) => (mode === "restyle" ? inputsFrom(rt, refsOf(values, "styleImage"), "reference-image") : userReferences(rt, values));
}

function subjectPromptFor(mode: OpenMode, values: WorkflowValues, masked: boolean): () => string {
  if (mode === "restyle") {
    const style = STYLE_PRESETS[textOf(values, "style") ?? ""]?.prompt;
    return () => restylePrompt(style, refsOf(values, "styleImage").length > 0, textOf(values, "prompt"));
  }
  return () => subjectPrompt(mode, textOf(values, "target"), refsOf(values, "images").length, masked, mode === "motion" ? textOf(values, "prompt") : undefined);
}

function plan(mode: OpenMode, values: WorkflowValues, models: Readonly<Record<string, ResolvedSlot>>, env: PlanEnv): { steps: WorkflowStep[]; notes: PlanNote[] } {
  const render = models.render;
  if (!render) throw new Error("render slot missing");
  const strategy = strategyFor(mode, render.model);
  checkRenderFit(env, render.model, values);
  const subject = models.subject;
  if (strategy === "pins" && !subject) {
    throw new WorkflowError("WORKFLOW_INPUT_INVALID", "selection: " + render.model + " regenerates between pinned frames and needs an image model for the subject step", { status: 400, field: "selection" });
  }
  const images = refsOf(values, "images").length;
  checkReferenceLimit(env, render.model, mode === "restyle" ? 1 : images + (subject ? 1 : 0), "images");
  const { duration, points } = framePoints(values, strategy);
  const notes: PlanNote[] = [];
  const steps: WorkflowStep[] = [scenesStep(), ...points.map(frameStep)];
  const hasCaption = env.canPlanText === true;
  if (hasCaption) steps.push(captionStep(points));
  else notes.push({ stepId: "caption", kind: "skipped", message: "No vision planner is configured, so the source is not captioned; prompts use only your notes." });
  const segment = mode === "swap" ? models.segment : undefined;
  if (segment) steps.push(segmentStep(segment, textOf(values, "target")));
  const masked = Boolean(segment && subject?.model.startsWith("openai/"));
  if (segment && !masked) notes.push({ stepId: "segment", kind: "info", message: "The mask is kept as an intermediate; " + (subject?.model ?? "no image model") + " takes no mask, so the target is named in the prompt." });
  if (subject) {
    const anchorPoints = strategy === "pins" ? points : points.filter((p) => p.role === "first");
    for (const point of anchorPoints) {
      steps.push(subjectStep({ point, slot: subject, masked, prompt: subjectPromptFor(mode, values, masked), references: subjectReferences(mode, values) }));
    }
  }
  const step = renderStep({ mode, strategy, slot: render, values, points, pinDuration: duration, hasCaption, hasSubject: Boolean(subject) }, env);
  return { steps: withSound(values, steps, step), notes };
}

function definition(mode: OpenMode): WorkflowDefinition {
  const id = mode === "motion" ? "remix-motion-transfer-open" : mode === "swap" ? "remix-object-swap-open" : "remix-restyle-open";
  return {
    id,
    label: (mode === "motion" ? "Remix: motion transfer" : mode === "swap" ? "Remix: object swap" : "Remix: restyle") + " (open pipeline)",
    description: "The open Genjutsu reproductions' stages (analyse, caption, mask, prepare the subject, guided render, restore sound), each run on a commercial model with your keys.",
    equivalents: mode === "motion" ? ["sume/sume-remix-motion-transfer"] : mode === "swap" ? ["sume/sume-remix-object-swap"] : ["sume/sume-remix-restyle"],
    fields: fields(mode),
    slots: mode === "swap" ? [SEGMENT_SLOT, subjectSlot(mode), renderSlot(mode)] : [subjectSlot(mode), renderSlot(mode)],
    combos: COMBOS[mode],
    ...(mode === "restyle" ? { check: (values: WorkflowValues) => (values.style === undefined && values.styleImage === undefined && values.prompt === undefined ? "choose a style, a style reference or describe the look" : null) } : {}),
    plan(values, models, env) {
      const { steps, notes } = plan(mode, values, models, env);
      return { workflowId: id, steps, notes };
    },
  };
}

export const remixMotionTransferOpen = definition("motion");
export const remixObjectSwapOpen = definition("swap");
export const remixRestyleOpen = definition("restyle");
