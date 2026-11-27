import type { MediaModel, MediaRoute } from "./mediaCatalog";
import type { MediaInputRole } from "./mediaSubmitBody";

/**
 * Tasks the classic composer can feed: a prompt plus the reference tray's images. Sound from text needs
 * only the prompt. Tasks that need a video or audio input have no slot here and stay out of the picker's runnable set.
 */
export type ClassicTask = "text-to-image" | "image-to-image" | "text-to-video" | "image-to-video" | "reference-to-video" | "text-to-audio";
export type ClassicKind = "image" | "video" | "audio";

export const CLASSIC_TASKS: Record<ClassicKind, readonly ClassicTask[]> = {
  image: ["text-to-image", "image-to-image"],
  video: ["text-to-video", "image-to-video", "reference-to-video"],
  audio: ["text-to-audio"],
};
const ALL_CLASSIC: readonly string[] = [...CLASSIC_TASKS.image, ...CLASSIC_TASKS.video, ...CLASSIC_TASKS.audio];
/** Input roles the reference tray can fill. */
const TRAY_ROLES: readonly string[] = ["first-frame", "source-image", "reference-image"];

export function isClassicTask(task: string): task is ClassicTask {
  return ALL_CLASSIC.includes(task);
}

export function taskKind(task: ClassicTask): ClassicKind {
  return CLASSIC_TASKS.image.includes(task) ? "image" : CLASSIC_TASKS.audio.includes(task) ? "audio" : "video";
}

/** The task the composer is already set up for: no image means text, one image is a start frame, more are references. */
export function inferTask(kind: ClassicKind, referenceCount: number): ClassicTask {
  if (kind === "audio") return "text-to-audio";
  if (kind === "image") return referenceCount > 0 ? "image-to-image" : "text-to-image";
  if (referenceCount === 0) return "text-to-video";
  return referenceCount === 1 ? "image-to-video" : "reference-to-video";
}

export interface InputLimits { min: number; max: number }

/** How many tray images a task takes on this route; null when the route does not say how many it accepts. */
export function inputLimits(task: string, route: Pick<MediaRoute, "params">): InputLimits | null {
  const references = route.params.maxReferenceImages ?? 0;
  // A route that says the task needs a video or an audio clip cannot be fed from the tray.
  const declared = (route.params.inputs ?? []).filter((entry) => (!entry.tasks || entry.tasks.includes(task)) && entry.min > 0);
  if (declared.some((entry) => !TRAY_ROLES.includes(entry.role))) return null;
  if (task === "text-to-image" || task === "text-to-video" || task === "text-to-audio") return { min: 0, max: 0 };
  if (task === "image-to-video") return { min: 1, max: 1 };
  // The first image is the one being edited; a route that lists reference images takes more beside it.
  if (task === "image-to-image") return { min: 1, max: Math.max(1, references) };
  if (task === "reference-to-video") return references > 0 ? { min: 1, max: references } : null;
  return null;
}

export function routeTasks(route: Pick<MediaRoute, "tasks" | "params">): ClassicTask[] {
  return ALL_CLASSIC.filter((task): task is ClassicTask => route.tasks.includes(task) && inputLimits(task, route) !== null);
}

export function modelTasks(model: Pick<MediaModel, "routes">): ClassicTask[] {
  const seen = new Set(model.routes.flatMap(routeTasks));
  return ALL_CLASSIC.filter((task): task is ClassicTask => seen.has(task as ClassicTask));
}

export type InputProblem =
  | { code: "needsImages"; min: number; max: number; have: number }
  | { code: "tooManyImages"; min: number; max: number; have: number }
  | { code: "noImages"; min: number; max: number; have: number }
  | { code: "unsupported"; min: 0; max: 0; have: number };

/** Why the tray does not fit the task, or null when it does. */
export function inputProblem(task: string, route: Pick<MediaRoute, "params">, have: number): InputProblem | null {
  const limits = inputLimits(task, route);
  if (!limits) return { code: "unsupported", min: 0, max: 0, have };
  if (have < limits.min) return { code: "needsImages", ...limits, have };
  if (have > limits.max) return { code: limits.max === 0 ? "noImages" : "tooManyImages", ...limits, have };
  return null;
}

/** The role each tray image plays, in tray order. */
export function inputRoles(task: string, count: number): MediaInputRole[] {
  if (task === "image-to-video") return Array.from({ length: count }, () => "first-frame" as const);
  if (task === "reference-to-video") return Array.from({ length: count }, () => "reference-image" as const);
  if (task === "image-to-image") return Array.from({ length: count }, (_, index) => (index === 0 ? "source-image" : "reference-image"));
  return [];
}
