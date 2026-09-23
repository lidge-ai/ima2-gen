/**
 * The portable node-template file: one JSON document that carries a template's
 * shape to another machine. Templates live in each machine's SQLite, so without
 * this a hand-built template cannot leave the machine it was made on.
 *
 * This is a file boundary. Imported files are untrusted: every node, edge and data
 * field is rebuilt from an allowlist, because React Flow applies node-level keys
 * such as style, className and domAttributes straight to the DOM. Error messages
 * are fixed text and never echo file content.
 */

import type { NodeTemplateGraph, NodeTemplateRecord } from "./nodeTemplateStore.js";

export const TEMPLATE_FILE_KIND = "ima2.node-template";
export const TEMPLATE_FILE_VERSION = 1;
export const TEMPLATE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const FILE_MAX_NODES = 300;
const FILE_MAX_EDGES = 1200;
const MAX_DEPTH = 16;
const MAX_NAME_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 2000;
const MAX_TAGS = 20;
const MAX_TAG_CHARS = 40;
const MAX_ID_CHARS = 128;
const MAX_POSITION = 100_000;
const MAX_NODE_SIZE = 4000;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

export interface TemplateFileLimits { maxNodes: number; maxEdges: number }

export interface TemplateFile {
  kind: typeof TEMPLATE_FILE_KIND;
  version: typeof TEMPLATE_FILE_VERSION;
  exportedAt: number;
  /** Informational only; imports always get a new id. */
  sourceId?: string | undefined;
  name: string;
  description: string;
  tags: string[];
  graph: NodeTemplateGraph;
}

export interface ParsedTemplateFile { name: string; description: string; tags: string[]; graph: NodeTemplateGraph }

const MESSAGES = {
  TEMPLATE_FILE_INVALID: "template file is not a valid template document",
  TEMPLATE_FILE_KIND: "file is not an ima2 node template",
  TEMPLATE_FILE_VERSION: "unsupported template file version",
  TEMPLATE_FILE_TOO_LARGE: "template file is too large",
  INVALID_TEMPLATE_NAME: "template name must be 1-80 characters",
  INVALID_TEMPLATE_GRAPH: "template graph is not valid",
} as const;
export type TemplateFileErrorCode = keyof typeof MESSAGES;

export class TemplateFileError extends Error {
  readonly status: number;
  readonly code: TemplateFileErrorCode;
  constructor(status: number, code: TemplateFileErrorCode) {
    super(MESSAGES[code]);
    this.status = status;
    this.code = code;
  }
}

const invalidGraph = () => new TemplateFileError(400, "INVALID_TEMPLATE_GRAPH");

export function templateFileLimits(caps: { graphMaxNodes?: number; graphMaxEdges?: number } = {}): TemplateFileLimits {
  return {
    maxNodes: Math.min(FILE_MAX_NODES, caps.graphMaxNodes ?? FILE_MAX_NODES),
    maxEdges: Math.min(FILE_MAX_EDGES, caps.graphMaxEdges ?? FILE_MAX_EDGES),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && Array.from(value).length <= max ? value : undefined;
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function boundedInteger(value: unknown, min: number, max: number): number | undefined {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : undefined;
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

/**
 * Walks the parsed document with an explicit stack before anything recursive
 * (clone, stringify) touches it: deep nesting would otherwise overflow the stack.
 */
function assertSafeShape(root: unknown): void {
  const stack: Array<[unknown, number]> = [[root, 0]];
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;
    if (typeof value !== "object" || value === null) continue;
    if (depth > MAX_DEPTH) throw invalidGraph();
    const children = Array.isArray(value) ? value : Object.values(value);
    if (!Array.isArray(value) && Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key))) throw invalidGraph();
    for (const child of children) stack.push([child, depth + 1]);
  }
}

function portableVideo(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const video: Record<string, unknown> = {};
  put(video, "duration", boundedNumber(value.duration, 0, 600));
  for (const key of ["resolution", "aspectRatio", "topic"]) put(video, key, boundedString(value[key], 80));
  return Object.keys(video).length > 0 ? video : undefined;
}

function portableMedia(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value) || value.unresolved !== true) return undefined;
  const placeholder = boundedString(value.placeholder, 80);
  return placeholder ? { placeholder, unresolved: true } : undefined;
}

/**
 * Rebuilds node data from an allowlist, so runtime ids, media URLs, filenames,
 * secrets and any field added later never cross the boundary by default.
 */
function portableNodeData(data: Record<string, unknown>, element: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, max] of [["kind", 40], ["nodeType", 40], ["prompt", 20000], ["provider", 80], ["model", 120],
    ["size", 40], ["style", 40], ["elementName", 120]] as const) {
    put(out, key, boundedString(data[key], max));
  }
  if (typeof data.reasoningEffort === "string" && REASONING_EFFORTS.has(data.reasoningEffort)) out.reasoningEffort = data.reasoningEffort;
  put(out, "variation", boundedInteger(data.variation, 1, 16));
  put(out, "video", portableVideo(data.video));
  put(out, "media", portableMedia(data.media));
  out.status = "idle";
  if (element) {
    out.refCount = boundedInteger(data.refCount, 0, 100) ?? 0;
    out.missing = true;
  }
  return out;
}

type Mode = "strict" | "lenient";

function nodeId(value: unknown, mode: Mode, fallback: string): string {
  const id = boundedString(value, MAX_ID_CHARS);
  if (id) return id;
  if (mode === "strict") throw invalidGraph();
  return fallback;
}

function portablePosition(value: unknown, mode: Mode): { x: number; y: number } {
  const x = isPlainObject(value) ? boundedNumber(value.x, -MAX_POSITION, MAX_POSITION) : undefined;
  const y = isPlainObject(value) ? boundedNumber(value.y, -MAX_POSITION, MAX_POSITION) : undefined;
  if (x !== undefined && y !== undefined) return { x, y };
  if (mode === "strict") throw invalidGraph();
  return { x: 0, y: 0 };
}

function portableNode(raw: unknown, index: number, mode: Mode): NodeTemplateGraph["nodes"][number] {
  if (!isPlainObject(raw)) throw invalidGraph();
  if (raw.data !== undefined && !isPlainObject(raw.data)) {
    if (mode === "strict") throw invalidGraph();
  }
  const data = isPlainObject(raw.data) ? raw.data : {};
  const element = raw.type === "elementReferenceNode" || data.nodeType === "element-reference";
  const node: NodeTemplateGraph["nodes"][number] = {
    id: nodeId(raw.id, mode, `node-${index + 1}`),
    type: element ? "elementReferenceNode" : "imageNode",
    position: portablePosition(raw.position, mode),
    data: portableNodeData(data, element),
  };
  put(node, "width", boundedNumber(raw.width, 1, MAX_NODE_SIZE));
  put(node, "height", boundedNumber(raw.height, 1, MAX_NODE_SIZE));
  return node;
}

function portableEdge(raw: unknown, index: number, mode: Mode): NodeTemplateGraph["edges"][number] {
  if (!isPlainObject(raw)) throw invalidGraph();
  const source = boundedString(raw.source, MAX_ID_CHARS);
  const target = boundedString(raw.target, MAX_ID_CHARS);
  if (!source || !target) throw invalidGraph();
  const edge: NodeTemplateGraph["edges"][number] = { id: nodeId(raw.id, mode, `edge-${index + 1}`), source, target };
  for (const key of ["sourceHandle", "targetHandle"] as const) {
    const handle = raw[key] === null ? null : boundedString(raw[key], 64);
    if (handle !== undefined) edge[key] = handle;
  }
  put(edge, "label", boundedString(raw.label, 80));
  return edge;
}

function portableViewport(value: unknown): NodeTemplateGraph["viewport"] {
  if (!isPlainObject(value)) return undefined;
  const x = boundedNumber(value.x, -MAX_POSITION, MAX_POSITION);
  const y = boundedNumber(value.y, -MAX_POSITION, MAX_POSITION);
  const zoom = boundedNumber(value.zoom, 0.05, 8);
  return x !== undefined && y !== undefined && zoom !== undefined ? { x, y, zoom } : undefined;
}

function portableManifest(value: unknown): NodeTemplateGraph["manifest"] {
  if (!isPlainObject(value) || !Array.isArray(value.requiredPlaceholders) || value.requiredPlaceholders.length > 50) return undefined;
  const requiredPlaceholders = value.requiredPlaceholders.map((entry) => boundedString(entry, 80));
  const expectedTerminalResults = boundedInteger(value.expectedTerminalResults, 0, 1000);
  if (requiredPlaceholders.some((entry) => entry === undefined) || expectedTerminalResults === undefined) return undefined;
  return { requiredPlaceholders: requiredPlaceholders as string[], expectedTerminalResults };
}

/**
 * The graph that crosses the file boundary, rebuilt from allowlists. Strict mode
 * (import) rejects structural problems; lenient mode (export of an already-stored
 * template) substitutes safe defaults.
 */
export function portableTemplateGraph(graph: unknown, mode: Mode): NodeTemplateGraph {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw invalidGraph();
  const result: NodeTemplateGraph = {
    nodes: graph.nodes.map((node, index) => portableNode(node, index, mode)),
    edges: graph.edges.map((edge, index) => portableEdge(edge, index, mode)),
  };
  const viewport = portableViewport(graph.viewport);
  const manifest = portableManifest(graph.manifest);
  if (viewport) result.viewport = viewport;
  if (manifest) result.manifest = manifest;
  return result;
}

function assertGraphStructure(graph: NodeTemplateGraph): void {
  const nodeIds = graph.nodes.map((node) => node.id);
  const edgeIds = graph.edges.map((edge) => edge.id);
  if (new Set(nodeIds).size !== nodeIds.length || new Set(edgeIds).size !== edgeIds.length) throw invalidGraph();
  const known = new Set(nodeIds);
  if (graph.edges.some((edge) => !known.has(edge.source) || !known.has(edge.target))) throw invalidGraph();
  if (hasCycle(nodeIds, graph.edges)) throw invalidGraph();
}

/** Kahn's algorithm: any node left unvisited sits on a cycle. */
function hasCycle(nodeIds: string[], edges: NodeTemplateGraph["edges"]): boolean {
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const edge of edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const queue = nodeIds.filter((id) => indegree.get(id) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.pop()!;
    visited += 1;
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return visited < nodeIds.length;
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value.map((tag) => typeof tag === "string" ? tag.trim() : "")
    .filter((tag) => tag.length > 0 && Array.from(tag).length <= MAX_TAG_CHARS);
  return [...new Set(tags)].slice(0, MAX_TAGS);
}

export function parseTemplateFile(raw: unknown, limits: TemplateFileLimits = templateFileLimits()): ParsedTemplateFile {
  if (!isPlainObject(raw)) throw new TemplateFileError(400, "TEMPLATE_FILE_INVALID");
  assertSafeShape(raw);
  if (raw.kind !== TEMPLATE_FILE_KIND) throw new TemplateFileError(400, "TEMPLATE_FILE_KIND");
  if (raw.version !== TEMPLATE_FILE_VERSION) throw new TemplateFileError(400, "TEMPLATE_FILE_VERSION");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || Array.from(name).length > MAX_NAME_CHARS) throw new TemplateFileError(400, "INVALID_TEMPLATE_NAME");
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (Array.from(description).length > MAX_DESCRIPTION_CHARS) throw new TemplateFileError(400, "TEMPLATE_FILE_INVALID");
  const graph = raw.graph;
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw invalidGraph();
  if (graph.nodes.length === 0) throw invalidGraph();
  if (graph.nodes.length > limits.maxNodes || graph.edges.length > limits.maxEdges) {
    throw new TemplateFileError(413, "TEMPLATE_FILE_TOO_LARGE");
  }
  const portable = portableTemplateGraph(graph, "strict");
  assertGraphStructure(portable);
  return { name, description, tags: parseTags(raw.tags), graph: portable };
}

export function buildTemplateFile(template: NodeTemplateRecord): TemplateFile {
  return {
    kind: TEMPLATE_FILE_KIND,
    version: TEMPLATE_FILE_VERSION,
    exportedAt: Date.now(),
    sourceId: template.id,
    name: template.name,
    description: template.description,
    tags: [...template.tags],
    graph: portableTemplateGraph(template.graph, "lenient"),
  };
}

/** ASCII download name. Đ/đ do not decompose under NFD, so they are mapped by hand. */
export function templateFileName(name: string): string {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[Đđ]/g, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 80).replace(/-+$/g, "");
  return `${slug || "template"}.ima2-template.json`;
}

/** A name no existing template uses; counts code points so a suffix never splits a character. */
export function uniqueTemplateName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((entry) => entry.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  const chars = Array.from(name);
  const withSuffix = (suffix: string) => chars.slice(0, MAX_NAME_CHARS - suffix.length).join("") + suffix;
  for (let index = 2; index < 100; index += 1) {
    const candidate = withSuffix(` (${index})`);
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return withSuffix(` (${Date.now().toString(36)})`);
}
