/** Workflow description, run body and estimate translation (lib/workflows <-> kit types). */
import { wireRef } from "./elements.ts";
import type {
  MediaKind, SubmitInput, WorkflowDef, WorkflowEstimate, WorkflowInputSpec, WorkflowParamSpec, WorkflowPreset, WorkflowRunBody,
  WorkflowShotsSpec,
} from "./types.ts";
import type { WireEstimateResponse, WireField, WireWorkflow } from "./wire.ts";

const IMAGE_OUTPUT = new Set(["director-cast", "director-locations"]);

function family(id: string): WorkflowDef["family"] {
  return id.startsWith("remix") ? "remix" : id.startsWith("director") ? "director" : "other";
}

function toInput(field: WireField): WorkflowInputSpec | null {
  const base = { name: field.name, label: field.label, required: field.required, ...(field.help ? { description: field.help } : {}) };
  if (field.type === "media") {
    const role = field.accept === "video" ? "source-video" : field.accept === "audio" ? "reference-audio" : "reference-image";
    return {
      ...base, kind: field.accept, role, accept: field.accept + "/*", maxCount: field.max,
      ...(field.minDurationSec && field.maxDurationSec ? { durationSec: { min: field.minDurationSec, max: field.maxDurationSec } } : {}),
    };
  }
  if (field.type === "text") return { ...base, kind: "text" };
  return null;
}

function toParam(field: WireField): WorkflowParamSpec | null {
  const base = { name: field.name, label: field.label };
  switch (field.type) {
    case "enum":
      return { ...base, type: "select", options: field.options, ...(field.default !== undefined ? { default: field.default } : {}) };
    case "integer":
      return { ...base, type: "number", min: field.min, max: field.max, step: 1, ...(field.default !== undefined ? { default: field.default } : {}) };
    case "boolean":
      return { ...base, type: "boolean", default: field.default };
    case "colors":
      return { ...base, type: "text" };
    default:
      return null;
  }
}

/** The most a cut list may add up to (lib/workflows/validate.ts SHOTS_MAX_TOTAL_SEC); the field itself does not carry it. */
export const SHOTS_MAX_TOTAL_SEC = 60;

function toShots(fields: readonly WireField[]): WorkflowShotsSpec | undefined {
  const field = fields.find((f) => f.type === "shots");
  if (!field || field.type !== "shots") return undefined;
  return {
    name: field.name, label: field.label, min: field.min, max: field.max, promptMaxLength: field.promptMaxLength,
    maxTotalSec: SHOTS_MAX_TOTAL_SEC, ...(field.help ? { description: field.help } : {}),
  };
}

export function toWorkflowDef(wire: WireWorkflow): WorkflowDef {
  return {
    id: wire.id,
    family: family(wire.id),
    label: wire.label,
    description: wire.description,
    output: (IMAGE_OUTPUT.has(wire.id) ? "image" : "video") as MediaKind,
    inputs: wire.fields.map(toInput).filter((x): x is WorkflowInputSpec => x !== null),
    params: wire.fields.map(toParam).filter((x): x is WorkflowParamSpec => x !== null),
    steps: wire.slots.map((slot) => ({
      id: slot.name,
      label: slot.label,
      model: slot.defaultModel,
      modelChoices: [slot.defaultModel, ...slot.alternatives].filter((m, i, all) => all.indexOf(m) === i),
      available: slot.available,
      ...(slot.runnable ? { runnable: slot.runnable } : {}),
      ...(slot.defaultRoute ? { route: slot.defaultRoute } : {}),
      ...(slot.description ? { description: slot.description } : {}),
      ...(slot.credits?.length ? { credits: slot.credits } : {}),
    })),
    ...(toShots(wire.fields) ? { shots: toShots(wire.fields)! } : {}),
    ...(wire.i18n ? { i18n: wire.i18n } : {}),
    ...(wire.preset?.label ? { preset: toPreset(wire.preset) } : {}),
  };
}

function toPreset(p: NonNullable<WireWorkflow["preset"]>): WorkflowPreset {
  const losses = (p.losses ?? []).filter((l): l is { aspect: string; detail: string } => !!l.detail).map((l) => ({ aspect: l.aspect ?? "other", detail: l.detail }));
  return { label: p.label ?? "", losses, ...(p.billingNote ? { billingNote: p.billingNote } : {}) };
}

/**
 * The workflow with its visible text in the given language (label, description, field labels,
 * help and option labels, step names); anything the server did not translate stays English.
 * Names, values and ids never change.
 */
export function localizeWorkflow(def: WorkflowDef, locale: string): WorkflowDef {
  const text = def.i18n?.[locale];
  if (!text) return def;
  const field = (name: string) => text.fields?.[name];
  return {
    ...def,
    label: text.label ?? def.label,
    description: text.description ?? def.description,
    inputs: def.inputs.map((input) => {
      const f = field(input.name);
      const description = f?.help ?? input.description;
      return { ...input, label: f?.label ?? input.label, ...(description !== undefined ? { description } : {}) };
    }),
    params: def.params.map((param) => {
      const f = field(param.name);
      return {
        ...param,
        label: f?.label ?? param.label,
        ...(param.options ? { options: param.options.map((o) => ({ ...o, label: f?.options?.[o.value] ?? o.label })) } : {}),
      };
    }),
    ...(def.shots
      ? { shots: { ...def.shots, label: field(def.shots.name)?.label ?? def.shots.label, ...((field(def.shots.name)?.help ?? def.shots.description) !== undefined ? { description: field(def.shots.name)?.help ?? def.shots.description! } : {}) } }
      : {}),
    ...(def.preset
      ? {
          preset: {
            ...def.preset,
            label: text.preset?.label ?? def.preset.label,
            losses: def.preset.losses.map((l, i) => ({ ...l, detail: text.preset?.losses?.[i] ?? l.detail })),
            ...(def.preset.billingNote ? { billingNote: text.preset?.billingNote ?? def.preset.billingNote } : {}),
          },
        }
      : {}),
    steps: def.steps.map((step) => {
      const description = text.slotDescriptions?.[step.id] ?? step.description;
      return { ...step, label: text.slots?.[step.id] ?? step.label, ...(description !== undefined ? { description } : {}) };
    }),
  };
}

function mediaValue(list: readonly SubmitInput[]) {
  return list.map((item) => ("inputId" in item ? wireRef(item.inputId) : { url: item.url }));
}

function colorsValue(def: WorkflowDef | undefined, name: string, value: unknown): unknown {
  const isColors = def?.params.some((p) => p.name === name && p.type === "text");
  return isColors && typeof value === "string" ? value.split(/[\s,]+/).filter(Boolean) : value;
}

/** POST /api/workflows/:id body. Slot overrides become selection.models / selection.routes. */
export function toWireRun(body: WorkflowRunBody, def?: WorkflowDef): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(body.inputs)) values[name] = typeof value === "string" ? value : mediaValue(value);
  for (const [name, value] of Object.entries(body.params ?? {})) values[name] = colorsValue(def, name, value);
  if (body.shots?.length) values[def?.shots?.name ?? "shots"] = body.shots.map((shot) => ({ prompt: shot.prompt.trim(), durationSec: shot.durationSec }));
  const models: Record<string, string> = {};
  const routes: Record<string, string> = {};
  for (const [slot, pick] of Object.entries(body.steps ?? {})) {
    if (pick.model) models[slot] = pick.model;
    if (pick.provider) routes[slot] = pick.provider;
  }
  return {
    values,
    ...(Object.keys(models).length || Object.keys(routes).length ? { selection: { models, routes } } : {}),
    ...(body.clientRequestId ? { requestId: body.clientRequestId } : {}),
  };
}

export function toEstimate(wire: WireEstimateResponse): WorkflowEstimate {
  const steps = wire.estimate.steps.map((e) => {
    const summary = wire.steps.find((s) => s.id === e.stepId);
    const basis = e.note ?? (e.units ? e.units.quantity + " " + e.units.unit + (e.units.variant ? " (" + e.units.variant + ")" : "") : "");
    return {
      id: e.stepId,
      ...(summary ? { label: summary.label } : {}),
      ...(e.model ? { model: e.model } : summary?.model ? { model: summary.model } : {}),
      ...(summary?.route ? { route: summary.route } : {}),
      ...(summary?.slot ? { slot: summary.slot } : {}),
      estimate: { usd: e.usd, basis: e.usd === null ? "No published price" : basis },
    };
  });
  const total = wire.estimate.complete
    ? { usd: wire.estimate.usd, basis: steps.length + " steps" }
    : { usd: null, basis: "At least one step has no published price" };
  return { steps, total };
}
