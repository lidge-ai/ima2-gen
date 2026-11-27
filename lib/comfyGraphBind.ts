// lib/comfyGraphBind.ts — parse a ComfyUI API-format graph, infer where ima2's
// request fields belong in it, and inject values without mutating the stored copy.
import {
  COMFY_WORKFLOW_ERROR,
  ComfyWorkflowError,
  type ComfyGraph,
  type ComfyGraphNode,
  type ComfyMediaKind,
  type ComfyWorkflowBindings,
  type ComfyWorkflowParam,
} from "./comfyWorkflowStore.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accepts the API format only (File > Export (API)): a flat object keyed by
 * node id whose values carry class_type.
 *
 * The UI save format is a LiteGraph serialization with a "nodes" ARRAY and a
 * link table. POST /prompt rejects it, so recognising it here turns an opaque
 * upstream 400 into an instruction the user can act on.
 */
export function parseApiGraph(raw: unknown): ComfyGraph {
  if (typeof raw === "string") {
    try {
      return parseApiGraph(JSON.parse(raw));
    } catch (error: unknown) {
      if (error instanceof ComfyWorkflowError) throw error;
      throw new ComfyWorkflowError(COMFY_WORKFLOW_ERROR.GRAPH_INVALID, "Workflow file is not valid JSON.");
    }
  }
  if (!isRecord(raw)) {
    throw new ComfyWorkflowError(COMFY_WORKFLOW_ERROR.GRAPH_INVALID, "Workflow must be a JSON object.");
  }
  if (Array.isArray((raw as { nodes?: unknown }).nodes)) {
    throw new ComfyWorkflowError(
      COMFY_WORKFLOW_ERROR.GRAPH_INVALID,
      "This file is ComfyUI's editor format (nodes and links). ComfyUI itself only runs the API format, "
        + "and nothing outside its editor can convert one into the other reliably. "
        + "In ComfyUI, open the workflow and choose Workflow > Export (API), then add that file here. "
        + "A PNG that ComfyUI saved also works: it carries the API format inside.",
      400,
      "ui-format",
    );
  }
  const graph: ComfyGraph = {};
  for (const [id, node] of Object.entries(raw)) {
    if (!isRecord(node)) continue;
    if (typeof node.class_type !== "string" || !node.class_type) continue;
    if (!isRecord(node.inputs)) continue;
    const entry: ComfyGraphNode = {
      class_type: node.class_type,
      inputs: node.inputs as Record<string, unknown>,
    };
    const meta = node._meta;
    if (isRecord(meta) && typeof meta.title === "string") entry._meta = { title: meta.title };
    graph[id] = entry;
  }
  if (Object.keys(graph).length === 0) {
    throw new ComfyWorkflowError(
      COMFY_WORKFLOW_ERROR.GRAPH_INVALID,
      "No nodes with a class_type were found. Export the workflow in API format.",
    );
  }
  return graph;
}

/** A request field with one place in the graph. File slots (bind.inputs) are a list and are handled apart. */
export type ComfyBindField = Exclude<keyof ComfyWorkflowBindings, "inputs">;

export interface BindCandidate {
  field: ComfyBindField;
  node: string;
  input: string;
  classType: string;
  title?: string;
  /** False when several nodes match this field and a human must choose. */
  unambiguous: boolean;
  /** Other inputs holding the same value, bound together with this one. */
  also?: Array<{ node: string; input: string }>;
}

/** A node input that is wiring, not a value: ["nodeId", slotIndex]. */
function isLink(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string";
}

const FIELD_RULES: ReadonlyArray<{ field: ComfyBindField; classType: string; input: string }> = [
  { field: "prompt", classType: "CLIPTextEncode", input: "text" },
  { field: "prompt", classType: "MiniMaxH3ImageToVideo", input: "prompt" },
  { field: "width", classType: "EmptyLatentImage", input: "width" },
  { field: "width", classType: "MiniMaxH3ImageToVideo", input: "width" },
  { field: "height", classType: "EmptyLatentImage", input: "height" },
  { field: "height", classType: "MiniMaxH3ImageToVideo", input: "height" },
  { field: "seed", classType: "KSampler", input: "seed" },
  { field: "seed", classType: "RandomNoise", input: "noise_seed" },
  { field: "refImage", classType: "LoadImage", input: "image" },
  // Measured against the registered H3 graph on 2026-08-25: length lives on the
  // task node and fps on CreateVideo. SaveVideo carries neither, so a rule
  // pointed at it could never produce a candidate.
  { field: "length", classType: "MiniMaxH3ImageToVideo", input: "length" },
  { field: "fps", classType: "CreateVideo", input: "fps" },
  { field: "output", classType: "SaveImage", input: "" },
  { field: "output", classType: "SaveVideo", input: "" },
];

/**
 * Proposes where each request field belongs, and admits when it cannot tell.
 *
 * Two CLIPTextEncode nodes (positive and negative) are the normal case, and
 * nothing in the graph distinguishes them: _meta.title is a free-text label the
 * user can rename or leave as the default. So a multi-match stays
 * unambiguous:false even when a title looks decisive — guessing here silently
 * swaps positive and negative, and the user sees "the model ignores my prompt"
 * with nothing pointing back at this step.
 */
export function inferBindCandidates(graph: ComfyGraph): BindCandidate[] {
  const candidates: BindCandidate[] = [];
  const fields = [...new Set(FIELD_RULES.map((rule) => rule.field))];
  for (const field of fields) {
    const matches = FIELD_RULES
      .filter((rule) => rule.field === field)
      .flatMap((rule) => Object.entries(graph)
        .filter(([, node]) => node.class_type === rule.classType
          && (!rule.input || (rule.input in node.inputs && !isLink(node.inputs[rule.input]))))
        .map(([nodeId, node]) => ({ rule, nodeId, node })));
    for (const { rule, nodeId, node } of matches) {
      const candidate: BindCandidate = {
        field: rule.field,
        node: nodeId,
        input: rule.input,
        classType: node.class_type,
        unambiguous: matches.length === 1,
      };
      if (node._meta?.title) candidate.title = node._meta.title;
      candidates.push(candidate);
    }
  }
  return candidates;
}

/** Infers only when one concrete SaveImage/SaveVideo output decides the lane. */
export function inferComfyMediaKind(graph: ComfyGraph, outputNode?: string): ComfyMediaKind | undefined {
  if (outputNode !== undefined) {
    const classType = graph[outputNode]?.class_type;
    return classType === "SaveVideo" ? "video" : classType === "SaveImage" ? "image" : undefined;
  }
  const outputs = Object.values(graph).filter((node) => node.class_type === "SaveImage" || node.class_type === "SaveVideo");
  if (outputs.length !== 1) return undefined;
  return outputs[0]!.class_type === "SaveVideo" ? "video" : "image";
}

/** The subset of candidates that can be accepted without asking the user. */
export function unambiguousBindings(candidates: BindCandidate[]): Partial<ComfyWorkflowBindings> {
  const bind: Partial<ComfyWorkflowBindings> = {};
  for (const candidate of candidates) {
    if (!candidate.unambiguous) continue;
    if (candidate.field === "output") bind.output = { node: candidate.node };
    else bind[candidate.field] = { node: candidate.node, input: candidate.input, ...(candidate.also ? { also: candidate.also } : {}) };
  }
  return bind;
}

/**
 * Every scalar input not consumed by a binding and not a link becomes a tunable
 * parameter, so the settings UI can render a workflow's own knobs the way
 * McpModelPresetControls renders MCP model parameters.
 */
export function deriveParams(graph: ComfyGraph, bind: ComfyWorkflowBindings): ComfyWorkflowParam[] {
  const bound = new Set<string>();
  for (const slot of bind.inputs ?? []) bound.add(`${slot.node}.${slot.input}`);
  for (const value of Object.values(bind)) {
    if (!value) continue;
    const entry = value as { node: string; input?: string; also?: Array<{ node: string; input: string }> };
    if (entry.input) bound.add(`${entry.node}.${entry.input}`);
    for (const other of entry.also ?? []) bound.add(`${other.node}.${other.input}`);
  }
  const params: ComfyWorkflowParam[] = [];
  for (const [nodeId, node] of Object.entries(graph)) {
    for (const [input, value] of Object.entries(node.inputs)) {
      if (isLink(value)) continue;
      if (bound.has(`${nodeId}.${input}`)) continue;
      const type = typeof value === "number" ? "number"
        : typeof value === "boolean" ? "boolean"
        : typeof value === "string" ? "string"
        : null;
      if (!type) continue;
      params.push({
        name: `${node.class_type}.${input}`,
        node: nodeId,
        input,
        type,
        default: value as number | string | boolean,
      });
    }
  }
  return params;
}

export interface BindValues {
  prompt: string;
  negativePrompt?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  seed?: number | undefined;
  length?: number | undefined;
  fps?: number | undefined;
  refImageName?: string | undefined;
  params?: Record<string, number | string | boolean> | undefined;
}

function assign(graph: ComfyGraph, binding: ComfyBinding | undefined, value: unknown, label: string): void {
  if (!binding || value === undefined) return;
  const node = graph[binding.node];
  if (!node) {
    throw new ComfyWorkflowError(
      COMFY_WORKFLOW_ERROR.BIND_INVALID,
      `Workflow binding for ${label} points at node '${binding.node}', which is not in the graph. Re-export and re-register the workflow.`,
    );
  }
  node.inputs[binding.input] = value;
}

type ComfyBinding = { node: string; input: string; also?: Array<{ node: string; input: string }> };

/**
 * Returns a DEEP COPY with values injected.
 *
 * Mutating the stored graph would make the second generation inherit the
 * first one's prompt and seed.
 */
export function bindGraph(
  graph: ComfyGraph,
  bind: ComfyWorkflowBindings,
  values: BindValues,
  params: readonly ComfyWorkflowParam[] = [],
): ComfyGraph {
  const copy = structuredClone(graph) as ComfyGraph;
  // Inputs a binding actually wrote. A stored param naming the same input must
  // not overwrite the request's value afterwards — but a param whose binding
  // stayed silent keeps applying, so a tuned value is never lost just because a
  // binding exists for that input.
  const written = new Set<string>();
  const put = (binding: ComfyBinding | undefined, value: unknown, label: string) => {
    if (!binding || value === undefined) return;
    for (const target of [binding, ...(binding.also ?? [])]) {
      assign(copy, target, value, label);
      written.add(`${target.node}.${target.input}`);
    }
  };
  put(bind.prompt, values.prompt, "prompt");
  put(bind.negativePrompt, values.negativePrompt, "negative prompt");
  put(bind.width, values.width, "width");
  put(bind.height, values.height, "height");
  put(bind.seed, values.seed, "seed");
  put(bind.length, values.length, "length");
  put(bind.fps, values.fps, "fps");
  if (values.refImageName !== undefined) {
    if (!bind.refImage) {
      throw new ComfyWorkflowError(
        COMFY_WORKFLOW_ERROR.BIND_INVALID,
        "This workflow has no reference-image binding, so it cannot accept an input image.",
      );
    }
    put(bind.refImage, values.refImageName, "reference image");
  }
  if (values.params) {
    for (const [name, value] of Object.entries(values.params)) {
      const param = params.find((entry) => entry.name === name);
      if (!param) continue;
      if (written.has(`${param.node}.${param.input}`)) continue;
      assign(copy, { node: param.node, input: param.input }, value, name);
    }
  }
  if (!copy[bind.output.node]) {
    throw new ComfyWorkflowError(
      COMFY_WORKFLOW_ERROR.BIND_INVALID,
      `Workflow output node '${bind.output.node}' is not in the graph. Re-export and re-register the workflow.`,
    );
  }
  return copy;
}
