// lib/comfy/localCatalog.ts — registered ComfyUI workflows as media models.
//
// The media registry reads a live adapter synchronously on every lookup, while
// the workflow store is a file. This module keeps the store's records in memory
// (refreshed at start and after every write) and turns each into a model spec:
// comfy/<workflow id>, with the task its inputs imply and no price.
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../../config.js";
import { atomicWriteJson } from "../atomicWrite.js";
import { listWorkflows, mediaSlots, type ComfyMediaSlot, type ComfyWorkflowRecord } from "../comfyWorkflowStore.js";
import type { MediaInputRequirement, MediaLocalEstimate, MediaModelSpec, MediaOptionSpec, MediaTask } from "../providers/media/contract.js";

export const COMFY_MODEL_PREFIX = "comfy/";
const DOCS_URL = "https://docs.comfy.org/development/comfyui-server/comms_overview";
const KEPT_RUNS = 20;

let workflows: readonly ComfyWorkflowRecord[] = [];
let runSeconds: Record<string, number[]> = {};

/** The task a workflow performs, read from what it saves and the files it takes. */
export function workflowTask(record: Pick<ComfyWorkflowRecord, "mediaKind" | "bind">): MediaTask {
  const slots = mediaSlots(record);
  const takes = (kind: ComfyMediaSlot["kind"]) => slots.some((slot) => slot.kind === kind);
  if (record.mediaKind === "audio") return takes("video") ? "video-to-audio" : "text-to-audio";
  if (record.mediaKind === "image") return takes("image") ? "image-to-image" : "text-to-image";
  if (takes("audio")) return takes("video") ? "lipsync" : "avatar";
  if (takes("video")) return "video-to-video";
  if (!takes("image")) return "text-to-video";
  return slots.every((slot) => slot.role === "reference-image") ? "reference-to-video" : "image-to-video";
}

/** Every file slot must be filled: a workflow cannot run with a picker left on a file that is not there. */
function inputRequirements(slots: readonly ComfyMediaSlot[]): MediaInputRequirement[] {
  const counts = new Map<ComfyMediaSlot["role"], number>();
  for (const slot of slots) counts.set(slot.role, (counts.get(slot.role) ?? 0) + 1);
  return [...counts.entries()].map(([role, count]) => ({ role, min: count, max: count }));
}

/** The workflow's own choice lists and switches, as settings a client can offer. */
function optionSpecs(record: ComfyWorkflowRecord): MediaOptionSpec[] {
  const out: MediaOptionSpec[] = [];
  for (const param of record.params) {
    if (param.type === "boolean") out.push({ name: param.name, type: "boolean" });
    else if (param.options && param.options.length > 0 && param.options.length <= 64) {
      out.push({ name: param.name, type: "enum", values: param.options.map(String) });
    }
  }
  return out;
}

export function workflowSpec(record: ComfyWorkflowRecord): MediaModelSpec {
  const slots = mediaSlots(record);
  const count = (role: ComfyMediaSlot["role"]) => slots.filter((slot) => slot.role === role).length;
  const inputs = inputRequirements(slots);
  const options = optionSpecs(record);
  return {
    id: COMFY_MODEL_PREFIX + record.id,
    upstreamId: record.id,
    vendor: "comfy",
    label: record.label,
    kind: record.mediaKind,
    tasks: [workflowTask(record)],
    params: {
      ...(record.bind.seed ? { seed: true } : {}),
      ...(record.bind.negativePrompt ? { negativePrompt: true } : {}),
      ...(count("reference-image") > 0 ? { maxReferenceImages: count("reference-image") } : {}),
      ...(count("reference-video") > 0 ? { maxReferenceVideos: count("reference-video") } : {}),
      ...(inputs.length > 0 ? { inputs } : {}),
      ...(options.length > 0 ? { options } : {}),
    },
    pricing: [],
    docsUrl: DOCS_URL,
  };
}

export function listLocalSpecs(): MediaModelSpec[] {
  return workflows.map(workflowSpec);
}

export function localWorkflow(modelId: string): ComfyWorkflowRecord | undefined {
  if (!modelId.startsWith(COMFY_MODEL_PREFIX)) return undefined;
  return workflows.find((record) => record.id === modelId.slice(COMFY_MODEL_PREFIX.length));
}

function statsPath(): string {
  return join(config.storage.configDir, "comfy", "run-stats.json");
}

/** Reloads the registered workflows and this machine's run times. Call at start and after a write. */
export async function syncLocalCatalog(): Promise<void> {
  workflows = await listWorkflows();
  try {
    const parsed: unknown = JSON.parse(await readFile(statsPath(), "utf8"));
    const next: Record<string, number[]> = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [id, list] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(list)) next[id] = list.filter((value): value is number => typeof value === "number" && value > 0).slice(-KEPT_RUNS);
      }
    }
    runSeconds = next;
  } catch {
    runSeconds = {};
  }
}

/** Remembers how long a successful run took, so the next estimate can say what to expect. */
export async function recordLocalRun(workflowId: string, seconds: number): Promise<void> {
  if (!(seconds > 0)) return;
  runSeconds = { ...runSeconds, [workflowId]: [...(runSeconds[workflowId] ?? []), Math.round(seconds * 10) / 10].slice(-KEPT_RUNS) };
  await mkdir(join(config.storage.configDir, "comfy"), { recursive: true });
  await atomicWriteJson(statsPath(), runSeconds);
}

/** The expected time is the median of this machine's own runs of this workflow, or unknown. Never a guess. */
export function estimateLocalRun(workflowId: string): MediaLocalEstimate {
  const record = workflows.find((entry) => entry.id === workflowId);
  const mayBill = (record?.paidNodes?.length ?? 0) > 0;
  const runs = [...(runSeconds[workflowId] ?? [])].sort((a, b) => a - b);
  if (runs.length === 0) return { expectedSec: null, basis: "no runs yet", mayBill };
  const middle = runs.length % 2 === 1 ? runs[(runs.length - 1) / 2]! : (runs[runs.length / 2 - 1]! + runs[runs.length / 2]!) / 2;
  return { expectedSec: Math.round(middle * 10) / 10, basis: "median of " + String(runs.length) + (runs.length === 1 ? " run" : " runs") + " on this machine", mayBill };
}
