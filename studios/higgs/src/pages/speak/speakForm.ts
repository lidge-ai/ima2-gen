import {
  TALKING_TASKS, billedSeconds, chooseFormRoute, formRoutes, taskForm,
  type Catalog, type CatalogModel, type MediaInputRequirement, type MediaInputRole, type MediaOptionSpec,
  type MediaSubmitBody, type RouteChoice, type TalkingTask, type TaskForm,
} from "@ima2/studio-kit";
import { getLocale, messages, tr } from "../../i18n.ts";
import type { SlotValue } from "../../ui/UploadSlot.tsx";

const M = messages(
  {
    model: "Choose a model.",
    add: "Add: {label}.",
    choose: "Choose: {label}.",
    lipsyncVideo: "Video of the speaker", lipsyncAudio: "Audio to speak",
    avatarImage: "Face photo", avatarVideo: "Character video", avatarAudio: "Audio to speak",
    dubbingVideo: "Video to dub", subtitlesVideo: "Video to caption", media: "Media",
    target_language: "Dub into", source_language: "Spoken in", tier: "Tier", sync_mode: "If lengths differ",
    motion: "Motion", expressiveness: "Expressiveness", translation_language: "Translate to", preset: "Caption style",
    auto: "Detect",
  },
  {
    model: "모델을 골라 주세요.",
    add: "추가해 주세요: {label}.",
    choose: "골라 주세요: {label}.",
    lipsyncVideo: "말하는 사람 영상", lipsyncAudio: "입힐 오디오",
    avatarImage: "얼굴 사진", avatarVideo: "캐릭터 영상", avatarAudio: "말할 오디오",
    dubbingVideo: "더빙할 영상", subtitlesVideo: "자막을 넣을 영상", media: "미디어",
    target_language: "더빙할 언어", source_language: "원래 언어", tier: "등급", sync_mode: "길이가 다를 때",
    motion: "움직임", expressiveness: "표현 강도", translation_language: "자막 번역 언어", preset: "자막 스타일",
    auto: "자동 감지",
  },
);
type Key = keyof typeof M.en;

export interface SpeakState {
  task: TalkingTask;
  model: string | undefined;
  provider: string;
  resolution: string | undefined;
  /** One file per input role the form asks for. */
  files: Readonly<Partial<Record<MediaInputRole, SlotValue>>>;
  /** Seconds of each uploaded audio or video file; null when the browser could not read it. */
  lengths: Readonly<Partial<Record<MediaInputRole, number | null>>>;
  options: Readonly<Record<string, string | boolean>>;
}

export function emptyState(task: TalkingTask): SpeakState {
  return { task, model: undefined, provider: "", resolution: undefined, files: {}, lengths: {}, options: {} };
}

/** Tools this catalog can run: tasks with at least one route that declares a form. */
export function availableTasks(catalog: Catalog): TalkingTask[] {
  return TALKING_TASKS.filter((task) => modelsFor(catalog, task).length > 0);
}

export function modelsFor(catalog: Catalog, task: TalkingTask): CatalogModel[] {
  return catalog.models.filter((model) => formRoutes(model, task).length > 0);
}

/** A model whose form route has a key first, so the default can run. */
export function defaultModel(catalog: Catalog, task: TalkingTask, requested?: string): CatalogModel | undefined {
  const models = modelsFor(catalog, task);
  return models.find((m) => m.id === requested)
    ?? models.find((m) => formRoutes(m, task).some((r) => r.keyConfigured))
    ?? models[0];
}

export interface Resolved {
  choice: RouteChoice;
  /** The form of the route that would run, or of the route that needs a key. */
  form: TaskForm | null;
}

export function resolve(model: CatalogModel | undefined, state: SpeakState): Resolved {
  if (!model) return { choice: { kind: "unavailable" }, form: null };
  const choice = chooseFormRoute(model, state.task, state.provider || undefined);
  const route = choice.kind === "unavailable" ? undefined : choice.route;
  return { choice, form: route ? taskForm(model, route.providerId, state.task) : null };
}

const SLOT_LABEL: Record<TalkingTask, Partial<Record<MediaInputRole, Key>>> = {
  lipsync: { "source-video": "lipsyncVideo", "source-audio": "lipsyncAudio" },
  avatar: { "source-image": "avatarImage", "reference-image": "avatarImage", "source-video": "avatarVideo", "reference-video": "avatarVideo", "source-audio": "avatarAudio" },
  dubbing: { "source-video": "dubbingVideo" },
  subtitles: { "source-video": "subtitlesVideo" },
};

export function slotLabel(task: TalkingTask, role: MediaInputRole): string {
  return tr(M, SLOT_LABEL[task][role] ?? "media");
}

export function slotAccept(role: MediaInputRole): string {
  return role.endsWith("audio") ? "audio/*" : role.endsWith("video") ? "video/*" : "image/*";
}

const OPTION_LABEL: Readonly<Record<string, Key>> = {
  target_language: "target_language", source_language: "source_language", tier: "tier", sync_mode: "sync_mode",
  motionPrompt: "motion", motion_prompt: "motion", motionExpressiveness: "expressiveness", motion_expressiveness: "expressiveness",
  translation_language: "translation_language", preset: "preset",
};

/** Options a person is shown: the required ones, and the optional ones this screen has a name for. */
export function shownOptions(form: TaskForm): MediaOptionSpec[] {
  return form.options.filter((option) => option.required || option.name in OPTION_LABEL);
}

export function optionLabel(option: MediaOptionSpec): string {
  const known = OPTION_LABEL[option.name];
  return known ? tr(M, known) : option.name.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

const LANGUAGE_OPTION = /language$/i;

/** Language codes read as language names in the screen's language; other values stay as the provider spells them. */
export function valueLabel(option: MediaOptionSpec, value: string): string {
  if (!LANGUAGE_OPTION.test(option.name)) return value;
  if (value === "auto") return tr(M, "auto");
  try {
    return new Intl.DisplayNames([getLocale()], { type: "language" }).of(value) ?? value;
  } catch {
    return value;
  }
}

/** Starting values: dub into the screen's language when the route lists it, else the first listed value of a required choice. */
export function defaultOptions(form: TaskForm): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const option of form.options) {
    if (!option.required || option.type !== "enum" || !option.values?.length) continue;
    const own = option.name === "target_language" ? option.values.find((v) => v === getLocale()) : undefined;
    if (own) out[option.name] = own;
    else if (!LANGUAGE_OPTION.test(option.name)) out[option.name] = option.values[0]!;
  }
  return out;
}

function filled(need: MediaInputRequirement, state: SpeakState): boolean {
  return need.min === 0 || state.files[need.role] !== undefined;
}

/** The first thing still missing, said as the next step; null when the form can be sent. */
export function problem(model: CatalogModel | undefined, form: TaskForm | null, state: SpeakState): string | null {
  if (!model || !form) return tr(M, "model");
  const input = form.inputs.find((need) => !filled(need, state));
  if (input) return tr(M, "add", { label: slotLabel(state.task, input.role) });
  const option = form.options.find((o) => o.required && (state.options[o.name] === undefined || state.options[o.name] === ""));
  return option ? tr(M, "choose", { label: optionLabel(option) }) : null;
}

export function seconds(form: TaskForm | null, state: SpeakState): number | null {
  if (!form) return null;
  const value = billedSeconds(form, state.lengths);
  return value === null ? null : Math.ceil(value);
}

/** Exactly what the form declares: its inputs, a listed resolution and the options that were set. Nothing else is sent. */
export function toBody(model: CatalogModel, form: TaskForm, state: SpeakState, provider: string): MediaSubmitBody {
  const inputs = form.inputs.flatMap((need) => {
    const file = state.files[need.role];
    return file ? [{ role: need.role, inputId: file.upload.inputId }] : [];
  });
  const names = new Set(form.options.map((o) => o.name));
  const vendorOptions = Object.fromEntries(Object.entries(state.options).filter(([name, value]) => names.has(name) && value !== "" && value !== false));
  const resolution = state.resolution && form.resolutions.includes(state.resolution) ? state.resolution : form.resolutions[0];
  return {
    model: model.id, provider, task: state.task, inputs,
    ...(resolution ? { resolution } : {}),
    ...(Object.keys(vendorOptions).length > 0 ? { vendorOptions } : {}),
    clientRequestId: crypto.randomUUID(),
  };
}
