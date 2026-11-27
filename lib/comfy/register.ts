// lib/comfy/register.ts — checks the file slots a workflow is registered with.
import { inputSpec, type ComfyObjectInfo } from "./objectInfo.js";
import {
  COMFY_WORKFLOW_ERROR, ComfyWorkflowError,
  type ComfyGraph, type ComfyInputRole, type ComfyMediaKind, type ComfyMediaSlot, type ComfyWorkflowBindings,
} from "../comfyWorkflowStore.js";

const ROLES: Readonly<Record<ComfyMediaSlot["kind"], readonly ComfyInputRole[]>> = {
  image: ["first-frame", "last-frame", "reference-image", "source-image", "mask"],
  video: ["source-video", "reference-video"],
  audio: ["source-audio", "reference-audio"],
};
const MAX_SLOTS = 16;

function bad(message: string): ComfyWorkflowError {
  return new ComfyWorkflowError(COMFY_WORKFLOW_ERROR.BIND_INVALID, message);
}

/**
 * Validates bind.inputs from a registration request. Each slot names an input
 * that exists in the graph and a role that kind of file can play, and no input
 * is claimed twice. Undefined when the request sent none.
 */
export function readMediaSlots(raw: unknown, graph: ComfyGraph): ComfyMediaSlot[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_SLOTS) throw bad("bind.inputs must be a list of at most " + String(MAX_SLOTS) + " file slots.");
  const seen = new Set<string>();
  return raw.map((entry: unknown): ComfyMediaSlot => {
    const slot = (entry ?? {}) as Record<string, unknown>;
    const { kind, role, node, input } = slot;
    if (kind !== "image" && kind !== "video" && kind !== "audio") throw bad("A file slot's kind must be image, video or audio.");
    if (typeof role !== "string" || !(ROLES[kind] as readonly string[]).includes(role)) {
      throw bad("A " + kind + " slot's role must be one of: " + ROLES[kind].join(", ") + ".");
    }
    if (typeof node !== "string" || typeof input !== "string" || !graph[node] || !(input in graph[node].inputs)) {
      throw bad("File slot " + String(node) + "." + String(input) + " is not an input of this workflow.");
    }
    if (seen.has(node + "." + input)) throw bad("File slot " + node + "." + input + " is listed twice.");
    seen.add(node + "." + input);
    return { kind, role: role as ComfyInputRole, node, input };
  });
}

/**
 * The classic image and video lanes feed one reference image through refImage.
 * A workflow registered with exactly one image slot gets that binding too, so it
 * is usable from both places; with more slots it runs from the media route only.
 */
export function withClassicReference(bind: ComfyWorkflowBindings, slots: readonly ComfyMediaSlot[] | undefined, mediaKind: ComfyMediaKind): ComfyWorkflowBindings {
  if (!slots) return bind;
  const next: ComfyWorkflowBindings = { ...bind, inputs: [...slots] };
  const only = slots.length === 1 && slots[0]!.kind === "image" && slots[0]!.role !== "mask" ? slots[0]! : undefined;
  if (only && !bind.refImage && mediaKind !== "audio") next.refImage = { node: only.node, input: only.input };
  return next;
}

/**
 * The lengths every input bound to the duration accepts, from the server's node schemas. A schema that
 * allows zero is read as starting at one second: a result has to have some length.
 */
export function durationRangeFor(bind: ComfyWorkflowBindings, graph: ComfyGraph, info: ComfyObjectInfo | undefined): { minSec: number; maxSec: number } | undefined {
  if (!bind.duration || !info) return undefined;
  let minSec = 1, maxSec = Number.POSITIVE_INFINITY;
  for (const slot of [bind.duration, ...(bind.duration.also ?? [])]) {
    const options = inputSpec(info, graph[slot.node]?.class_type ?? "", slot.input)?.options;
    if (typeof options?.min === "number") minSec = Math.max(minSec, options.min);
    if (typeof options?.max === "number") maxSec = Math.min(maxSec, options.max);
  }
  return Number.isFinite(maxSec) && maxSec >= minSec ? { minSec, maxSec } : undefined;
}
