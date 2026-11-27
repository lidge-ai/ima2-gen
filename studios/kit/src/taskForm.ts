/**
 * Lip-sync, avatar, dubbing and subtitle jobs take media inputs instead of a prompt. Each route says
 * which ones in its catalog params (inputs, options); these helpers read that declaration so a UI can
 * draw the form, pick a route that has one, and price the job from the length of what was uploaded.
 */
import { chooseRoute, type RouteChoice } from "./routing.ts";
import type { CatalogModel, CatalogRoute, MediaInputRequirement, MediaInputRole, MediaOptionSpec, MediaTask } from "./types.ts";

export const TALKING_TASKS = ["lipsync", "avatar", "dubbing", "subtitles"] as const satisfies readonly MediaTask[];
export type TalkingTask = (typeof TALKING_TASKS)[number];

export interface TaskForm {
  inputs: readonly MediaInputRequirement[];
  options: readonly MediaOptionSpec[];
  resolutions: readonly string[];
}

const forTask = (task: MediaTask) => (entry: { tasks?: readonly MediaTask[] }) => !entry.tasks || entry.tasks.includes(task);

/** The form one route declares for a task, or null when it declares none (the route cannot be offered). */
export function taskForm(model: CatalogModel, providerId: string, task: MediaTask): TaskForm | null {
  if (!model.tasks.includes(task)) return null;
  const params = model.routeParams?.[providerId];
  const inputs = (params?.inputs ?? []).filter(forTask(task));
  if (inputs.length === 0) return null;
  return { inputs, options: (params?.options ?? []).filter(forTask(task)), resolutions: params?.resolutions ?? [] };
}

export function formRoutes(model: CatalogModel, task: MediaTask): CatalogRoute[] {
  return model.routes.filter((route) => taskForm(model, route.providerId, task) !== null);
}

/** chooseRoute, limited to the routes that declare a form for the task. */
export function chooseFormRoute(model: CatalogModel, task: MediaTask, chosenProviderId?: string): RouteChoice {
  return chooseRoute({ ...model, routes: formRoutes(model, task) }, chosenProviderId);
}

/**
 * Seconds the job is billed for: the longest input the form marks as billed. Null while any of them
 * is missing or its length is unknown, so a price is never shown from a guess.
 */
export function billedSeconds(form: TaskForm, lengths: Readonly<Partial<Record<MediaInputRole, number | null>>>): number | null {
  const billed = form.inputs.filter((need) => need.billedLength && (need.min > 0 || lengths[need.role] !== undefined));
  if (billed.length === 0) return null;
  const seconds = billed.map((need) => lengths[need.role] ?? null);
  if (seconds.some((value) => value === null || !(value > 0))) return null;
  return Math.max(...(seconds as number[]));
}
