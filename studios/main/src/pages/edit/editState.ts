import {
  EDIT_TASKS, chooseEditRoute, editForm, editRoutes,
  type Catalog, type CatalogModel, type EditForm, type EditTask, type MediaSubmitBody, type RouteChoice,
} from "@ima2/studio-kit";
import { messages, tr } from "../../i18n.ts";
import type { SlotValue } from "../../ui/UploadSlot.tsx";

const M = messages(
  { model: "Choose a model.", video: "Add the video.", prompt: "Write what to do.", reading: "Reading the video's length." },
  { model: "모델을 골라 주세요.", video: "영상을 추가해 주세요.", prompt: "무엇을 할지 적어 주세요.", reading: "영상 길이를 읽는 중이에요." },
);

export interface EditState {
  tool: EditTask;
  model: string | undefined;
  provider: string;
  prompt: string;
  source: SlotValue | null;
  /** Seconds of the source as the browser reads it: undefined while reading, null when it cannot. */
  sourceSec: number | null | undefined;
  durationSec: number | undefined;
  resolution: string | undefined;
  aspectRatio: string | undefined;
  audio: boolean;
}

export function emptyState(tool: EditTask): EditState {
  return { tool, model: undefined, provider: "", prompt: "", source: null, sourceSec: undefined, durationSec: undefined, resolution: undefined, aspectRatio: undefined, audio: true };
}

export function modelsFor(catalog: Catalog, tool: EditTask): CatalogModel[] {
  return catalog.models.filter((model) => model.kind === "video" && editRoutes(model, tool).length > 0);
}

/** Tools this catalog can run: tasks with at least one route that declares a form. */
export function availableTools(catalog: Catalog): EditTask[] {
  return EDIT_TASKS.filter((tool) => modelsFor(catalog, tool).length > 0);
}

/** A model whose form route has a key first, so the default can run. */
export function defaultModel(catalog: Catalog, tool: EditTask, requested?: string): CatalogModel | undefined {
  const models = modelsFor(catalog, tool);
  return models.find((m) => m.id === requested) ?? models.find((m) => editRoutes(m, tool).some((r) => r.keyConfigured)) ?? models[0];
}

export interface Resolved {
  choice: RouteChoice;
  /** The form of the route that would run, or of the route that needs a key. */
  form: EditForm | null;
}

export function resolve(model: CatalogModel | undefined, state: EditState): Resolved {
  if (!model) return { choice: { kind: "unavailable" }, form: null };
  const choice = chooseEditRoute(model, state.tool, state.provider || undefined);
  const route = choice.kind === "unavailable" ? undefined : choice.route;
  return { choice, form: route ? editForm(model, route.providerId, state.tool) : null };
}

const keep = <T>(list: readonly T[], value: T | undefined): T | undefined => (value !== undefined && list.includes(value) ? value : list[0]);

/** Settings that the route in use lists, keeping a value it still offers. */
export function withForm(state: EditState, form: EditForm | null): EditState {
  return {
    ...state,
    durationSec: form ? keep(form.durationsSec, state.durationSec) : undefined,
    resolution: form ? keep(form.resolutions, state.resolution) : undefined,
    aspectRatio: form ? keep(form.aspectRatios, state.aspectRatio) : undefined,
  };
}

export const takes = (form: EditForm, name: EditForm["fields"]["accepts"][number]) => form.fields.accepts.includes(name);

/** The first thing still missing, said as the next step; null when the form can be sent. */
export function problem(model: CatalogModel | undefined, form: EditForm | null, state: EditState): string | null {
  if (!model || !form) return tr(M, "model");
  if (!state.source) return tr(M, "video");
  if (form.fields.requires?.includes("prompt") && !state.prompt.trim()) return tr(M, "prompt");
  return null;
}

/** Seconds the price follows: the source's length where the route bills by it, else the chosen length. */
export function billedSeconds(form: EditForm | null, state: EditState): number | null {
  if (!form) return null;
  if (form.source.billedLength) return state.sourceSec ? Math.ceil(state.sourceSec) : null;
  return takes(form, "durationSec") ? state.durationSec ?? null : null;
}

/** Exactly what the route declares for the tool: the source video and the fields it takes. Nothing else is sent. */
export function toBody(model: CatalogModel, form: EditForm, state: EditState, provider: string): MediaSubmitBody {
  const prompt = state.prompt.trim();
  return {
    model: model.id, provider, task: state.tool,
    inputs: state.source ? [{ role: "source-video", inputId: state.source.upload.inputId }] : [],
    ...(takes(form, "prompt") && prompt ? { prompt } : {}),
    ...(takes(form, "durationSec") && state.durationSec !== undefined ? { durationSec: state.durationSec } : {}),
    ...(takes(form, "resolution") && state.resolution ? { resolution: state.resolution } : {}),
    ...(takes(form, "aspectRatio") && state.aspectRatio ? { aspectRatio: state.aspectRatio } : {}),
    ...(takes(form, "audio") ? { audio: state.audio } : {}),
    clientRequestId: crypto.randomUUID(),
  };
}
