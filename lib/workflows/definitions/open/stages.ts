/**
 * Stage builders for the open-pipeline Remix presets: analyse the source (cuts, frames),
 * caption it with a vision planner, segment the target, put the subject into anchor frames,
 * render with a guided video model, and lay the source sound back.
 */
import { readFile } from "node:fs/promises";
import type { MediaInput, MediaModelSpec } from "../../../providers/media/contract.js";
import { WorkflowError } from "../../errors.js";
import type { LocalStep, MediaStep, PlanEnv, ResolvedSlot, StepRuntime, TextStep, WorkflowStep, WorkflowValues } from "../../types.js";
import { keepSoundStep, sourceOf } from "../remixShared.js";
import { inputsFrom, refsOf, textOf, wholeSeconds } from "../shared.js";
import { anchorTimes, pinnedDuration } from "../subscription.js";
import { CAPTION_SYSTEM, captionUser, readCaption, type Caption } from "./prompts.js";

export type OpenMode = "motion" | "swap" | "restyle";
export type RenderStrategy = "reference" | "edit" | "pins";

/** Grok 1.5 regenerates between pinned frames (lib/grokVideoPins.ts); it takes no source video. */
export const PIN_MODELS: ReadonlySet<string> = new Set(["xai/grok-imagine-video-1.5"]);
/** Edit models whose request carries only a prompt and the source video (docs.x.ai video edits). */
export const TEXT_ONLY_EDIT: ReadonlySet<string> = new Set(["xai/grok-imagine-video"]);
/** Longest source each edit model accepts, from its maker's docs. */
const EDIT_SOURCE_MAX_SEC: Readonly<Record<string, number>> = { "xai/grok-imagine-video": 8.7 };
const SCENE_THRESHOLD = 0.3;

export interface FramePoint {
  id: string;
  /** Source position for the frame op: "first", "last" or seconds. */
  position: string;
  /** Time of this frame in the output (pins only). */
  outputSec: number;
  role: "first" | "key" | "last";
}

export function strategyFor(mode: OpenMode, model: string): RenderStrategy {
  if (mode !== "motion") return "edit";
  return PIN_MODELS.has(model) ? "pins" : "reference";
}

/** Caption frames (first, middle, last), or pin frames on the 1/3 s grid for pin models. */
export function framePoints(values: WorkflowValues, strategy: RenderStrategy): { duration: number; points: FramePoint[] } {
  const sourceSec = sourceOf(values).durationSec ?? 0;
  if (strategy !== "pins") {
    const mid: FramePoint = { id: "mid", position: (sourceSec / 2).toFixed(3), outputSec: sourceSec / 2, role: "key" };
    return { duration: sourceSec, points: [{ id: "first", position: "first", outputSec: 0, role: "first" }, mid, { id: "last", position: "last", outputSec: sourceSec, role: "last" }] };
  }
  const duration = pinnedDuration(sourceSec);
  const count = typeof values.anchors === "number" ? values.anchors : 4;
  const scale = sourceSec / duration;
  const keys = anchorTimes(duration, count).map((t, i): FramePoint => ({ id: "key-" + (i + 1), position: (t * scale).toFixed(3), outputSec: t, role: "key" }));
  return { duration, points: [{ id: "first", position: "first", outputSec: 0, role: "first" }, ...keys, { id: "last", position: "last", outputSec: duration, role: "last" }] };
}

export function scenesStep(): LocalStep {
  return {
    id: "scenes", label: "Find shot cuts", kind: "local", op: "scenes", dependsOn: [],
    async run(rt) {
      const source = sourceOf(rt.values);
      if (!source.path) throw new Error("source file missing");
      const cuts = await rt.local.scenes(source.path, SCENE_THRESHOLD, rt.signal);
      const json = JSON.stringify({ durationSec: source.durationSec ?? null, threshold: SCENE_THRESHOLD, cuts });
      return [{ kind: "json", mimeType: "application/json", bytes: new TextEncoder().encode(json), meta: { cuts: cuts.length } }];
    },
  };
}

export function frameStep(point: FramePoint): LocalStep {
  return {
    id: "frame-" + point.id, label: "Take the " + point.id + " frame", kind: "local", op: "frame", dependsOn: [],
    async run(rt) {
      const source = sourceOf(rt.values);
      if (!source.path) throw new Error("source file missing");
      const out = rt.tempPath(point.id + ".png");
      await rt.local.frame(source.path, out, point.position, rt.signal);
      return [{ kind: "image", mimeType: "image/png", path: out, meta: { sourcePosition: point.position, outputSec: point.outputSec } }];
    },
  };
}

async function captionImages(rt: StepRuntime, frameIds: readonly string[]): Promise<{ mimeType: string; bytes: Uint8Array }[]> {
  const images: { mimeType: string; bytes: Uint8Array }[] = [];
  for (const id of frameIds) {
    const frame = rt.artifactsOf(id)[0];
    if (frame) images.push({ mimeType: frame.mimeType, bytes: new Uint8Array(await readFile(frame.path)) });
  }
  for (const ref of refsOf(rt.values, "images").concat(refsOf(rt.values, "styleImage"))) {
    if (ref.path) images.push({ mimeType: ref.mimeType, bytes: new Uint8Array(await readFile(ref.path)) });
  }
  return images;
}

/** Vision caption of the source frames and references (the open pipelines' describer stage). */
export function captionStep(points: readonly FramePoint[]): TextStep {
  const frameIds = points.map((p) => "frame-" + p.id);
  return {
    id: "caption", label: "Describe the source shot", kind: "text", dependsOn: frameIds,
    async run(rt) {
      if (!rt.gateway.planText) throw new WorkflowError("WORKFLOW_PLANNER_UNAVAILABLE", "captions need a vision planner; none is configured", { status: 503 });
      const images = await captionImages(rt, frameIds);
      const refCount = images.length - frameIds.length;
      const raw = await rt.gateway.planText({ purpose: "remix-caption", system: CAPTION_SYSTEM, user: captionUser(frameIds.length, refCount, sourceOf(rt.values).durationSec ?? 0), images }, rt.signal);
      const caption = readCaption(raw);
      return [{ kind: "json", mimeType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(caption)) }];
    },
  };
}

export async function captionOf(rt: StepRuntime, hasCaption: boolean): Promise<Caption | undefined> {
  if (!hasCaption) return undefined;
  const artifact = rt.artifactsOf("caption")[0];
  return artifact ? readCaption(JSON.parse(await readFile(artifact.path, "utf8"))) : undefined;
}

export function segmentStep(slot: ResolvedSlot, target: string | undefined): MediaStep {
  const step: MediaStep = {
    id: "segment", label: "Mask the target (first frame)", kind: "media", slot: "segment", model: slot.model, outputKind: "image",
    dependsOn: ["frame-first"], units: { unit: "request", quantity: 1 },
    async build(rt) {
      const frame = rt.artifactsOf("frame-first")[0];
      if (!frame) throw new Error("first frame missing");
      return { model: slot.model, task: "image-segment", prompt: target ?? "main subject", inputs: [await rt.asInput(frame, "source-image")] };
    },
  };
  if (slot.route) step.route = slot.route;
  return step;
}

export interface SubjectSpec {
  point: FramePoint;
  slot: ResolvedSlot;
  prompt: (rt: StepRuntime) => string;
  /** Use the segment mask as the edit area (OpenAI image edits take a mask). */
  masked: boolean;
  references: (rt: StepRuntime) => Promise<MediaInput[]>;
}

/** Puts the subject (or the new look) into one anchor frame with an image edit model. */
export function subjectStep(spec: SubjectSpec): MediaStep {
  const deps = ["frame-" + spec.point.id, ...(spec.masked ? ["segment"] : [])];
  const step: MediaStep = {
    id: "subject-" + spec.point.id, label: "Prepare the " + spec.point.id + " frame", kind: "media", slot: "subject",
    model: spec.slot.model, outputKind: "image", dependsOn: deps, units: { unit: "image", quantity: 1 },
    async build(rt) {
      const frame = rt.artifactsOf("frame-" + spec.point.id)[0];
      if (!frame) throw new Error("frame missing");
      const inputs = [await rt.asInput(frame, "source-image"), ...await spec.references(rt)];
      const mask = spec.masked ? rt.artifactsOf("segment")[0] : undefined;
      if (mask) inputs.push(await rt.asInput(mask, "mask"));
      return { model: spec.slot.model, task: "image-to-image", prompt: spec.prompt(rt), count: 1, inputs };
    },
  };
  if (spec.slot.route) step.route = spec.slot.route;
  return step;
}

/** Allowed output length closest above the source, from the model's listed durations. */
export function renderSeconds(sourceSec: number, spec: MediaModelSpec | undefined): number {
  const want = wholeSeconds({ durationSec: sourceSec, mimeType: "video/mp4" });
  const listed = [...(spec?.params.durationsSec ?? [])].sort((a, b) => a - b);
  if (listed.length === 0) return want;
  return listed.find((d) => d >= want) ?? listed[listed.length - 1] ?? want;
}

/** Plan-time limits that would otherwise fail at the provider. */
export function checkRenderFit(env: PlanEnv, model: string, values: WorkflowValues): void {
  const max = EDIT_SOURCE_MAX_SEC[model];
  const seconds = sourceOf(values).durationSec ?? 0;
  if (max !== undefined && seconds > max + 0.05) {
    throw new WorkflowError("WORKFLOW_INPUT_INVALID", "video: " + model + " edits clips up to " + max + " seconds", { status: 400, field: "video" });
  }
  const listed = env.catalog(model)?.params.resolutions;
  const resolution = textOf(values, "resolution");
  if (resolution && listed && listed.length > 0 && !listed.some((r) => r.toLowerCase() === resolution.toLowerCase())) {
    throw new WorkflowError("WORKFLOW_INPUT_INVALID", "resolution: " + model + " offers " + listed.join(", "), { status: 400, field: "resolution" });
  }
  const sound = textOf(values, "sound") ?? "source";
  const silent = sound === "none" || (sound === "source" && sourceOf(values).hasAudio !== true);
  if (TEXT_ONLY_EDIT.has(model) && silent) {
    throw new WorkflowError("WORKFLOW_INPUT_INVALID", "sound: " + model + " always returns sound; keep the source sound (a source with sound) or let the model make sound", { status: 400, field: "sound" });
  }
}

export function withSound(values: WorkflowValues, steps: WorkflowStep[], render: MediaStep): WorkflowStep[] {
  const keep = (textOf(values, "sound") ?? "source") === "source" && sourceOf(values).hasAudio === true;
  if (!keep) {
    render.final = true;
    return [...steps, render];
  }
  return [...steps, render, keepSoundStep(values)];
}

export async function userReferences(rt: StepRuntime, values: WorkflowValues): Promise<MediaInput[]> {
  return inputsFrom(rt, refsOf(values, "images"), "reference-image");
}
