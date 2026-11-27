// lib/comfy/inspect.ts — looks at a workflow together with the server it will run on.
//
// With the server reachable, slots come from its node schemas and the report
// says what the workflow needs that the server lacks. Without it, the older
// class-name rules still propose what they can, and the report says the server
// was not consulted: nothing is invented to fill the gap.
import { inferBindCandidates, inferComfyMediaKind, type BindCandidate } from "../comfyGraphBind.js";
import type { ComfyGraph, ComfyMediaKind } from "../comfyWorkflowStore.js";
import type { ComfyTarget } from "./access.js";
import { redactForTarget } from "./client.js";
import { detectBindCandidates, detectMediaKind, detectMediaSlots, findWorkflowProblems, type ComfyWorkflowProblems, type MediaSlotCandidate } from "./detect.js";
import { fetchComfyObjectInfo, type ComfyObjectInfo } from "./objectInfo.js";

export type ComfyServerReport =
  | ({ origin: string; reachable: true } & ComfyWorkflowProblems)
  | { origin: string; reachable: false; reason: string };

export interface ComfyInspection {
  candidates: BindCandidate[];
  mediaKind?: ComfyMediaKind;
  /** File pickers in the graph. Empty when the server was not reachable: its schemas are what identify them. */
  mediaSlots: MediaSlotCandidate[];
  server: ComfyServerReport;
  /** The schemas the inspection read, for callers that go on to describe parameters. */
  info?: ComfyObjectInfo;
}

/** Schemas for every class the graph uses, or the reason they could not be read. */
export async function readWorkflowSchemas(
  target: ComfyTarget,
  graph: ComfyGraph,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ info: ComfyObjectInfo } | { reason: string }> {
  try {
    return { info: await fetchComfyObjectInfo(target, Object.values(graph).map((node) => node.class_type), timeoutMs, fetchImpl) };
  } catch (error: unknown) {
    return { reason: redactForTarget(target, error instanceof Error ? error.message : "unreachable") };
  }
}

export async function inspectComfyWorkflow(
  graph: ComfyGraph,
  target: ComfyTarget,
  timeoutMs: number,
  outputNode?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ComfyInspection> {
  const schemas = await readWorkflowSchemas(target, graph, timeoutMs, fetchImpl);
  if ("reason" in schemas) {
    const mediaKind = inferComfyMediaKind(graph, outputNode);
    return {
      candidates: inferBindCandidates(graph),
      ...(mediaKind ? { mediaKind } : {}),
      mediaSlots: [],
      server: { origin: target.origin, reachable: false, reason: schemas.reason },
    };
  }
  const { info } = schemas;
  // The saver classes ima2 has always known decide first; the schema answers for the rest.
  const mediaKind = inferComfyMediaKind(graph, outputNode) ?? detectMediaKind(graph, info, outputNode);
  return {
    candidates: detectBindCandidates(graph, info),
    ...(mediaKind ? { mediaKind } : {}),
    mediaSlots: detectMediaSlots(graph, info, mediaKind),
    server: { origin: target.origin, reachable: true, ...findWorkflowProblems(graph, info) },
    info,
  };
}
