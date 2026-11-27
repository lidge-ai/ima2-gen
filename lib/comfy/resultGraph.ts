// lib/comfy/resultGraph.ts — a saved result as a ComfyUI graph.
//
// A result ComfyUI made is answered with the graph ComfyUI ran: the one inside the PNG it saved, or
// the one that server still holds in its history for that job. Nothing is rebuilt from a guess, so
// when neither exists the answer says why. A result from anywhere else becomes a two-node graph for
// the ima2 node pack that makes the same request again, set to spend nothing until a person allows it.
import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { extractComfyApiGraph, isPngBuffer } from "../comfyPngWorkflow.js";
import type { ComfyGraph } from "../comfyWorkflowStore.js";
import type { ComfyTarget } from "./access.js";
import { comfyFetch, redactForTarget } from "./client.js";

export const COMFY_GRAPH_ERROR = { INVALID: "COMFY_IMAGE_INVALID", NOT_FOUND: "COMFY_RESULT_NOT_FOUND", UNAVAILABLE: "COMFY_GRAPH_UNAVAILABLE" } as const;

export class ComfyResultGraphError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = "ComfyResultGraphError";
  }
}

export interface ResultGraph {
  /** Where the graph came from: inside the saved file, ComfyUI's job history, or built for the ima2 node pack. */
  source: "embedded" | "comfy-history" | "ima2-node";
  graph: ComfyGraph;
  /** What a person should know before running it. */
  notes: string[];
}

export interface ResultGraphInput {
  filename: unknown;
  generatedDir: string;
  timeoutMs: number;
  findWorkflow: (id: string) => Promise<{ origin: string } | null>;
  /** The allowed server for an origin, or null when it is not allowed any more. */
  resolveTarget: (origin: string) => Promise<ComfyTarget | null>;
  fetchImpl?: typeof fetch;
}

type Meta = Record<string, unknown>;
const COMFY_PREFIX = "comfy/";
const PACK_NOTE = "Needs the ima2 node pack in ComfyUI (ima2 for ComfyUI, comfyui-ima2) and ima2 running on the same computer.";
const BUDGET_NOTE = "max_usd is 0, so a paid model is refused until you raise it on the node: nothing is billed by opening or queueing this graph as it is.";

const unavailable = (message: string) => new ComfyResultGraphError(COMFY_GRAPH_ERROR.UNAVAILABLE, message, 409);
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const record = (value: unknown): Meta => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Meta : {});

function safeName(filename: unknown): string {
  const invalid = () => new ComfyResultGraphError(COMFY_GRAPH_ERROR.INVALID, "A saved result's filename is required, without a folder.", 400);
  if (typeof filename !== "string" || !filename.trim()) throw invalid();
  let decoded: string;
  try { decoded = decodeURIComponent(filename); } catch { throw invalid(); }
  if (isAbsolute(filename) || filename !== basename(filename) || /[\\/]|\.\.|^[a-z][a-z0-9+.-]*:/i.test(decoded)) throw invalid();
  return filename;
}

async function readResult(dir: string, filename: unknown): Promise<{ bytes: Buffer; meta: Meta | null }> {
  const name = safeName(filename);
  const missing = () => new ComfyResultGraphError(COMFY_GRAPH_ERROR.NOT_FOUND, "That result was not found.", 404);
  const path = join(dir, name);
  await access(path, fsConstants.F_OK).catch(() => { throw missing(); });
  const [root, real] = await Promise.all([realpath(dir), realpath(path)]);
  const inside = relative(root, real);
  if (!inside || inside.startsWith("..") || isAbsolute(inside) || !(await stat(real)).isFile()) throw missing();
  const meta = await readFile(real + ".json", "utf8").then((raw) => record(JSON.parse(raw) as unknown), () => null);
  return { bytes: await readFile(real), meta };
}

const NODES = {
  image: { node: "Ima2MediaImage", title: "ima2 Image", save: { class_type: "SaveImage", _meta: { title: "Save Image" }, inputs: { images: ["1", 0], filename_prefix: "ima2" } } },
  video: { node: "Ima2MediaVideo", title: "ima2 Video", save: { class_type: "SaveVideo", _meta: { title: "Save Video" }, inputs: { video: ["1", 0], filename_prefix: "video/ima2", format: "auto", "format.codec": "auto" } } },
  audio: { node: "Ima2MediaAudio", title: "ima2 Audio", save: { class_type: "SaveAudioMP3", _meta: { title: "Save Audio (MP3)" }, inputs: { audio: ["1", 0], filename_prefix: "audio/ima2", quality: "V0" } } },
} as const;

/** The request a media result recorded, as one ima2 node and a save node. Settings the result did not use are left out. */
export function ima2NodeGraph(meta: Meta): { graph: ComfyGraph; notes: string[] } {
  const kind = meta.mediaType === "video" || meta.mediaType === "audio" ? meta.mediaType : "image";
  const media = record(meta.media);
  const seed = typeof media.seed === "number" ? media.seed : null;
  const inputs: Record<string, unknown> = { model: text(meta.model) ?? "", prompt: text(meta.prompt) ?? "", max_usd: 0, seed: seed ?? 0, send_seed: seed === null ? "no" : "yes" };
  const optional: Array<[string, unknown]> = [["route", text(meta.adapter)], ["task", text(media.task)], ["resolution", text(media.resolution)], ["aspect_ratio", text(media.aspectRatio)]];
  if (kind !== "image" && typeof media.durationSec === "number") optional.push(["duration", media.durationSec]);
  if (kind === "video" && typeof media.audio === "boolean") optional.push(["audio", media.audio ? "on" : "off"]);
  for (const [key, value] of optional) if (value !== undefined) inputs[key] = value;
  const spec = NODES[kind];
  const roles = Array.isArray(media.inputRoles) ? media.inputRoles.filter((role): role is string => typeof role === "string") : [];
  return {
    graph: { "1": { class_type: spec.node, _meta: { title: spec.title }, inputs }, "2": structuredClone(spec.save) } as unknown as ComfyGraph,
    notes: [PACK_NOTE, BUDGET_NOTE, ...(roles.length > 0 ? ["The result used input files (" + roles.join(", ") + "). They are not part of the graph: connect them to the node's inputs."] : [])],
  };
}

/** ima2's own image lane has no catalog model: the original node of the pack repeats it. */
function classicNodeGraph(meta: Meta): { graph: ComfyGraph; notes: string[] } {
  const quality = text(meta.quality);
  const inputs = { prompt: text(meta.userPrompt) ?? text(meta.prompt) ?? "", server_url: "", quality: quality === "low" || quality === "high" ? quality : "medium",
    size: /^\d{3,5}x\d{3,5}$/.test(text(meta.size) ?? "") ? meta.size : "1024x1024", moderation: "low", timeout: 180 };
  return {
    graph: { "1": { class_type: "Ima2Generate", _meta: { title: "Ima2 Generate" }, inputs }, "2": structuredClone(NODES.image.save) } as unknown as ComfyGraph,
    notes: [PACK_NOTE, "This repeats the request through ima2's own image lane, with the account signed in there."],
  };
}

async function fromHistory(input: ResultGraphInput, meta: Meta): Promise<ComfyGraph> {
  const workflowId = (text(meta.model) ?? "").slice(COMFY_PREFIX.length);
  const jobId = text(meta.providerJobId);
  if (!jobId) throw unavailable("This result has no ComfyUI job id recorded, so its graph cannot be looked up.");
  const workflow = await input.findWorkflow(workflowId);
  if (!workflow) throw unavailable("The workflow '" + workflowId + "' is no longer registered, so the server that ran this result is not known.");
  const target = await input.resolveTarget(workflow.origin);
  if (!target) throw unavailable("The ComfyUI server " + workflow.origin + " is not in the allowed servers any more.");
  let history: Meta;
  try {
    const response = await comfyFetch(target, input.fetchImpl ?? fetch, "/history/" + encodeURIComponent(jobId), { signal: AbortSignal.timeout(input.timeoutMs) });
    history = record(await response.json() as unknown);
  } catch (error) {
    throw unavailable("ComfyUI at " + target.origin + " did not answer (" + redactForTarget(target, error instanceof Error ? error.message : "unknown error") + "), and only it holds this result's graph.");
  }
  // History keeps the queue entry: [number, id, graph, extra, outputs].
  const queued = record(history[jobId]).prompt;
  const graph = Array.isArray(queued) ? record(queued[2]) : {};
  if (Object.keys(graph).length === 0) {
    throw unavailable("ComfyUI at " + target.origin + " no longer has job " + jobId + " in its history (it is cleared when ComfyUI restarts), and a video or audio file does not carry its graph.");
  }
  return graph as ComfyGraph;
}

export async function resultGraph(input: ResultGraphInput): Promise<ResultGraph> {
  const { bytes, meta } = await readResult(input.generatedDir, input.filename);
  // An image ComfyUI saved carries the graph it ran, whichever lane asked for it.
  const embedded = isPngBuffer(bytes) ? extractComfyApiGraph(bytes) : null;
  if (embedded) return { source: "embedded", graph: embedded, notes: ["This is the graph ComfyUI ran for this image, with the values it used."] };
  if (!meta) throw unavailable("Nothing was recorded about how this file was made, so there is no request to turn into a graph.");
  if ((text(meta.model) ?? "").startsWith(COMFY_PREFIX)) {
    return { source: "comfy-history", graph: await fromHistory(input, meta), notes: ["This is the graph ComfyUI ran for this result, read from that server's job history."] };
  }
  if (meta.generator === "media") return { source: "ima2-node", ...ima2NodeGraph(meta) };
  if (isPngBuffer(bytes) || meta.mediaType === "image" || meta.mediaType === undefined) return { source: "ima2-node", ...classicNodeGraph(meta) };
  throw unavailable("This result did not come through a route the ima2 nodes can repeat.");
}

