import {
  chooseRoute, taskForm,
  type Catalog, type CatalogModel, type CatalogRoute, type MediaOptionSpec, type MediaSubmitBody, type MediaTask, type MediaVoice, type RouteChoice,
} from "@ima2/studio-kit";
import { messages, tr } from "../../i18n.ts";
import type { SlotValue } from "../../ui/UploadSlot.tsx";

const M = messages(
  {
    model: "Choose a model.", script: "Write what the voice should say.", voice: "Choose a voice.", describe: "Describe the sound.",
    length: "Set a length.", range: "Length must be {min} to {max} seconds.", video: "Add the video.",
    force_instrumental: "Instrumental only", loop: "Seamless loop",
  },
  {
    model: "모델을 골라 주세요.", script: "목소리가 읽을 내용을 적어 주세요.", voice: "목소리를 골라 주세요.", describe: "만들 소리를 설명해 주세요.",
    length: "길이를 정해 주세요.", range: "길이는 {min}~{max}초여야 해요.", video: "영상을 추가해 주세요.",
    force_instrumental: "연주곡만", loop: "끊김 없이 반복",
  },
);

/** speech: a voice reads text. sound: music or effects from a description. video: sound made to fit a clip. */
export const AUDIO_TOOLS = ["speech", "sound", "video"] as const;
export type AudioTool = (typeof AUDIO_TOOLS)[number];

export interface AudioState {
  tool: AudioTool;
  model: string | undefined;
  provider: string;
  text: string;
  voice: MediaVoice | null;
  /** Typed length in seconds; empty lets the model decide where the route allows it. */
  seconds: string;
  switches: Readonly<Record<string, boolean>>;
  video: SlotValue | null;
  /** Length of the uploaded video; undefined while it is being read, null when it cannot be. */
  videoSeconds: number | null | undefined;
}

export function emptyState(tool: AudioTool): AudioState {
  return { tool, model: undefined, provider: "", text: "", voice: null, seconds: "", switches: {}, video: null, videoSeconds: undefined };
}

const TASK: Record<AudioTool, MediaTask> = { speech: "text-to-audio", sound: "text-to-audio", video: "video-to-audio" };
export const taskOf = (tool: AudioTool): MediaTask => TASK[tool];

const serves = (model: CatalogModel, route: CatalogRoute, task: MediaTask) => (route.tasks ?? model.tasks).includes(task);

export function voiceOption(model: CatalogModel, providerId: string): MediaOptionSpec | undefined {
  return model.routeParams?.[providerId]?.options?.find((option) => option.type === "voice");
}

/** Routes of a model that can run a tool: speech needs a voice option, sound must not, video must declare its source clip. */
export function toolRoutes(model: CatalogModel, tool: AudioTool): CatalogRoute[] {
  return model.routes.filter((route) => {
    if (model.kind !== "audio") return false;
    if (tool === "video") return taskForm(model, route.providerId, "video-to-audio") !== null;
    if (!serves(model, route, "text-to-audio")) return false;
    return (voiceOption(model, route.providerId) !== undefined) === (tool === "speech");
  });
}

export function modelsFor(catalog: Catalog, tool: AudioTool): CatalogModel[] {
  return catalog.models.filter((model) => toolRoutes(model, tool).length > 0);
}

export function availableTools(catalog: Catalog): AudioTool[] {
  return AUDIO_TOOLS.filter((tool) => modelsFor(catalog, tool).length > 0);
}

export function defaultModel(catalog: Catalog, tool: AudioTool, requested?: string): CatalogModel | undefined {
  const models = modelsFor(catalog, tool);
  return models.find((m) => m.id === requested) ?? models.find((m) => toolRoutes(m, tool).some((r) => r.keyConfigured)) ?? models[0];
}

export function chooseToolRoute(model: CatalogModel | undefined, state: AudioState): RouteChoice {
  if (!model) return { kind: "unavailable" };
  return chooseRoute({ ...model, routes: toolRoutes(model, state.tool) }, state.provider || undefined);
}

export interface LengthRange { minSec: number; maxSec: number; required: boolean }

/** The free length a route accepts for this tool, when it declares one. */
export function lengthRange(model: CatalogModel, providerId: string, tool: AudioTool): LengthRange | null {
  const range = model.routeParams?.[providerId]?.durationRange;
  if (!range || tool === "video" || (range.tasks && !range.tasks.includes(taskOf(tool)))) return null;
  return { minSec: range.minSec, maxSec: range.maxSec, required: range.required === true };
}

/** A required length starts at ten seconds (or the nearest the route allows); an optional one starts empty. */
export function startSeconds(range: LengthRange | null): string {
  return range?.required ? String(Math.min(range.maxSec, Math.max(range.minSec, 10))) : "";
}

export function switchesOf(model: CatalogModel, providerId: string, tool: AudioTool): MediaOptionSpec[] {
  const task = taskOf(tool);
  return (model.routeParams?.[providerId]?.options ?? []).filter((o) => o.type === "boolean" && (!o.tasks || o.tasks.includes(task)));
}

export function switchLabel(option: MediaOptionSpec): string {
  return option.name in M.en ? tr(M, option.name as keyof typeof M.en) : option.name.replace(/[_-]+/g, " ");
}

function lengthProblem(range: LengthRange | null, seconds: string): string | null {
  if (!range) return null;
  if (!seconds.trim()) return range.required ? tr(M, "length") : null;
  const value = Number(seconds);
  return Number.isFinite(value) && value >= range.minSec && value <= range.maxSec ? null : tr(M, "range", { min: range.minSec, max: range.maxSec });
}

/** The first thing still missing, said as the next step; null when the form can be sent. */
export function problem(model: CatalogModel | undefined, route: CatalogRoute | undefined, state: AudioState): string | null {
  if (!model || !route) return tr(M, "model");
  if (state.tool === "video") return state.video ? null : tr(M, "video");
  if (!state.text.trim()) return tr(M, state.tool === "speech" ? "script" : "describe");
  if (state.tool === "speech") return state.voice ? null : tr(M, "voice");
  return lengthProblem(lengthRange(model, route.providerId, state.tool), state.seconds);
}

/** What the price is counted in for this request: characters of speech, seconds of sound, the clip's length. */
export function priced(model: CatalogModel, route: CatalogRoute, state: AudioState): { characters?: number; durationSec?: number } {
  if (state.tool === "speech") return state.text.trim() ? { characters: state.text.trim().length } : {};
  if (state.tool === "video") return state.videoSeconds ? { durationSec: Math.ceil(state.videoSeconds) } : {};
  // Only a length the route accepts is priced; a typo should not show a figure.
  const range = lengthRange(model, route.providerId, state.tool);
  return range && state.seconds.trim() && lengthProblem(range, state.seconds) === null ? { durationSec: Number(state.seconds) } : {};
}

export function toBody(model: CatalogModel, route: CatalogRoute, state: AudioState): MediaSubmitBody {
  const text = state.text.trim();
  const base = { model: model.id, provider: route.providerId, task: taskOf(state.tool), clientRequestId: crypto.randomUUID() };
  if (state.tool === "video") {
    return { ...base, ...(text ? { prompt: text } : {}), inputs: state.video ? [{ role: "source-video", inputId: state.video.upload.inputId }] : [] };
  }
  if (state.tool === "speech") {
    const option = voiceOption(model, route.providerId);
    return { ...base, prompt: text, inputs: [], ...(option && state.voice ? { vendorOptions: { [option.name]: state.voice.id } } : {}) };
  }
  const on = switchesOf(model, route.providerId, state.tool).filter((o) => state.switches[o.name]).map((o) => [o.name, true]);
  const length = priced(model, route, state).durationSec;
  return { ...base, prompt: text, inputs: [], ...(length !== undefined ? { durationSec: length } : {}), ...(on.length ? { vendorOptions: Object.fromEntries(on) } : {}) };
}
