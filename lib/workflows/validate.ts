import { realpath } from "node:fs/promises";
import { isAbsolute, sep } from "node:path";
import { inputError, WorkflowError } from "./errors.js";
import type {
  ColorsField, EnumField, IntegerField, MediaField, ModelSlot, PlanEnv, ResolvedSlot, TextField,
  WorkflowDefinition, WorkflowField, WorkflowLocalOps, WorkflowMediaRef, WorkflowSelection,
  WorkflowValue, WorkflowValues,
} from "./types.js";

export interface ValidateOptions {
  /** Directories a media ref path may live in (the route's upload and generated dirs). */
  allowedRoots: readonly string[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

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

function inside(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep));
}

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
  const real = await realpath(item.path).catch(() => {
    throw inputError(field.name, "file not found");
  });
  const roots = await Promise.all(options.allowedRoots.map((r) => realpath(r).catch(() => r)));
  if (!inside(real, roots)) throw inputError(field.name, "file is outside the allowed folders");
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
  for (const field of def.fields) {
    const value = await readField(field, input[field.name], options);
    if (value === undefined) {
      if (field.required) throw inputError(field.name, "is required");
      continue;
    }
    values[field.name] = value;
  }
  const problem = def.check?.(values) ?? null;
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
export function slotModelAvailable(slot: ModelSlot, model: string, catalog: PlanEnv["catalog"]): boolean {
  return catalog(model)?.tasks.includes(slot.task) === true;
}

function defaultFor(slot: ModelSlot, tier: unknown, catalog: PlanEnv["catalog"] | undefined): string {
  const preferred = (typeof tier === "string" ? slot.tierModels?.[tier] : undefined) ?? slot.defaultModel;
  // A slot bound to a route (e.g. a subscription) keeps its model; another model would not fit that route.
  if (!catalog || slot.defaultRoute || slotModelAvailable(slot, preferred, catalog)) return preferred;
  return [...slot.alternatives, ...Object.values(slot.tierModels ?? {})].find((m) => slotModelAvailable(slot, m, catalog)) ?? preferred;
}

/**
 * Applies the user's model and route choices; a model outside the slot's list is refused.
 * Without a choice the slot default is used, or, when no adapter offers it yet, the first
 * listed alternative that one does (the plan and estimate name the model either way).
 */
export function resolveSlots(def: WorkflowDefinition, selection: WorkflowSelection | undefined, values: WorkflowValues, catalog?: PlanEnv["catalog"]): Record<string, ResolvedSlot> {
  const tier = def.tierField ? values[def.tierField] : undefined;
  const resolved: Record<string, ResolvedSlot> = {};
  for (const slot of def.slots) {
    const chosen = selection?.models?.[slot.name] ?? defaultFor(slot, tier, catalog);
    const allowed = [slot.defaultModel, ...slot.alternatives, ...Object.values(slot.tierModels ?? {})];
    if (!allowed.includes(chosen)) throw inputError("selection.models." + slot.name, chosen + " cannot run this step");
    const route = selection?.routes?.[slot.name] ?? slot.defaultRoute;
    resolved[slot.name] = route ? { model: chosen, route } : { model: chosen };
  }
  const extra = Object.keys(selection?.models ?? {}).concat(Object.keys(selection?.routes ?? {}))
    .filter((name) => !def.slots.some((s) => s.name === name));
  if (extra.length > 0) throw inputError("selection", extra[0] + " is not a step of " + def.id);
  return resolved;
}

/** Refuses more reference images than the chosen model takes (when its adapter says). */
export function checkReferenceLimit(env: PlanEnv, model: string, count: number, field: string): void {
  const max = env.catalog(model)?.params.maxReferenceImages;
  if (max !== undefined && count > max) throw inputError(field, model + " takes at most " + max + " reference images");
}
