/**
 * Workflow registry (L6). The HTTP layer (L0) lists, prices and runs workflows only through
 * these exports; any UI reads describeWorkflow() and renders the fields itself.
 */
import { directorCast } from "./definitions/directorCast.js";
import { directorCinema } from "./definitions/directorCinema.js";
import { directorLocations } from "./definitions/directorLocations.js";
import { directorStudio } from "./definitions/directorStudio.js";
import { remixMotionTransfer } from "./definitions/remixMotionTransfer.js";
import { remixObjectSwap } from "./definitions/remixObjectSwap.js";
import { remixRestyle } from "./definitions/remixRestyle.js";
import { remixMotionTransferSubscription, remixObjectSwapSubscription } from "./definitions/remixKeyframeSubscription.js";
import { remixRestyleSubscription } from "./definitions/remixRestyleSubscription.js";
import { remixMotionTransferOpen, remixObjectSwapOpen, remixRestyleOpen } from "./definitions/open/remixOpen.js";
import { slotModelAvailable } from "./validate.js";
import type { ModelSlot, WorkflowCombo, WorkflowDefinition, WorkflowField, WorkflowId, WorkflowGateway, WorkflowPreset } from "./types.js";

export const WORKFLOWS: readonly WorkflowDefinition[] = [
  remixMotionTransfer, remixObjectSwap, remixRestyle,
  remixMotionTransferSubscription, remixObjectSwapSubscription, remixRestyleSubscription,
  remixMotionTransferOpen, remixObjectSwapOpen, remixRestyleOpen,
  directorStudio, directorCast, directorLocations, directorCinema,
];

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  return WORKFLOWS.find((w) => w.id === id);
}

export interface SlotDescription extends Omit<ModelSlot, "tierModels"> {
  tierModels?: Readonly<Record<string, string>>;
  /** model id -> whether an adapter lists it with the slot's task. */
  available: Readonly<Record<string, boolean>>;
  /** model id -> whether it can run now (a saved key or the slot's session route). Absent when the gateway cannot tell. */
  runnable?: Readonly<Record<string, boolean>>;
}

export interface WorkflowDescription {
  id: WorkflowId;
  label: string;
  description: string;
  equivalents: readonly string[];
  fields: readonly WorkflowField[];
  slots: readonly SlotDescription[];
  tierField?: string;
  preset?: WorkflowPreset;
  combos?: readonly WorkflowCombo[];
}

/** JSON-safe description for GET /api/workflows. Pass a gateway to mark which models have adapters. */
export function describeWorkflow(def: WorkflowDefinition, gateway?: Pick<WorkflowGateway, "catalog" | "canRun">): WorkflowDescription {
  const slots = def.slots.map((slot) => {
    const models = [...new Set([slot.defaultModel, ...slot.alternatives, ...Object.values(slot.tierModels ?? {})])];
    const available = Object.fromEntries(models.map((m) => [m, gateway ? slotModelAvailable(slot, m, (id) => gateway.catalog(id)) : false]));
    const canRun = gateway?.canRun?.bind(gateway);
    if (!canRun) return { ...slot, available };
    return { ...slot, available, runnable: Object.fromEntries(models.map((m) => [m, available[m] === true && canRun(m, slot.defaultRoute)])) };
  });
  const description: WorkflowDescription = {
    id: def.id, label: def.label, description: def.description, equivalents: def.equivalents, fields: def.fields, slots,
  };
  if (def.tierField) description.tierField = def.tierField;
  if (def.preset) description.preset = def.preset;
  if (def.combos) description.combos = def.combos;
  return description;
}

export { prepareWorkflow, runWorkflow, summarizeSteps } from "./runner.js";
export type { PreparedWorkflow, RunOptions, WorkflowDeps } from "./runner.js";
export { createFfmpegLocalOps } from "./localOps.js";
export { WorkflowError } from "./errors.js";
export type * from "./types.js";


