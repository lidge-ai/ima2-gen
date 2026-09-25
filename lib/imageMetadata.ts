import type { CodedError } from "./errInfo.js";
export const IMA2_METADATA_SCHEMA = "ima2.generation.v1";
export const IMA2_XMP_NAMESPACE = "https://github.com/lidge-ai/ima2-gen/ns/1.0/";
export const IMA2_XMP_PROPERTY = "GenerationMetadata";
export const MAX_EMBEDDED_METADATA_CHARS = 64 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown, max = 4000) {
  if (typeof value !== "string") return null;
  return value.slice(0, max);
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function xmlEscape(value: unknown) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlUnescape(value: unknown) {
  return String(value)
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export interface MetadataContext {
  version?: unknown;
}

export function buildIma2MetadataPayload(metaInput: unknown = {}, context: MetadataContext = {}) {
  const meta: Record<string, unknown> = isPlainObject(metaInput) ? metaInput : {};
  const payload = {
    schema: IMA2_METADATA_SCHEMA,
    app: "ima2-gen",
    version: stringOrNull(context.version, 80) || null,
    createdAt: numberOrNull(meta.createdAt) || Date.now(),
    kind: stringOrNull(meta.kind, 80),
    canvasVersion: Boolean(meta.canvasVersion),
    canvasSourceFilename: stringOrNull(meta.canvasSourceFilename, 240),
    canvasEditableFilename: stringOrNull(meta.canvasEditableFilename, 240),
    canvasMergedAt: numberOrNull(meta.canvasMergedAt),
    annotationsBaked: Boolean(meta.annotationsBaked),
    annotationSnapshot: isPlainObject(meta.annotationSnapshot) ? meta.annotationSnapshot : null,
    annotationOnly: Boolean(meta.annotationOnly),
    prompt: stringOrNull(meta.prompt),
    userPrompt: stringOrNull(meta.userPrompt) || stringOrNull(meta.prompt),
    revisedPrompt: stringOrNull(meta.revisedPrompt),
    promptMode: meta.promptMode === "direct" ? "direct" : "auto",
    quality: stringOrNull(meta.quality, 40),
    size: stringOrNull(meta.size, 40),
    format: stringOrNull(meta.format, 20),
    moderation: stringOrNull(meta.moderation, 40),
    model: stringOrNull(meta.model, 80),
    ...(meta.provider === "api" && meta.imageToolModel ? { imageToolModel: stringOrNull(meta.imageToolModel, 80) } : {}),
    reasoningEffort: stringOrNull(meta.reasoningEffort, 40),
    elapsed: numberOrNull(meta.elapsed),
    provider: stringOrNull(meta.provider, 40),
    sessionId: stringOrNull(meta.sessionId, 120),
    nodeId: stringOrNull(meta.nodeId, 120),
    parentNodeId: stringOrNull(meta.parentNodeId, 120),
    clientNodeId: stringOrNull(meta.clientNodeId, 120),
    requestId: stringOrNull(meta.requestId, 160),
    refsCount: numberOrNull(meta.refsCount) ?? 0,
    webSearchCalls: numberOrNull(meta.webSearchCalls) ?? 0,
    styleSheetApplied: Boolean(meta.styleSheetApplied),
    presetIds: stringArray(meta.presetIds),
    elementIds: stringArray(meta.elementIds),
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

export function normalizeEmbeddedMetadata(value: unknown) {
  if (!isPlainObject(value)) return null;
  if (value.schema !== IMA2_METADATA_SCHEMA || value.app !== "ima2-gen") return null;
  return buildIma2MetadataPayload(value, { version: value.version });
}

export function buildIma2Xmp(metadataPayload: unknown) {
  const normalized = normalizeEmbeddedMetadata(metadataPayload);
  if (!normalized) {
    const err: CodedError = new Error("Invalid ima2 metadata payload");
    err.code = "IMAGE_METADATA_INVALID";
    throw err;
  }
  const json = JSON.stringify(normalized);
  if (json.length > MAX_EMBEDDED_METADATA_CHARS) {
    const err: CodedError = new Error("ima2 metadata payload is too large");
    err.code = "IMAGE_METADATA_TOO_LARGE";
    throw err;
  }
  const escaped = xmlEscape(json);
  return [
    "<?xpacket begin=\"﻿\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>",
    "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">",
    "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">",
    `<rdf:Description xmlns:ima2="${IMA2_XMP_NAMESPACE}" ima2:${IMA2_XMP_PROPERTY}="${escaped}"/>`,
    "</rdf:RDF>",
    "</x:xmpmeta>",
    "<?xpacket end=\"w\"?>",
  ].join("");
}

export function parseIma2Xmp(xmpString: unknown) {
  if (typeof xmpString !== "string" || xmpString.length === 0) return null;
  const attrPattern = new RegExp(`ima2:${IMA2_XMP_PROPERTY}="([^"]*)"`);
  const attrMatch = attrPattern.exec(xmpString);
  const raw = attrMatch?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(xmlUnescape(raw));
    return normalizeEmbeddedMetadata(parsed);
  } catch {
    return null;
  }
}
