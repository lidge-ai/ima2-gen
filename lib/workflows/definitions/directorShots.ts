import { readFile } from "node:fs/promises";
import type { MediaModelSpec } from "../../providers/media/contract.js";
import { inputError, WorkflowError } from "../errors.js";
import type { StepRuntime, TextStep, WorkflowShot } from "../types.js";
import { SHOTS_MAX_TOTAL_SEC } from "../validate.js";

/**
 * Longest single call per model when the catalog spec does not say. From maker docs read 2026-11-26:
 * Seedance 2.5 "up to 30 seconds per generation" (seed.bytedance.com), Seedance 2.0 family 15 s,
 * Gemini Omni 1.2 Flash new clips 3-15 s (ai.google.dev omni guide).
 */
export const KNOWN_MAX_SHOT_SEC: Readonly<Record<string, number>> = {
  "bytedance/seedance-2.5": 30,
  "bytedance/seedance-2.5-flash": 30,
  "bytedance/seedance-2": 15,
  "bytedance/seedance-2-fast": 15,
  "bytedance/seedance-2-mini": 15,
  "google/gemini-omni-flash-1.2": 15,
};

export function maxShotSeconds(model: string, spec: MediaModelSpec | undefined): number {
  const listed = spec?.params.durationsSec;
  if (listed && listed.length > 0) return Math.max(...listed);
  const known = KNOWN_MAX_SHOT_SEC[model];
  if (known === undefined) {
    throw new WorkflowError("WORKFLOW_MODEL_UNAVAILABLE", model + " has no known clip length; its adapter must list durationsSec", { status: 400 });
  }
  return known;
}

/** Nearest allowed length at or above target, else the longest allowed. Free choice when nothing is listed. */
export function fitDuration(target: number, spec: MediaModelSpec | undefined): number {
  const listed = [...(spec?.params.durationsSec ?? [])].sort((a, b) => a - b);
  if (listed.length === 0) return target;
  return listed.find((d) => d >= target) ?? listed[listed.length - 1] ?? target;
}

/** Shortest shot when the model lists no lengths: the studio's own minimum clip length. */
export const MIN_SHOT_SEC = 4;

/** One call's [shortest, longest] length: the listed lengths, else MIN_SHOT_SEC up to the known maximum. */
export function shotBounds(model: string, spec: MediaModelSpec | undefined): [number, number] {
  const listed = spec?.params.durationsSec;
  if (listed && listed.length > 0) return [Math.min(...listed), Math.max(...listed)];
  return [MIN_SHOT_SEC, maxShotSeconds(model, spec)];
}

/**
 * Lengths for an explicit cut list: each shot must fall inside one call's range (the error names the shot),
 * then rounds up to the nearest listed length. The fitted total must still be at most SHOTS_MAX_TOTAL_SEC.
 */
export function fitShots(shots: readonly WorkflowShot[], model: string, spec: MediaModelSpec | undefined): number[] {
  const [min, max] = shotBounds(model, spec);
  const fitted = shots.map((shot, i) => {
    if (shot.durationSec < min || shot.durationSec > max) {
      throw inputError("shots", "shot " + (i + 1) + " is " + shot.durationSec + " s; " + model + " makes " + min + "-" + max + " s per shot");
    }
    return fitDuration(shot.durationSec, spec);
  });
  const total = fitted.reduce((a, b) => a + b, 0);
  if (total > SHOTS_MAX_TOTAL_SEC) {
    throw inputError("shots", "add up to " + total + " s after rounding to " + model + "'s listed lengths; the most is " + SHOTS_MAX_TOTAL_SEC + " s");
  }
  return fitted;
}

/** Splits a total length into the fewest shots that each fit one call, as evenly as possible. */
export function splitDuration(total: number, maxShot: number): number[] {
  const count = Math.ceil(total / maxShot);
  const base = Math.floor(total / count);
  const extra = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

const PLANNER_SYSTEM = [
  "You are a film director's assistant. Split one scene description into consecutive shots of a single continuous clip.",
  "Return JSON only: {\"shots\":[{\"prompt\":string}]} with exactly the requested number of shots, in order.",
  "Each prompt is self-contained: restate who is on screen, where, the action, the camera move and the light, so a video model can render it alone.",
  "Keep characters, wardrobe, location and look consistent across shots. Keep reference names such as image 1 or video 1 exactly as written.",
].join(" ");

export function readShotPlan(raw: unknown, count: number): string[] {
  const shots = (raw as { shots?: unknown } | null)?.shots;
  const prompts = Array.isArray(shots) ? shots.map((s) => (s as { prompt?: unknown })?.prompt) : [];
  if (prompts.length !== count || prompts.some((p) => typeof p !== "string" || p.trim() === "")) {
    throw new WorkflowError("WORKFLOW_PLANNER_INVALID", "the shot planner returned " + prompts.length + " usable shots, expected " + count, { status: 502, retryable: true });
  }
  return prompts as string[];
}

export function planShotsStep(prompt: string, durations: readonly number[]): TextStep {
  return {
    id: "plan-shots", label: "Plan the shots", kind: "text", dependsOn: [],
    async run(rt: StepRuntime) {
      if (!rt.gateway.planText) {
        throw new WorkflowError("WORKFLOW_PLANNER_UNAVAILABLE", "clips longer than one model call need a text planner; none is configured", { status: 503 });
      }
      const user = "Scene: " + prompt + "\nShots: " + durations.length + " with lengths in seconds " + durations.join(", ") + ".";
      const raw = await rt.gateway.planText({ purpose: "director-shots", system: PLANNER_SYSTEM, user }, rt.signal);
      const prompts = readShotPlan(raw, durations.length);
      const json = JSON.stringify({ shots: prompts.map((p, i) => ({ prompt: p, durationSec: durations[i] })) });
      return [{ kind: "json", mimeType: "application/json", bytes: new TextEncoder().encode(json) }];
    },
  };
}

export async function shotPrompt(rt: StepRuntime, index: number): Promise<string> {
  const plan = rt.artifactsOf("plan-shots")[0];
  if (!plan) throw new WorkflowError("WORKFLOW_INTERNAL", "shot plan missing", { status: 500 });
  const parsed = JSON.parse(await readFile(plan.path, "utf8")) as { shots: { prompt: string }[] };
  const shot = parsed.shots[index];
  if (!shot) throw new WorkflowError("WORKFLOW_INTERNAL", "shot " + (index + 1) + " missing from plan", { status: 500 });
  return shot.prompt;
}

