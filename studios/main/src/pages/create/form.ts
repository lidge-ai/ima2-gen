import { messages, tr } from "../../i18n.ts";
import {
  chooseRoute,
  sameResolution,
  type CatalogModel,
  type MediaSubmitBody,
  type MediaTask,
  type RouteChoice,
} from "@ima2/studio-kit";
import type { SlotValue } from "../../ui/UploadSlot.tsx";

const M = messages(
  {
    "model": "Choose a model.",
    "inputs": "{model} cannot use these inputs. Remove an input or choose another model.",
    "prompt": "Write a prompt.",
    "handOff": "Could not bring that result here. Add it with the upload button.",
  },
  {
    "model": "모델을 골라 주세요.",
    "inputs": "{model} 모델은 이 입력을 사용할 수 없어요. 입력을 삭제하거나 다른 모델을 골라 주세요.",
    "prompt": "프롬프트를 입력해 주세요.",
    "handOff": "결과를 가져오지 못했어요. 업로드 버튼으로 직접 추가해 주세요.",
  },
);

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
  /** Video create: start/end frames, or free reference images. */
  refMode: "frames" | "references";
  preset: string | undefined;
  /** A problem with something sent from another screen; cleared by the next change to the form. */
  notice?: string | undefined;
}

export const handOffFailed = () => tr(M, "handOff");

/** What the create form makes; editing a clip has its own form (pages/edit). */
export const CREATE_TASKS: readonly MediaTask[] = ["text-to-video", "image-to-video", "reference-to-video"];

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
    refMode: "frames",
    preset: undefined,
  };
}

type Listed = "aspectRatios" | "durationsSec" | "resolutions";

const same = <T>(a: T, b: T) =>
  typeof a === "string" && typeof b === "string" ? sameResolution(a, b) : a === b;

/**
 * The model's lists merge every route and read in size order, so the default is the first value of
 * the route the server would use (a 5 s clip, not the 1 s another route also offers).
 */
function routeDefault<T>(model: CatalogModel | undefined, key: Listed, options: readonly T[] | undefined): T | undefined {
  const route = model?.defaultRoute ?? model?.routes[0]?.providerId;
  const first = route ? (model?.routeParams?.[route]?.[key] as readonly T[] | undefined)?.[0] : undefined;
  return (first !== undefined ? options?.find((option) => same(option, first)) : undefined) ?? options?.[0];
}

/** Keeps a setting when the new model supports it, else falls back to the default route's first option. */
export function defaultsFor(model: CatalogModel | undefined, keep?: Partial<CreateForm>) {
  const p = model?.params ?? {};
  const pick = <T>(key: Listed, options: readonly T[] | undefined, current: T | undefined) =>
    (current !== undefined ? options?.find((option) => same(option, current)) : undefined) ??
    routeDefault(model, key, options);
  return {
    aspectRatio: pick("aspectRatios", p.aspectRatios, keep?.aspectRatio),
    durationSec: pick("durationsSec", p.durationsSec, keep?.durationSec),
    resolution: pick("resolutions", p.resolutions, keep?.resolution),
    audio: keep?.audio ?? true,
  };
}

/** Task follows the inputs the person gave, limited to what the model can do. */
export function taskFor(model: CatalogModel, form: CreateForm): MediaTask | null {
  const has = (task: MediaTask) => model.tasks.includes(task);
  if (model.kind === "video") {
    if (form.references.length > 0) return has("reference-to-video") ? "reference-to-video" : null;
    if (form.firstFrame) return has("image-to-video") ? "image-to-video" : null;
    return has("text-to-video") ? "text-to-video" : null;
  }
  if (model.kind === "image") {
    // Working on an image has its own tools (pages/image); this form makes one from a prompt.
    return has("text-to-image") ? "text-to-image" : null;
  }
  return model.tasks[0] ?? null;
}

export function routeFor(model: CatalogModel | undefined, form: CreateForm): RouteChoice {
  if (!model) return { kind: "unavailable" };
  return chooseRoute(model, form.provider || undefined, taskFor(model, form) ?? undefined);
}

export function problem(model: CatalogModel | undefined, form: CreateForm): string | null {
  if (!model) return tr(M, "model");
  const task = taskFor(model, form);
  if (!task) return tr(M, "inputs", { model: model.label });
  if (!form.prompt.trim() && (task === "text-to-video" || task === "text-to-image")) return tr(M, "prompt");
  return null;
}

export function toBody(model: CatalogModel, form: CreateForm, provider: string | undefined): MediaSubmitBody {
  const slots = [form.firstFrame, form.lastFrame, ...form.references];
  const inputs = slots
    .filter((slot): slot is SlotValue => slot !== null)
    .map((slot) => ({ role: slot.role, inputId: slot.upload.inputId }));
  const seed = Number.parseInt(form.seed, 10);
  // A route can spell a size its own way ("1k" where another lists "1K"); send its spelling.
  const spelled = provider ? model.routeParams?.[provider]?.resolutions : undefined;
  const resolution = form.resolution && (spelled?.find((r) => sameResolution(r, form.resolution!)) ?? form.resolution);
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
    ...(resolution ? { resolution } : {}),
    ...(model.params.nativeAudio ? { audio: form.audio } : {}),
    ...(model.kind === "image" ? { count: form.count } : {}),
    ...(Number.isFinite(seed) && model.params.seed ? { seed } : {}),
    inputs,
    clientRequestId: crypto.randomUUID(),
  };
}
