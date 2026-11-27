import type {
  ComfyBindField, ComfyInputRole, ComfyMediaSlot, ComfyMediaSlotCandidate, ComfyMissingChoice, ComfyServerReport, ComfyWorkflowBindings,
} from "./api-comfy";

/**
 * The rules of the ComfyUI workflow settings screen that need no browser: which file is turned away
 * before it is sent, which file inputs still need a role, what a registration sends, and how the
 * server's report reads. The server stays the authority (lib/comfy); this mirrors it only where
 * waiting for a refusal would cost the person a round trip.
 */

/** Roles a file of each kind can play, as lib/comfy/register.ts accepts them. */
export const SLOT_ROLES: Readonly<Record<ComfyMediaSlot["kind"], readonly ComfyInputRole[]>> = {
  image: ["first-frame", "last-frame", "reference-image", "source-image", "mask"],
  video: ["source-video", "reference-video"],
  audio: ["source-audio", "reference-audio"],
};

/** ComfyUI's editor saves { nodes: [...], links: [...] }; the API format is an object keyed by node id. Same rule as lib/comfyGraphBind.ts. */
export function isEditorFormat(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Array.isArray((value as { nodes?: unknown }).nodes);
}

export function slotKey(slot: Pick<ComfyMediaSlotCandidate, "node" | "input">): string {
  return slot.node + "." + slot.input;
}

/** Roles the graph settles by itself. A slot it does not settle is left out, so a person has to look at it. */
export function presetSlotRoles(slots: readonly ComfyMediaSlotCandidate[]): Record<string, ComfyInputRole> {
  const roles: Record<string, ComfyInputRole> = {};
  for (const slot of slots) if (slot.role) roles[slotKey(slot)] = slot.role;
  return roles;
}

/** File inputs nobody has given a role yet. Registering one unassigned would run on whatever file was last in that picker. */
export function unassignedSlots<T extends ComfyMediaSlotCandidate>(slots: readonly T[], roles: Readonly<Record<string, string | undefined>>): T[] {
  return slots.filter((slot) => !roles[slotKey(slot)]);
}

const FIELDS: readonly Exclude<ComfyBindField, "output" | "inputs">[] = ["prompt", "negativePrompt", "width", "height", "seed", "refImage"];

/** What POST /api/comfy/workflows takes as bind: the chosen fields, and every file input with its role. */
export function buildBind(
  selection: Readonly<Partial<Record<string, string>>>,
  slots: readonly ComfyMediaSlotCandidate[],
  roles: Readonly<Record<string, string | undefined>>,
): ComfyWorkflowBindings {
  const bind: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const value = selection[field];
    if (!value) continue;
    const dot = value.indexOf(".");
    bind[field] = { node: value.slice(0, dot), input: value.slice(dot + 1) };
  }
  bind.output = { node: selection.output ?? "" };
  // With no slots listed the server was not asked; sending nothing leaves its own rule for older registrations in place.
  if (slots.length > 0) {
    bind.inputs = slots.flatMap((slot): ComfyMediaSlot[] => {
      const role = roles[slotKey(slot)];
      return role ? [{ kind: slot.kind, role: role as ComfyInputRole, node: slot.node, input: slot.input }] : [];
    });
  }
  return bind as unknown as ComfyWorkflowBindings;
}

export type ComfyReportSummary =
  | { state: "unknown" }
  | { state: "unreachable"; origin: string; reason: string }
  | {
    state: "ready" | "problems"; origin: string;
    missingNodes: Array<{ classType: string; nodes: string[] }>;
    missingModels: ComfyMissingChoice[];
    otherChoices: ComfyMissingChoice[];
    paidNodes: string[];
  };

/** "ready" means nothing the workflow needs is missing. Paid nodes do not stop a run, so they are reported beside either state. */
export function reportSummary(report: ComfyServerReport | undefined): ComfyReportSummary {
  if (!report) return { state: "unknown" };
  if (!report.reachable) return { state: "unreachable", origin: report.origin, reason: report.reason };
  const missingNodes = report.missingNodes ?? [];
  const choices = report.missingChoices ?? [];
  return {
    state: missingNodes.length > 0 || choices.length > 0 ? "problems" : "ready", origin: report.origin, missingNodes,
    missingModels: choices.filter((choice) => choice.model), otherChoices: choices.filter((choice) => !choice.model),
    paidNodes: report.paidNodes ?? [],
  };
}

/** The id the media catalog lists a registered workflow under. */
export function workflowMediaModel(workflowId: string): string {
  return "comfy/" + workflowId;
}

