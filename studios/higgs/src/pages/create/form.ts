import {
  chooseRoute,
  type CatalogModel,
  type MediaSubmitBody,
  type MediaTask,
  type RouteChoice,
} from "@ima2/studio-kit";
import type { SlotValue } from "../../ui/UploadSlot.tsx";

export interface CreateForm {
  model: string | undefined;
  provider: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string | undefined;
  durationSec: number | undefined;
  resolution: string | undefined;
  count: number;
  audio: boolean;
  seed: string;
  firstFrame: SlotValue | null;
  lastFrame: SlotValue | null;
  references: readonly SlotValue[];
  sourceImage: SlotValue | null;
  sourceVideo: SlotValue | null;
  /** Video page: create from text/frames, or edit an existing clip. */
  mode: "create" | "edit";
  /** Video create: start/end frames, or free reference images. */
  refMode: "frames" | "references";
  preset: string | undefined;
}

export const EDIT_TASKS: readonly MediaTask[] = ["video-to-video", "video-extend", "video-upscale", "lipsync"];

export function emptyForm(model?: CatalogModel): CreateForm {
  return {
    model: model?.id,
    provider: "",
    prompt: "",
    negativePrompt: "",
    ...defaultsFor(model),
    count: 1,
    seed: "",
    firstFrame: null,
    lastFrame: null,
    references: [],
    sourceImage: null,
    sourceVideo: null,
    mode: "create",
    refMode: "frames",
    preset: undefined,
  };
}

/** Keeps a setting when the new model supports it, else falls back to the model's first option. */
export function defaultsFor(model: CatalogModel | undefined, keep?: Partial<CreateForm>) {
  const p = model?.params ?? {};
  const pick = <T>(options: readonly T[] | undefined, current: T | undefined) =>
    options && current !== undefined && options.includes(current) ? current : options?.[0];
  return {
    aspectRatio: pick(p.aspectRatios, keep?.aspectRatio),
    durationSec: pick(p.durationsSec, keep?.durationSec),
    resolution: pick(p.resolutions, keep?.resolution),
    audio: keep?.audio ?? true,
  };
}

/** Task follows the inputs the person gave, limited to what the model can do. */
export function taskFor(model: CatalogModel, form: CreateForm): MediaTask | null {
  const has = (task: MediaTask) => model.tasks.includes(task);
  if (model.kind === "video" && form.mode === "edit") {
    if (!form.sourceVideo) return null;
    return EDIT_TASKS.find(has) ?? null;
  }
  if (model.kind === "video") {
    if (form.references.length > 0) return has("reference-to-video") ? "reference-to-video" : null;
    if (form.firstFrame) return has("image-to-video") ? "image-to-video" : null;
    return has("text-to-video") ? "text-to-video" : null;
  }
  if (model.kind === "image") {
    if (form.sourceImage || form.references.length > 0) return has("image-to-image") ? "image-to-image" : null;
    return has("text-to-image") ? "text-to-image" : null;
  }
  return model.tasks[0] ?? null;
}

export function routeFor(model: CatalogModel | undefined, form: CreateForm): RouteChoice {
  if (!model) return { kind: "unavailable" };
  return chooseRoute(model, form.provider || undefined);
}

export function problem(model: CatalogModel | undefined, form: CreateForm): string | null {
  if (!model) return "Choose a model.";
  const task = taskFor(model, form);
  if (!task && form.mode === "edit" && !form.sourceVideo) return "Add the video to edit.";
  if (!task) return model.label + " cannot use these inputs. Remove an input or choose another model.";
  if (!form.prompt.trim() && (task === "text-to-video" || task === "text-to-image")) return "Write a prompt.";
  return null;
}

export function toBody(model: CatalogModel, form: CreateForm, provider: string | undefined): MediaSubmitBody {
  const slots =
    form.mode === "edit" ? [form.sourceVideo] : [form.firstFrame, form.lastFrame, form.sourceImage, ...form.references];
  const inputs = slots
    .filter((slot): slot is SlotValue => slot !== null)
    .map((slot) => ({ role: slot.role, inputId: slot.upload.inputId }));
  const seed = Number.parseInt(form.seed, 10);
  return {
    model: model.id,
    ...(provider ? { provider } : {}),
    task: taskFor(model, form) ?? model.tasks[0] ?? "text-to-image",
    ...(form.prompt.trim() ? { prompt: form.prompt.trim() } : {}),
    ...(form.negativePrompt.trim() && model.params.negativePrompt
      ? { negativePrompt: form.negativePrompt.trim() }
      : {}),
    ...(form.aspectRatio ? { aspectRatio: form.aspectRatio } : {}),
    ...(form.durationSec ? { durationSec: form.durationSec } : {}),
    ...(form.resolution ? { resolution: form.resolution } : {}),
    ...(model.params.nativeAudio ? { audio: form.audio } : {}),
    ...(model.kind === "image" ? { count: form.count } : {}),
    ...(Number.isFinite(seed) && model.params.seed ? { seed } : {}),
    inputs,
    clientRequestId: crypto.randomUUID(),
  };
}
