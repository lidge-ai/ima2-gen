import { realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { inputError, WorkflowError } from "./errors.js";
import type {
  ColorsField, EnumField, IntegerField, MediaField, ModelSlot, PlanEnv, PlanNote, ResolvedSlot, ShotsField, TextField, WorkflowCombo,
  WorkflowDefinition, WorkflowField, WorkflowLocalOps, WorkflowMediaRef, WorkflowSelection,
  WorkflowShot, WorkflowValue, WorkflowValues,
} from "./types.js";

export interface ValidateOptions {
  /** Directories a media ref path may live in (the route's upload and generated dirs). */
  allowedRoots: readonly string[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Longest clip an explicit shot list may add up to. */
export const SHOTS_MAX_TOTAL_SEC = 60;

function readText(field: TextField, raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw inputError(field.name, "must be a string");
  const value = raw.trim();
  if (value.length > field.maxLength) throw inputError(field.name, "longer than " + field.maxLength + " characters");
  return value.length > 0 ? value : undefined;
}

function readEnum(field: EnumField, raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return field.default;
  if (typeof raw !== "string" || !field.options.some((o) => o.value === raw)) {
    throw inputError(field.name, "must be one of " + field.options.map((o) => o.value).join(", "));
  }
  return raw;
}

function readInteger(field: IntegerField, raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return field.default;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < field.min || raw > field.max) {
    throw inputError(field.name, "must be an integer from " + field.min + " to " + field.max);
  }
  return raw;
}

function readColors(field: ColorsField, raw: unknown): readonly string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.some((c) => typeof c !== "string" || !HEX.test(c))) {
    throw inputError(field.name, "must be a list of #rrggbb colors");
  }
  if (raw.length < field.min || raw.length > field.max) throw inputError(field.name, "needs " + field.min + "-" + field.max + " colors");
  return (raw as string[]).map((c) => c.toLowerCase());
}

function readShot(field: ShotsField, raw: unknown, n: number): WorkflowShot {
  const where = "shot " + n;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw inputError(field.name, where + " must be { prompt, durationSec }");
  const item = raw as Record<string, unknown>;
  const extra = Object.keys(item).find((k) => k !== "prompt" && k !== "durationSec");
  if (extra) throw inputError(field.name, where + " has an unknown key " + extra);
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
  if (!prompt) throw inputError(field.name, where + " needs a prompt");
  if (prompt.length > field.promptMaxLength) throw inputError(field.name, where + " prompt is longer than " + field.promptMaxLength + " characters");
  const seconds = item.durationSec;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1) throw inputError(field.name, where + " needs a whole number of seconds");
  return { prompt, durationSec: seconds };
}

/** An ordered cut list; an empty list counts as none. Per-model lengths are checked when planning. */
function readShots(field: ShotsField, raw: unknown): readonly WorkflowShot[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw inputError(field.name, "must be a list of { prompt, durationSec }");
  if (raw.length === 0) return undefined;
  if (raw.length < field.min || raw.length > field.max) throw inputError(field.name, "needs " + field.min + "-" + field.max + " shots");
  const shots = raw.map((item, i) => readShot(field, item, i + 1));
  const total = shots.reduce((sum, s) => sum + s.durationSec, 0);
  if (total > SHOTS_MAX_TOTAL_SEC) throw inputError(field.name, "add up to " + total + " s; the most is " + SHOTS_MAX_TOTAL_SEC + " s");
  return shots;
}

/** Windows paths compare case-insensitively; POSIX paths as written. */
const fold = (path: string): string => (process.platform === "win32" ? path.toLowerCase() : path);

function inside(path: string, roots: readonly string[]): boolean {
  const p = fold(path);
  return roots.some((raw) => {
    const root = fold(raw);
    return p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
  });
}

const outside = (field: MediaField) => inputError(field.name, "file is outside the allowed folders");

async function readMediaRef(field: MediaField, raw: unknown, options: ValidateOptions): Promise<WorkflowMediaRef> {
  if (!raw || typeof raw !== "object") throw inputError(field.name, "each item must be an object");
  const item = raw as Record<string, unknown>;
  const mimeType = typeof item.mimeType === "string" ? item.mimeType : "";
  if (!mimeType.startsWith(field.accept + "/")) throw inputError(field.name, "expects " + field.accept + " files");
  if (typeof item.url === "string" && item.path === undefined) {
    if (!/^https:\/\//.test(item.url)) throw inputError(field.name, "URLs must use https");
    return { url: item.url, mimeType };
  }
  if (typeof item.path !== "string" || !isAbsolute(item.path)) throw inputError(field.name, "needs an https url or a stored file");
  // Check the written path first so a path outside the roots gets the same answer whether or not
  // it exists (nothing about other folders leaks), then again after realpath so a link inside a
  // root cannot point out of it.
  const realRoots = await Promise.all(options.allowedRoots.map((r) => realpath(r).catch(() => resolve(r))));
  const roots = [...new Set([...options.allowedRoots.map((r) => resolve(r)), ...realRoots])];
  if (!inside(resolve(item.path), roots)) throw outside(field);
  const real = await realpath(item.path).catch(() => {
    throw inputError(field.name, "file not found");
  });
  if (!inside(real, realRoots)) throw outside(field);
  return { path: real, mimeType };
}

async function readMedia(field: MediaField, raw: unknown, options: ValidateOptions): Promise<readonly WorkflowMediaRef[] | undefined> {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw inputError(field.name, "must be a list");
  if (raw.length > field.max) throw inputError(field.name, "accepts at most " + field.max);
  const refs: WorkflowMediaRef[] = [];
  for (const item of raw) refs.push(await readMediaRef(field, item, options));
  if (refs.length === 0) return undefined;
  if (refs.length < field.min) throw inputError(field.name, "needs at least " + field.min);
  return refs;
}

async function readField(field: WorkflowField, raw: unknown, options: ValidateOptions): Promise<WorkflowValue | undefined> {
  switch (field.type) {
    case "text": return readText(field, raw);
    case "enum": return readEnum(field, raw);
    case "integer": return readInteger(field, raw);
    case "boolean":
      if (raw === undefined || raw === null) return field.default;
      if (typeof raw !== "boolean") throw inputError(field.name, "must be true or false");
      return raw;
    case "colors": return readColors(field, raw);
    case "media": return readMedia(field, raw, options);
    case "shots": return readShots(field, raw);
  }
}

/** Validates raw request values against the definition. Unknown keys are refused. */
export async function validateValues(def: WorkflowDefinition, raw: unknown, options: ValidateOptions): Promise<WorkflowValues> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw inputError("values", "must be an object");
  const input = raw as Record<string, unknown>;
  const known = new Set(def.fields.map((f) => f.name));
  const unknown = Object.keys(input).filter((k) => !known.has(k));
  if (unknown.length > 0) throw inputError(unknown[0] ?? "values", "is not an input of " + def.id);
  const values: Record<string, WorkflowValue> = {};
  const provided = new Set<string>();
  for (const field of def.fields) {
    const sent = input[field.name];
    if (sent !== undefined && sent !== null && sent !== "") provided.add(field.name);
    const value = await readField(field, input[field.name], options);
    if (value === undefined) {
      if (field.required) throw inputError(field.name, "is required");
      continue;
    }
    values[field.name] = value;
  }
  const problem = def.check?.(values, provided) ?? null;
  if (problem) throw new WorkflowError("WORKFLOW_INPUT_INVALID", problem, { status: 400 });
  return values;
}

/** Probes local video/audio refs, records duration, and enforces the field's duration range. */
export async function probeMediaValues(def: WorkflowDefinition, values: WorkflowValues, local: WorkflowLocalOps, signal: AbortSignal): Promise<WorkflowValues> {
  const next: Record<string, WorkflowValue | undefined> = { ...values };
  for (const field of def.fields) {
    if (field.type !== "media" || field.accept === "image") continue;
    const refs = values[field.name] as readonly WorkflowMediaRef[] | undefined;
    if (!refs) continue;
    next[field.name] = await Promise.all(refs.map((ref) => probeRef(field, ref, local, signal)));
  }
  return next;
}

async function probeRef(field: MediaField, ref: WorkflowMediaRef, local: WorkflowLocalOps, signal: AbortSignal): Promise<WorkflowMediaRef> {
  if (!ref.path) {
    if (field.minDurationSec !== undefined || field.maxDurationSec !== undefined) {
      throw inputError(field.name, "must be uploaded so its length can be checked");
    }
    return ref;
  }
  const info = await local.probe(ref.path, signal);
  const tooShort = field.minDurationSec !== undefined && info.durationSec < field.minDurationSec - 0.05;
  const tooLong = field.maxDurationSec !== undefined && info.durationSec > field.maxDurationSec + 0.05;
  if (tooShort || tooLong) {
    throw inputError(field.name, "must be " + (field.minDurationSec ?? 0) + "-" + (field.maxDurationSec ?? "any") + " seconds long");
  }
  return { ...ref, durationSec: info.durationSec, hasAudio: info.hasAudio, width: info.width, height: info.height };
}

/** True when an adapter lists the model and the model supports the slot's task. */
export function slotModelAvailable(slot: Pick<ModelSlot, "task">, model: string, catalog: PlanEnv["catalog"]): boolean {
  return catalog(model)?.tasks.includes(slot.task) === true;
}

function slotCandidates(slot: ModelSlot, tier: unknown): string[] {
  const preferred = (typeof tier === "string" ? slot.tierModels?.[tier] : undefined) ?? slot.defaultModel;
  return [...new Set([preferred, slot.defaultModel, ...slot.alternatives, ...Object.values(slot.tierModels ?? {})])];
}

interface SlotContext {
  env: PlanEnv | undefined;
  notes: PlanNote[];
}

function runnable(slot: ModelSlot, model: string, route: string | undefined, ctx: SlotContext): boolean {
  if (!ctx.env) return true;
  // A slot bound to a route (subscription, local session) is judged by that route alone.
  if (!route && !slotModelAvailable(slot, model, ctx.env.catalog)) return false;
  return ctx.env.canRun ? ctx.env.canRun(model, route) : true;
}

/** Picks a model for a slot the user did not set: the first listed one that can run now on its route. */
function pickDefault(slot: ModelSlot, tier: unknown, routeOf: (model: string) => string | undefined, ctx: SlotContext): string | undefined {
  const candidates = slotCandidates(slot, tier);
  const preferred = candidates[0] ?? slot.defaultModel;
  const hit = candidates.find((m) => runnable(slot, m, routeOf(m), ctx));
  if (hit) {
    if (hit !== preferred) ctx.notes.push({ slot: slot.name, kind: "fallback", message: preferred + " cannot run now; using " + hit });
    return hit;
  }
  const needs = "needs a key or sign-in for one of: " + candidates.join(", ");
  if (slot.optional) {
    ctx.notes.push({ slot: slot.name, kind: "skipped", message: slot.label + " left out; " + needs });
    return undefined;
  }
  ctx.notes.push({ slot: slot.name, kind: "needs-key", message: slot.label + " " + needs });
  return ctx.env ? candidates.find((m) => slotModelAvailable(slot, m, ctx.env!.catalog)) ?? preferred : preferred;
}

function comboOf(def: WorkflowDefinition, selection: WorkflowSelection | undefined): WorkflowCombo | undefined {
  if (!selection?.combo) return undefined;
  const combo = def.combos?.find((c) => c.id === selection.combo);
  if (!combo) throw inputError("selection.combo", selection.combo + " is not a combination of " + def.id);
  return combo;
}

export interface SlotPlan {
  slots: Record<string, ResolvedSlot>;
  notes: PlanNote[];
}

/**
 * Model and route per slot: the user's choice, else the named combination, else the first
 * listed model that can run now (env.canRun). An optional slot with nothing runnable is left
 * out; a required one keeps its model and a note says which key it needs.
 */
export function resolveSlotPlan(def: WorkflowDefinition, selection: WorkflowSelection | undefined, values: WorkflowValues, env?: PlanEnv): SlotPlan {
  const tier = def.tierField ? values[def.tierField] : undefined;
  const combo = comboOf(def, selection);
  const ctx: SlotContext = { env, notes: [] };
  const slots: Record<string, ResolvedSlot> = {};
  for (const slot of def.slots) {
    const pinnedRoute = selection?.routes?.[slot.name] ?? combo?.routes?.[slot.name];
    const routeOf = (model: string): string | undefined => pinnedRoute ?? slot.modelRoutes?.[model] ?? slot.defaultRoute;
    // A tier the user picked (e.g. lite) is a model choice too: keep it rather than fall back to a pricier model.
    const tierModel = typeof tier === "string" ? slot.tierModels?.[tier] : undefined;
    const pinned = selection?.models?.[slot.name] ?? combo?.models[slot.name] ?? tierModel;
    if (pinned === undefined && combo && slot.optional) {
      ctx.notes.push({ slot: slot.name, kind: "skipped", message: slot.label + " is not part of " + combo.label });
      continue;
    }
    if (pinned !== undefined && !slotCandidates(slot, tier).includes(pinned)) {
      throw inputError("selection.models." + slot.name, pinned + " cannot run this step");
    }
    if (pinned !== undefined && !runnable(slot, pinned, routeOf(pinned), ctx)) {
      const on = routeOf(pinned);
      ctx.notes.push({ slot: slot.name, kind: "needs-key", message: pinned + " needs a key or sign-in" + (on ? " on " + on : "") });
    }
    const chosen = pinned ?? pickDefault(slot, tier, routeOf, ctx);
    const route = chosen === undefined ? undefined : routeOf(chosen);
    if (chosen !== undefined) slots[slot.name] = route ? { model: chosen, route } : { model: chosen };
  }
  const extra = Object.keys(selection?.models ?? {}).concat(Object.keys(selection?.routes ?? {}))
    .filter((name) => !def.slots.some((s) => s.name === name));
  if (extra.length > 0) throw inputError("selection", extra[0] + " is not a step of " + def.id);
  return { slots, notes: ctx.notes };
}

/** Slot models only (see resolveSlotPlan). Kept for callers that pass a bare catalog. */
export function resolveSlots(def: WorkflowDefinition, selection: WorkflowSelection | undefined, values: WorkflowValues, catalog?: PlanEnv["catalog"]): Record<string, ResolvedSlot> {
  return resolveSlotPlan(def, selection, values, catalog ? { catalog } : undefined).slots;
}

/** Refuses more reference images than the chosen model takes (when its adapter says). */
export function checkReferenceLimit(env: PlanEnv, model: string, count: number, field: string): void {
  const max = env.catalog(model)?.params.maxReferenceImages;
  if (max !== undefined && count > max) throw inputError(field, model + " takes at most " + max + " reference images");
}

