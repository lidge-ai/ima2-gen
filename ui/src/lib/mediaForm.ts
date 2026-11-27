import { resolutionChoices, type MediaOptionSpec, type MediaParams, type MediaRoute } from "./mediaCatalog";

/**
 * What a route takes for one task, read from the catalog: the route's lists narrowed by its taskFields
 * declaration, the free length when it applies to the task, and the options the task takes. A setting
 * that is not in the answer is not shown and not sent, because the adapter refuses fields it did not list.
 */
export function taskParams(route: Pick<MediaRoute, "params">, task: string): MediaParams {
  const params = route.params;
  const fields = params.taskFields?.[task];
  const forTask = <T extends { tasks?: readonly string[] }>(entry: T) => !entry.tasks || entry.tasks.includes(task);
  const out: MediaParams = { ...params };
  delete out.taskFields;
  if (fields) {
    const accepts = (name: string) => fields.accepts.includes(name);
    const list = <T>(name: string, own: readonly T[] | undefined, base: readonly T[] | undefined) => (accepts(name) ? own ?? base : undefined);
    const durationsSec = list("durationSec", fields.durationsSec, params.durationsSec);
    const resolutions = list("resolution", fields.resolutions, params.resolutions);
    const aspectRatios = list("aspectRatio", fields.aspectRatios, params.aspectRatios);
    if (durationsSec) out.durationsSec = durationsSec; else delete out.durationsSec;
    if (resolutions) out.resolutions = resolutions; else delete out.resolutions;
    if (aspectRatios) out.aspectRatios = aspectRatios; else delete out.aspectRatios;
    if (!accepts("durationSec")) delete out.durationRange;
    if (!accepts("audio")) delete out.nativeAudio;
    if (!accepts("seed")) delete out.seed;
    if (!accepts("negativePrompt")) delete out.negativePrompt;
  }
  if (out.durationRange && !forTask(out.durationRange)) delete out.durationRange;
  if (params.options) out.options = params.options.filter(forTask);
  if (params.inputs) out.inputs = params.inputs.filter(forTask);
  return out;
}

/** The sizes the task can use on this route, with the catalog's label for each. */
export function sizeChoices(route: Pick<MediaRoute, "params" | "resolutionOptions">, params: MediaParams): { value: string; label: string }[] {
  const labels = new Map(resolutionChoices(route).map((option) => [option.value, option.label]));
  return (params.resolutions ?? []).map((value) => ({ value, label: labels.get(value) ?? value }));
}

export interface LengthRange { minSec: number; maxSec: number; required: boolean }

/** The free length the task accepts, when the route declares one instead of a list. */
export function lengthRange(params: MediaParams): LengthRange | null {
  const range = params.durationRange;
  return range ? { minSec: range.minSec, maxSec: range.maxSec, required: range.required === true } : null;
}

/** A required length starts at ten seconds (or the nearest the route allows); an optional one starts empty, and the model decides. */
export function startLength(range: LengthRange): number | undefined {
  return range.required ? Math.min(range.maxSec, Math.max(range.minSec, 10)) : undefined;
}

export function voiceOption(params: MediaParams): MediaOptionSpec | undefined {
  return params.options?.find((option) => option.type === "voice");
}

/** speech: a voice reads the prompt. sound: music or effects made from a description. */
export type AudioUse = "speech" | "sound";
export const AUDIO_USES: readonly AudioUse[] = ["speech", "sound"];

export function audioUse(route: Pick<MediaRoute, "params">, task = "text-to-audio"): AudioUse {
  return voiceOption(taskParams(route, task)) ? "speech" : "sound";
}

export type FormProblem =
  | { code: "voice" }
  | { code: "lengthRequired"; min: number; max: number }
  | { code: "lengthRange"; min: number; max: number }
  | { code: "option"; name: string };

export interface FormValues { task: string; durationSec?: number; options?: Readonly<Record<string, string | boolean>> }

/** The first declared setting the request still lacks, or null when the form can be sent. */
export function formProblem(route: Pick<MediaRoute, "params">, values: FormValues): FormProblem | null {
  const params = taskParams(route, values.task);
  for (const option of params.options ?? []) {
    if (!option.required || option.type === "boolean") continue;
    const value = values.options?.[option.name];
    if (typeof value !== "string" || !value.trim()) return option.type === "voice" ? { code: "voice" } : { code: "option", name: option.name };
  }
  const range = lengthRange(params);
  if (!range) return null;
  const limits = { min: range.minSec, max: range.maxSec };
  if (values.durationSec === undefined) return range.required ? { code: "lengthRequired", ...limits } : null;
  return values.durationSec >= range.minSec && values.durationSec <= range.maxSec ? null : { code: "lengthRange", ...limits };
}

/** A typed length in seconds: digits with up to three decimals ("12", "0.5", "1."), or undefined for anything else. */
export function parseLength(text: string): number | undefined {
  const trimmed = text.trim();
  return /^\d{1,4}(\.\d{0,3})?$/.test(trimmed) ? Number(trimmed) : undefined;
}
