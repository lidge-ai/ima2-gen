import { chooseRoute } from "../routing.ts";
import type { Catalog } from "../types.ts";
import { routeParamsFor } from "./catalog.ts";
import type { WireWorkflow } from "../wire.ts";

/**
 * director-studio's cut list, answered the way the server does (lib/workflows/validate.ts readShots,
 * definitions/directorShots.ts fitShots, directorStudio.ts check), with the same sentences.
 */
export interface FakeShot {
  prompt: string;
  durationSec: number;
}
export interface CutProblem {
  field?: string;
  message: string;
}
const MAX_TOTAL_SEC = 60;
const MIN_SHOT_SEC = 4;
const KNOWN_MAX_SHOT_SEC: Readonly<Record<string, number>> = { "bytedance/seedance-2.5": 30, "bytedance/seedance-2.5-flash": 30 };
const bad = (field: string, message: string): CutProblem => ({ field, message: field + ": " + message });

function readShots(field: Extract<WireWorkflow["fields"][number], { type: "shots" }>, raw: unknown): FakeShot[] | CutProblem | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return bad(field.name, "must be a list of { prompt, durationSec }");
  if (raw.length === 0) return null;
  if (raw.length < field.min || raw.length > field.max) return bad(field.name, "needs " + field.min + "-" + field.max + " shots");
  const shots: FakeShot[] = [];
  for (const [i, item] of raw.entries()) {
    const where = "shot " + (i + 1);
    const shot = (item ?? {}) as { prompt?: unknown; durationSec?: unknown };
    const prompt = typeof shot.prompt === "string" ? shot.prompt.trim() : "";
    if (!prompt) return bad(field.name, where + " needs a prompt");
    if (prompt.length > field.promptMaxLength) return bad(field.name, where + " prompt is longer than " + field.promptMaxLength + " characters");
    const seconds = shot.durationSec;
    if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1) return bad(field.name, where + " needs a whole number of seconds");
    shots.push({ prompt, durationSec: seconds });
  }
  const total = shots.reduce((sum, s) => sum + s.durationSec, 0);
  if (total > MAX_TOTAL_SEC) return bad(field.name, "add up to " + total + " s; the most is " + MAX_TOTAL_SEC + " s");
  return shots;
}

/** Each shot's length as the model will make it, or why the cut list is refused; null when no cut list was sent. */
export function planCuts(def: WireWorkflow, values: Record<string, unknown>, catalog: Catalog, model: string): number[] | CutProblem | null {
  const field = def.fields.find((f) => f.type === "shots");
  if (!field || field.type !== "shots") return null;
  const shots = readShots(field, values[field.name]);
  const scene = typeof values.prompt === "string" && values.prompt.trim() !== "";
  if (shots === null) return scene ? null : bad("prompt", "is required");
  if (!Array.isArray(shots)) return shots;
  if (values.duration !== undefined && values.duration !== null && values.duration !== "") {
    return { message: "duration: leave it out when shots are given; the shots set the length" };
  }
  // Like the server, the lengths are those of the route the model runs on when none is chosen.
  const spec = catalog.models.find((m) => m.id === model);
  const choice = spec ? chooseRoute(spec) : undefined;
  const params = spec && choice && choice.kind !== "unavailable" ? routeParamsFor(spec, choice.route.providerId) : spec?.params;
  const listed = [...(params?.durationsSec ?? [])].sort((a, b) => a - b);
  const [min, max] = listed.length ? [listed[0]!, listed[listed.length - 1]!] : [MIN_SHOT_SEC, KNOWN_MAX_SHOT_SEC[model] ?? 15];
  const fitted: number[] = [];
  for (const [i, shot] of shots.entries()) {
    if (shot.durationSec < min || shot.durationSec > max) {
      return bad(field.name, "shot " + (i + 1) + " is " + shot.durationSec + " s; " + model + " makes " + min + "-" + max + " s per shot");
    }
    fitted.push(listed.find((d) => d >= shot.durationSec) ?? shot.durationSec);
  }
  const total = fitted.reduce((a, b) => a + b, 0);
  if (total > MAX_TOTAL_SEC) return bad(field.name, "add up to " + total + " s after rounding to " + model + "'s listed lengths; the most is " + MAX_TOTAL_SEC + " s");
  return fitted;
}
