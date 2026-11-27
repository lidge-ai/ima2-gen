/**
 * Edit, extend and upscale rework one source video. A route says per task which common fields it takes
 * (params.taskFields) and declares the source video among its inputs; these helpers read that so a UI
 * offers only routes that can run the tool and sends only the fields the route takes.
 */
import { chooseRoute, type RouteChoice } from "./routing.ts";
import type { CatalogModel, CatalogRoute, MediaInputRequirement, MediaTask, MediaTaskFieldName, MediaTaskFields } from "./types.ts";

export const EDIT_TASKS = ["video-to-video", "video-extend", "video-upscale"] as const satisfies readonly MediaTask[];
export type EditTask = (typeof EDIT_TASKS)[number];

export interface EditForm {
  fields: MediaTaskFields;
  source: MediaInputRequirement;
  /** Values to offer for an accepted field; empty when the field is not accepted or takes any value. */
  durationsSec: readonly number[];
  resolutions: readonly string[];
  aspectRatios: readonly string[];
}

/** The form one route declares for an edit task, or null when it declares none or serves other tasks only. */
export function editForm(model: CatalogModel, providerId: string, task: EditTask): EditForm | null {
  const route = model.routes.find((r) => r.providerId === providerId);
  if (!route || (route.tasks && !route.tasks.includes(task))) return null;
  const params = model.routeParams?.[providerId];
  const fields = params?.taskFields?.[task];
  const source = params?.inputs?.find((need) => need.role === "source-video" && (!need.tasks || need.tasks.includes(task)));
  if (!params || !fields || !source) return null;
  const takes = (name: MediaTaskFieldName) => fields.accepts.includes(name);
  const form: EditForm = {
    fields, source,
    durationsSec: takes("durationSec") ? fields.durationsSec ?? params.durationsSec ?? [] : [],
    resolutions: takes("resolution") ? fields.resolutions ?? params.resolutions ?? [] : [],
    aspectRatios: takes("aspectRatio") ? fields.aspectRatios ?? params.aspectRatios ?? [] : [],
  };
  // A required choice with nothing listed to choose from cannot be filled by a form.
  const lists: Partial<Record<MediaTaskFieldName, readonly unknown[]>> = { durationSec: form.durationsSec, resolution: form.resolutions, aspectRatio: form.aspectRatios };
  return (fields.requires ?? []).some((name) => lists[name]?.length === 0) ? null : form;
}

export function editRoutes(model: CatalogModel, task: EditTask): CatalogRoute[] {
  return model.routes.filter((route) => editForm(model, route.providerId, task) !== null);
}

/** chooseRoute, limited to the routes that declare a form for the edit task. */
export function chooseEditRoute(model: CatalogModel, task: EditTask, chosenProviderId?: string): RouteChoice {
  return chooseRoute({ ...model, routes: editRoutes(model, task) }, chosenProviderId);
}
