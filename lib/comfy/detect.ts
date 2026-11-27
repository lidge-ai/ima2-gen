// lib/comfy/detect.ts — where ima2's request fields belong in a workflow, read
// from the graph and the server's own node schemas (lib/comfy/objectInfo.ts).
//
// A field is proposed without asking only when the graph settles it: the text a
// sampler's positive input leads to is the prompt, whatever the node is titled.
// Where the graph does not settle it, every candidate is listed and a person
// chooses; nothing here guesses from a title.
import type { BindCandidate, ComfyBindField } from "../comfyGraphBind.js";
import type { ComfyGraph, ComfyInputRole, ComfyMediaKind, ComfyWorkflowBindings, ComfyWorkflowParam } from "../comfyWorkflowStore.js";
import { inputSpec, outputName, outputType, type ComfyObjectInfo } from "./objectInfo.js";

interface Slot { node: string; input: string }

const MODEL_FILE_RE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)$/i;
const MAX_TRACE_DEPTH = 12;

function asLink(value: unknown): [string, number] | null {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number"
    ? [value[0], value[1]] : null;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Every literal input of the graph that passes the test, in node order. */
function scalarSlots(graph: ComfyGraph, test: (node: string, input: string, value: string | number | boolean) => boolean): Slot[] {
  const out: Slot[] = [];
  for (const [node, entry] of Object.entries(graph)) {
    for (const [input, value] of Object.entries(entry.inputs)) {
      if (isScalar(value) && test(node, input, value)) out.push({ node, input });
    }
  }
  return out;
}

function textSlots(graph: ComfyGraph, info: ComfyObjectInfo): Slot[] {
  return scalarSlots(graph, (node, input, value) => {
    const spec = inputSpec(info, graph[node]!.class_type, input);
    return typeof value === "string" && spec?.type === "STRING" && spec.options.multiline === true;
  });
}

/**
 * Follows a conditioning link upstream to the text it was encoded from.
 *
 * A node that passes both prompts through (an image-to-video conditioner takes
 * positive and negative and returns both) is crossed by name: its "positive"
 * output continues at its "positive" input.
 *
 * Stops with null when the path forks (two conditioning inputs on one node):
 * which branch is "the" prompt is then a choice, not a fact.
 */
function traceText(graph: ComfyGraph, info: ComfyObjectInfo, texts: readonly Slot[], link: [string, number], depth = 0): Slot | null {
  const node = graph[link[0]];
  if (!node || depth > MAX_TRACE_DEPTH) return null;
  const own = texts.filter((slot) => slot.node === link[0]);
  if (own.length === 1) return own[0]!;
  if (own.length > 1) return null;
  const name = outputName(info, node.class_type, link[1]);
  const sameName = name ? asLink(node.inputs[name]) : null;
  if (sameName) return traceText(graph, info, texts, sameName, depth + 1);
  const upstream = Object.values(node.inputs).map(asLink).filter((entry): entry is [string, number] => {
    return entry !== null && graph[entry[0]] !== undefined && outputType(info, graph[entry[0]]!.class_type, entry[1]) === "CONDITIONING";
  });
  return upstream.length === 1 ? traceText(graph, info, texts, upstream[0]!, depth + 1) : null;
}

const key = (slot: Slot) => slot.node + "." + slot.input;

/** The prompt and negative prompt the samplers in this graph agree on, when they do. */
function tracePrompts(graph: ComfyGraph, info: ComfyObjectInfo, texts: readonly Slot[]): { prompt?: Slot; negative?: Slot } {
  const positives = new Map<string, Slot>();
  const negatives = new Map<string, Slot>();
  let traced = 0;
  for (const node of Object.values(graph)) {
    const positive = asLink(node.inputs.positive);
    if (!positive) continue;
    traced += 1;
    const found = traceText(graph, info, texts, positive);
    if (!found) return {};
    positives.set(key(found), found);
    const negative = asLink(node.inputs.negative);
    const against = negative ? traceText(graph, info, texts, negative) : null;
    // A negative derived from the positive text (ConditioningZeroOut) is not a second prompt.
    if (against && key(against) !== key(found)) negatives.set(key(against), against);
  }
  if (traced === 0 || positives.size !== 1) return {};
  const prompt = [...positives.values()][0]!;
  return negatives.size === 1 ? { prompt, negative: [...negatives.values()][0]! } : { prompt };
}

interface Draft { field: ComfyBindField; slots: Slot[]; settled?: Slot; also?: Slot[] }

function namedInts(graph: ComfyGraph, info: ComfyObjectInfo, names: readonly string[], types: readonly string[] = ["INT"]): Slot[] {
  return scalarSlots(graph, (node, input, value) => {
    return typeof value === "number" && names.includes(input) && types.includes(inputSpec(info, graph[node]!.class_type, input)?.type ?? "");
  });
}

/** A size written in several nodes is one setting when every copy holds the same number. */
function sharedValue(graph: ComfyGraph, field: ComfyBindField, slots: Slot[]): Draft {
  const values = new Set(slots.map((slot) => graph[slot.node]!.inputs[slot.input]));
  if (slots.length > 1 && values.size === 1) return { field, slots: [slots[0]!], settled: slots[0]!, also: slots.slice(1) };
  return slots.length === 1 ? { field, slots, settled: slots[0]! } : { field, slots };
}

function outputNodes(graph: ComfyGraph, info: ComfyObjectInfo): string[] {
  const saving = Object.keys(graph).filter((node) => info[graph[node]!.class_type]?.output_node === true);
  const kept = saving.filter((node) => !/^Preview/.test(graph[node]!.class_type));
  return kept.length > 0 ? kept : saving;
}

function draftFields(graph: ComfyGraph, info: ComfyObjectInfo): Draft[] {
  const texts = textSlots(graph, info);
  const traced = tracePrompts(graph, info, texts);
  const single = (field: ComfyBindField, slots: Slot[]): Draft => (slots.length === 1 ? { field, slots, settled: slots[0]! } : { field, slots });
  const prompt: Draft = traced.prompt ? { field: "prompt", slots: texts, settled: traced.prompt } : single("prompt", texts);
  const others = texts.filter((slot) => !prompt.settled || key(slot) !== key(prompt.settled));
  // A negative prompt is proposed only when a sampler's negative input leads to its own text.
  // Listing every other text box would make a person rule each one out before they could save.
  const negative: Draft = traced.negative
    ? { field: "negativePrompt", slots: others, settled: traced.negative }
    : { field: "negativePrompt", slots: [] };
  const images = scalarSlots(graph, (node, input) => {
    return graph[node]!.class_type !== "LoadImageMask" && inputSpec(info, graph[node]!.class_type, input)?.upload === "image";
  });
  return [
    prompt,
    negative,
    sharedValue(graph, "width", namedInts(graph, info, ["width"])),
    sharedValue(graph, "height", namedInts(graph, info, ["height"])),
    single("seed", namedInts(graph, info, ["seed", "noise_seed"])),
    single("refImage", images),
    single("length", namedInts(graph, info, ["length", "num_frames", "frames"])),
    single("fps", namedInts(graph, info, ["fps", "frame_rate"], ["INT", "FLOAT"])),
  ];
}

/**
 * Proposes where each request field belongs. unambiguous marks the one the
 * graph settles; the rest stay listed so a person can still choose another.
 */
export function detectBindCandidates(graph: ComfyGraph, info: ComfyObjectInfo): BindCandidate[] {
  const candidates: BindCandidate[] = [];
  const push = (field: ComfyBindField, node: string, input: string, unambiguous: boolean, also?: Slot[]) => {
    const entry = graph[node]!;
    candidates.push({
      field, node, input, classType: entry.class_type, unambiguous,
      ...(entry._meta?.title ? { title: entry._meta.title } : {}),
      ...(also && also.length > 0 ? { also } : {}),
    });
  };
  for (const draft of draftFields(graph, info)) {
    if (draft.settled) push(draft.field, draft.settled.node, draft.settled.input, true, draft.also);
    for (const slot of draft.slots) {
      if (!draft.settled || key(slot) !== key(draft.settled)) push(draft.field, slot.node, slot.input, false);
    }
  }
  const outputs = outputNodes(graph, info);
  for (const node of outputs) push("output", node, "", outputs.length === 1);
  return candidates;
}

/** What the chosen output node saves, when its inputs say so. Undefined means a person must say. */
export function detectMediaKind(graph: ComfyGraph, info: ComfyObjectInfo, outputNode?: string): ComfyMediaKind | undefined {
  const nodes = outputNode === undefined ? outputNodes(graph, info) : [outputNode];
  if (nodes.length !== 1 || !graph[nodes[0]!]) return undefined;
  const classType = graph[nodes[0]!]!.class_type;
  const required = info[classType]?.input?.required ?? {};
  const types = new Set(Object.keys(required).map((input) => inputSpec(info, classType, input)?.type));
  if (types.has("VIDEO")) return "video";
  if (types.has("AUDIO") && !types.has("IMAGE")) return "audio";
  // An IMAGE input can still be written as an animation (WebP, WebM); only the plain image savers are certain.
  return classType === "SaveImage" || classType === "PreviewImage" ? "image" : undefined;
}

export interface ComfyWorkflowProblems {
  /** Node types this server does not have: a custom node pack is not installed. */
  missingNodes: Array<{ classType: string; nodes: string[] }>;
  /** A choice the workflow makes that this server does not offer; usually a model file that is not there. */
  missingChoices: Array<{ node: string; classType: string; input: string; value: string; model: boolean }>;
  /** Partner nodes: ComfyUI may charge the user's Comfy account for these. */
  paidNodes: string[];
}

/** Compares a workflow with what the server can run, before anything is queued. */
export function findWorkflowProblems(graph: ComfyGraph, info: ComfyObjectInfo): ComfyWorkflowProblems {
  const missing = new Map<string, string[]>();
  const problems: ComfyWorkflowProblems = { missingNodes: [], missingChoices: [], paidNodes: [] };
  for (const [node, entry] of Object.entries(graph)) {
    const classType = entry.class_type;
    if (!info[classType]) { missing.set(classType, [...(missing.get(classType) ?? []), node]); continue; }
    if (info[classType]!.api_node === true && !problems.paidNodes.includes(classType)) problems.paidNodes.push(classType);
    for (const [input, value] of Object.entries(entry.inputs)) {
      if (!isScalar(value)) continue;
      const spec = inputSpec(info, classType, input);
      // An upload list holds files ima2 sends at run time; a fixed list must already contain the value.
      if (!spec?.choices || spec.upload || spec.options.remote !== undefined) continue;
      if (spec.choices.some((choice) => choice === value || String(choice) === String(value))) continue;
      problems.missingChoices.push({ node, classType, input, value: String(value), model: MODEL_FILE_RE.test(String(value)) });
    }
  }
  problems.missingNodes = [...missing.entries()].map(([classType, nodes]) => ({ classType, nodes }));
  return problems;
}

function boundKeys(bind: ComfyWorkflowBindings): Set<string> {
  const bound = new Set<string>();
  for (const slot of bind.inputs ?? []) bound.add(key(slot));
  for (const [field, value] of Object.entries(bind)) {
    if (field === "inputs") continue;
    const entry = value as { node: string; input?: string; also?: Slot[] } | undefined;
    if (!entry?.input) continue;
    bound.add(entry.node + "." + entry.input);
    for (const other of entry.also ?? []) bound.add(key(other));
  }
  return bound;
}

/**
 * The workflow's own settings, with the range or choices the server enforces,
 * so a client can offer a slider or a list instead of a free text box.
 */
export function describeParams(graph: ComfyGraph, bind: ComfyWorkflowBindings, info: ComfyObjectInfo): ComfyWorkflowParam[] {
  const bound = boundKeys(bind);
  const params: ComfyWorkflowParam[] = [];
  for (const slot of scalarSlots(graph, (node, input) => !bound.has(node + "." + input))) {
    const entry = graph[slot.node]!;
    const value = entry.inputs[slot.input] as string | number | boolean;
    const spec = inputSpec(info, entry.class_type, slot.input);
    const param: ComfyWorkflowParam = {
      name: entry.class_type + "." + slot.input, node: slot.node, input: slot.input,
      type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string", default: value,
    };
    if (typeof value === "number" && typeof spec?.options.min === "number") param.min = spec.options.min;
    if (typeof value === "number" && typeof spec?.options.max === "number") param.max = spec.options.max;
    if (spec?.choices && !spec.upload && spec.choices.length > 0 && spec.choices.every(isScalar)) param.options = spec.choices as Array<string | number | boolean>;
    params.push(param);
  }
  return params;
}
/** A file picker in the graph, and the role its file plays when the graph settles that. */
export interface MediaSlotCandidate {
  kind: "image" | "video" | "audio";
  node: string;
  input: string;
  classType: string;
  title?: string;
  /** Absent when a person must say, e.g. which of two images is the first frame. */
  role?: ComfyInputRole;
}

/**
 * Every input that takes an uploaded file. One image on a video workflow is the
 * frame it starts from and on an image workflow the image it edits; one video or
 * one audio file is the source. Two files of a kind are not told apart here.
 */
export function detectMediaSlots(graph: ComfyGraph, info: ComfyObjectInfo, mediaKind: ComfyMediaKind | undefined): MediaSlotCandidate[] {
  const found: MediaSlotCandidate[] = [];
  for (const slot of scalarSlots(graph, (node, input) => {
    const upload = inputSpec(info, graph[node]!.class_type, input)?.upload;
    return upload === "image" || upload === "video" || upload === "audio";
  })) {
    const entry = graph[slot.node]!;
    const kind = inputSpec(info, entry.class_type, slot.input)!.upload as MediaSlotCandidate["kind"];
    found.push({ kind, node: slot.node, input: slot.input, classType: entry.class_type, ...(entry._meta?.title ? { title: entry._meta.title } : {}) });
  }
  const masks = found.filter((slot) => slot.classType === "LoadImageMask");
  if (masks.length === 1) masks[0]!.role = "mask";
  const alone = (kind: MediaSlotCandidate["kind"]) => {
    const list = found.filter((slot) => slot.kind === kind && slot.classType !== "LoadImageMask");
    return list.length === 1 ? list[0]! : undefined;
  };
  const image = alone("image");
  if (image && mediaKind === "video") image.role = "first-frame";
  if (image && mediaKind === "image") image.role = "source-image";
  const video = alone("video");
  if (video) video.role = "source-video";
  const audio = alone("audio");
  if (audio) audio.role = "source-audio";
  return found;
}
