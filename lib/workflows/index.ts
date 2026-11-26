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
import type { ModelSlot, WorkflowDefinition, WorkflowField, WorkflowId, WorkflowGateway } from "./types.js";

export const WORKFLOWS: readonly WorkflowDefinition[] = [
  remixMotionTransfer, remixObjectSwap, remixRestyle,
  directorStudio, directorCast, directorLocations, directorCinema,
];

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  return WORKFLOWS.find((w) => w.id === id);
}

export interface SlotDescription extends Omit<ModelSlot, "tierModels"> {
  tierModels?: Readonly<Record<string, string>>;
  /** model id -> whether the gateway knows it (an adapter lists it). */
  available: Readonly<Record<string, boolean>>;
}

export interface WorkflowDescription {
  id: WorkflowId;
  label: string;
  description: string;
  equivalents: readonly string[];
  fields: readonly WorkflowField[];
  slots: readonly SlotDescription[];
  tierField?: string;
}

/** JSON-safe description for GET /api/workflows. Pass a gateway to mark which models have adapters. */
export function describeWorkflow(def: WorkflowDefinition, gateway?: Pick<WorkflowGateway, "catalog">): WorkflowDescription {
  const slots = def.slots.map((slot) => {
    const models = [slot.defaultModel, ...slot.alternatives, ...Object.values(slot.tierModels ?? {})];
    const available = Object.fromEntries(models.map((m) => [m, gateway ? gateway.catalog(m) !== undefined : false]));
    return { ...slot, available };
  });
  const description: WorkflowDescription = {
    id: def.id, label: def.label, description: def.description, equivalents: def.equivalents, fields: def.fields, slots,
  };
  if (def.tierField) description.tierField = def.tierField;
  return description;
}

export { prepareWorkflow, runWorkflow, summarizeSteps } from "./runner.js";
export type { PreparedWorkflow, RunOptions, WorkflowDeps } from "./runner.js";
export { createFfmpegLocalOps } from "./localOps.js";
export { WorkflowError } from "./errors.js";
export type * from "./types.js";
