import { messages, tr } from "../../i18n.ts";
import {
  chooseRoute,
  sameResolution,
  type CatalogModel,
  type MediaSubmitBody,
  type MediaTask,
  type ResultSettings,
  type RouteChoice,
} from "@ima2/studio-kit";
import type { SlotValue } from "../../ui/UploadSlot.tsx";

const M = messages(
  {
    "model": "Choose a model.",
    "inputs": "{model} cannot use these inputs. Remove an input or choose another model.",
    "prompt": "Write a prompt.",
    "handOff": "Could not bring that result here. Add it with the upload button.",
    "inputsAgain": "Settings copied from this result. The {n} input files it used are not kept, so add them again.",
    "inputsAgainOne": "Settings copied from this result. The input file it used is not kept, so add it again.",
    "noFrames": "{model} takes no start or end frame. Choose a model that makes video from an image.",
    "noRefs": "{model} takes no reference images. Choose a model that takes references.",
    "refsFull": "The references are full ({max}). Remove one to add this image.",
    "endOnly": "Set as the end frame. Add a start frame too: without one, depending on the model, the end frame is not used or the request is refused.",
  },
  {
    "model": "모델을 골라 주세요.",
    "inputs": "{model} 모델은 이 입력을 사용할 수 없어요. 입력을 삭제하거나 다른 모델을 골라 주세요.",
    "prompt": "프롬프트를 입력해 주세요.",
    "handOff": "결과를 가져오지 못했어요. 업로드 버튼으로 직접 추가해 주세요.",
    "inputsAgain": "이 결과의 설정을 가져왔어요. 만들 때 쓴 입력 파일 {n}개는 보관되지 않아서 다시 넣어 주세요.",
    "inputsAgainOne": "이 결과의 설정을 가져왔어요. 만들 때 쓴 입력 파일 1개는 보관되지 않아서 다시 넣어 주세요.",
    "noFrames": "{model} 모델은 시작·끝 프레임을 받지 않아요. 이미지로 영상을 만드는 모델을 골라 주세요.",
    "noRefs": "{model} 모델은 레퍼런스 이미지를 받지 않아요. 레퍼런스를 받는 모델을 골라 주세요.",
    "refsFull": "레퍼런스가 가득 찼어요({max}개). 하나를 지우고 이 이미지를 추가해 주세요.",
    "endOnly": "끝 프레임으로 넣었어요. 시작 프레임도 넣어 주세요. 시작 프레임이 없으면 모델에 따라 끝 프레임이 쓰이지 않거나 요청이 거절돼요.",
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
  /** The problem is this model: the notice offers to choose another. */
  noticeModel?: boolean | undefined;
  /** Something the person should know that is not a problem; cleared by the next change to the form. */
  info?: string | undefined;
}

export const handOffFailed = () => tr(M, "handOff");

/**
 * The form with a result's settings put back: its route, length, shape, size and sound, each kept only when
 * this model offers it. A result made from input files says so, since the files themselves are not kept.
 */
export function withResult(model: CatalogModel, form: CreateForm, settings: ResultSettings | undefined): CreateForm {
  if (!settings) return form;
  const kept = defaultsFor(model, {
    aspectRatio: settings.aspectRatio ?? form.aspectRatio, durationSec: settings.durationSec ?? form.durationSec,
    resolution: settings.resolution ?? form.resolution, audio: settings.audio ?? form.audio,
  });
  const inputs = settings.inputRoles?.length ?? 0;
  return {
    ...form, ...kept,
    provider: settings.route && model.routes.some((route) => route.providerId === settings.route) ? settings.route : "",
    info: inputs === 0 ? undefined : tr(M, inputs === 1 ? "inputsAgainOne" : "inputsAgain", { n: inputs }),
  };
}

/** A result sent to the video form as an end frame or a reference: where it goes, or why this model cannot take it. */
export function withSentImage(model: CatalogModel | undefined, form: CreateForm, slot: "last" | "reference", image: Omit<SlotValue, "role">): CreateForm {
  const label = model?.label ?? "";
  if (slot === "last") {
    if (model && !model.tasks.includes("image-to-video")) return { ...form, notice: tr(M, "noFrames", { model: label }), noticeModel: true };
    return {
      ...form, notice: undefined, refMode: "frames", references: [], lastFrame: { ...image, role: "last-frame" },
      info: form.firstFrame ? undefined : tr(M, "endOnly"),
    };
  }
  if (model && !model.tasks.includes("reference-to-video")) return { ...form, notice: tr(M, "noRefs", { model: label }), noticeModel: true };
  const max = model?.params.maxReferenceImages ?? 3;
  if (form.references.some((held) => held.upload.inputId === image.upload.inputId)) return { ...form, notice: undefined, refMode: "references" };
  if (form.references.length >= max) return { ...form, refMode: "references", notice: tr(M, "refsFull", { max }) };
  return { ...form, notice: undefined, refMode: "references", firstFrame: null, lastFrame: null, references: [...form.references, { ...image, role: "reference-image" }] };
}

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
