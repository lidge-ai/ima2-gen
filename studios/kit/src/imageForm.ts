/**
 * Image edit, upscale, vectorize and separate work on images the person gives. A route says per task how
 * many it takes and in which role, whether it takes a mask, and which common fields (params.inputs,
 * params.taskFields). These helpers read that so a UI offers only routes that can run the tool, places each
 * image in a role the route takes, and sends only the fields the route takes.
 */
import { chooseRoute, type RouteChoice } from "./routing.ts";
import type { CatalogModel, CatalogRoute, MediaInputRequirement, MediaTask, MediaTaskFieldName, MediaTaskFields } from "./types.ts";

export const IMAGE_TASKS = ["image-to-image", "image-upscale", "image-vectorize", "image-segment"] as const satisfies readonly MediaTask[];
export type ImageTask = (typeof IMAGE_TASKS)[number];
type ImageRole = "source-image" | "reference-image";

export interface ImageForm {
  fields: MediaTaskFields;
  /** The image roles the route takes, in the order images are placed into them. */
  images: readonly MediaInputRequirement[];
  /** Fewest and most images the task takes in all. */
  min: number;
  max: number;
  /** The mask entry when the route takes one. */
  mask: MediaInputRequirement | null;
  /** Values to offer for an accepted field; empty when the field is not accepted or takes any value. */
  resolutions: readonly string[];
  aspectRatios: readonly string[];
  qualities: readonly string[];
}

const forTask = (task: MediaTask) => (need: MediaInputRequirement) => !need.tasks || need.tasks.includes(task);

/** The form one route declares for an image task, or null when it declares none or serves other tasks only. */
export function imageForm(model: CatalogModel, providerId: string, task: ImageTask): ImageForm | null {
  const route = model.routes.find((r) => r.providerId === providerId);
  if (!route || (route.tasks && !route.tasks.includes(task))) return null;
  const params = model.routeParams?.[providerId];
  const fields = params?.taskFields?.[task];
  const needs = (params?.inputs ?? []).filter(forTask(task));
  // Source first: it is the image being worked on; references are drawn from.
  const images = (["source-image", "reference-image"] as const).flatMap((role) => needs.filter((need) => need.role === role));
  if (!params || !fields || images.length === 0) return null;
  const takes = (name: MediaTaskFieldName) => fields.accepts.includes(name);
  return {
    fields, images,
    min: Math.max(1, images.reduce((sum, need) => sum + need.min, 0)),
    max: images.reduce((sum, need) => sum + need.max, 0),
    mask: needs.find((need) => need.role === "mask") ?? null,
    resolutions: takes("resolution") ? fields.resolutions ?? params.resolutions ?? [] : [],
    aspectRatios: takes("aspectRatio") ? fields.aspectRatios ?? params.aspectRatios ?? [] : [],
    qualities: takes("quality") ? params.qualities ?? [] : [],
  };
}

/** The role of each of count images, in order: each role is filled to its limit before the next. Null when the route cannot take that many. */
export function imageRoles(form: ImageForm, count: number): ImageRole[] | null {
  if (count < form.min || count > form.max) return null;
  const roles: ImageRole[] = [];
  for (const need of form.images) {
    for (let i = 0; i < need.max && roles.length < count; i += 1) roles.push(need.role as ImageRole);
  }
  return roles;
}

export function imageRoutes(model: CatalogModel, task: ImageTask): CatalogRoute[] {
  return model.routes.filter((route) => imageForm(model, route.providerId, task) !== null);
}

/** chooseRoute, limited to the routes that declare a form for the image task. */
export function chooseImageRoute(model: CatalogModel, task: ImageTask, chosenProviderId?: string): RouteChoice {
  return chooseRoute({ ...model, routes: imageRoutes(model, task) }, chosenProviderId);
}
