import {
  IMAGE_TASKS, chooseImageRoute, imageForm, imageRoles, imageRoutes,
  type Catalog, type CatalogModel, type ImageForm, type ImageTask, type MediaSubmitBody, type MediaTaskFieldName, type RouteChoice,
} from "@ima2/studio-kit";
import { messages, tr } from "../../i18n.ts";
import type { SlotValue } from "../../ui/UploadSlot.tsx";

const M = messages(
  { model: "Choose a model.", image: "Add an image.", fewer: "This model takes {max} here. Remove {extra}.", prompt: "Write what to do." },
  { model: "모델을 골라 주세요.", image: "이미지를 추가해 주세요.", fewer: "이 모델은 여기서 {max}장까지 받아요. {extra}장을 삭제해 주세요.", prompt: "무엇을 할지 적어 주세요." },
);

/** The image screen's tools: "create" is the prompt form; the others work on images the person adds. */
export type ImageTool = "create" | ImageTask;
export const TOOL_MODE: Readonly<Record<ImageTask, string>> = {
  "image-to-image": "edit", "image-upscale": "upscale", "image-vectorize": "vectorize", "image-segment": "separate",
};
export const toolOfMode = (mode: string | undefined): ImageTask | undefined => IMAGE_TASKS.find((task) => TOOL_MODE[task] === mode);

export interface ToolState {
  tool: ImageTask;
  model: string | undefined;
  provider: string;
  prompt: string;
  images: readonly SlotValue[];
  /** The painted area of the first image, uploaded as a repaint-white mask. It belongs to that image. */
  mask: SlotValue | null;
  resolution: string | undefined;
  aspectRatio: string | undefined;
  quality: string | undefined;
  count: number;
}

export function emptyState(tool: ImageTask): ToolState {
  return { tool, model: undefined, provider: "", prompt: "", images: [], mask: null, resolution: undefined, aspectRatio: undefined, quality: undefined, count: 1 };
}

export function modelsFor(catalog: Catalog, tool: ImageTask): CatalogModel[] {
  return catalog.models.filter((model) => model.kind === "image" && imageRoutes(model, tool).length > 0);
}

/** Tools this catalog can run: tasks with at least one route that declares a form. */
export function availableTools(catalog: Catalog): ImageTask[] {
  return IMAGE_TASKS.filter((tool) => modelsFor(catalog, tool).length > 0);
}

/** A model whose form route has a key first, so the default can run. */
export function defaultModel(catalog: Catalog, tool: ImageTask, requested?: string): CatalogModel | undefined {
  const models = modelsFor(catalog, tool);
  return models.find((m) => m.id === requested) ?? models.find((m) => imageRoutes(m, tool).some((r) => r.keyConfigured)) ?? models[0];
}

export interface Resolved {
  choice: RouteChoice;
  /** The form of the route that would run, or of the route that needs a key. */
  form: ImageForm | null;
}

export function resolve(model: CatalogModel | undefined, state: ToolState): Resolved {
  if (!model) return { choice: { kind: "unavailable" }, form: null };
  const choice = chooseImageRoute(model, state.tool, state.provider || undefined);
  const route = choice.kind === "unavailable" ? undefined : choice.route;
  return { choice, form: route ? imageForm(model, route.providerId, state.tool) : null };
}

const keep = <T>(list: readonly T[], value: T | undefined): T | undefined => (value !== undefined && list.includes(value) ? value : list[0]);

/** Settings that the route in use lists, keeping a value it still offers. */
export function withForm(state: ToolState, form: ImageForm | null): ToolState {
  return {
    ...state,
    resolution: form ? keep(form.resolutions, state.resolution) : undefined,
    aspectRatio: form ? keep(form.aspectRatios, state.aspectRatio) : undefined,
    quality: form ? keep(form.qualities, state.quality) : undefined,
  };
}

export const takes = (form: ImageForm, name: MediaTaskFieldName) => form.fields.accepts.includes(name);

/** The route converts a painted mask (white = repaint) to the provider's own rule; only then is the brush offered. */
export const brushable = (form: ImageForm | null): boolean => !!form?.mask?.conventions?.includes("repaint-white");

/** The mask that would be sent: a painted area, on a route that takes one, with its image still first in the tray. */
export function sentMask(form: ImageForm | null, state: ToolState): SlotValue | null {
  return brushable(form) && state.images.length > 0 ? state.mask : null;
}

/** The first thing still missing, said as the next step; null when the form can be sent. */
export function problem(model: CatalogModel | undefined, form: ImageForm | null, state: ToolState): string | null {
  if (!model || !form) return tr(M, "model");
  if (state.images.length < form.min) return tr(M, "image");
  if (state.images.length > form.max) return tr(M, "fewer", { max: form.max, extra: state.images.length - form.max });
  if (form.fields.requires?.includes("prompt") && !state.prompt.trim()) return tr(M, "prompt");
  return null;
}

/** Exactly what the route declares for the tool: its images in the roles it takes, and the fields it takes. Nothing else is sent. */
export function toBody(model: CatalogModel, form: ImageForm, state: ToolState, provider: string): MediaSubmitBody {
  const prompt = state.prompt.trim();
  // While there are too few or too many images the request cannot run; the estimate still reads the rest of it.
  const roles = imageRoles(form, state.images.length) ?? [];
  const mask = sentMask(form, state);
  return {
    model: model.id, provider, task: state.tool,
    inputs: [
      ...roles.map((role, i) => ({ role, inputId: state.images[i]!.upload.inputId })),
      ...(mask ? [{ role: "mask" as const, inputId: mask.upload.inputId }] : []),
    ],
    ...(mask ? { maskConvention: "repaint-white" as const } : {}),
    ...(takes(form, "prompt") && prompt ? { prompt } : {}),
    ...(takes(form, "resolution") && state.resolution ? { resolution: state.resolution } : {}),
    // A masked edit keeps the image's shape, so no ratio goes with it.
    ...(takes(form, "aspectRatio") && state.aspectRatio && !mask ? { aspectRatio: state.aspectRatio } : {}),
    ...(takes(form, "quality") && state.quality ? { quality: state.quality } : {}),
    ...(takes(form, "count") ? { count: state.count } : {}),
    clientRequestId: crypto.randomUUID(),
  };
}
