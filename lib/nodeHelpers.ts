import type { Request, Response } from "express";
import { loadNodeB64, loadNodeMeta } from "./nodeStore.js";
import { detectImageMimeFromB64 } from "./refs.js";
import type { GrokReferenceImage } from "./grokImageAdapter.js";
import type { UpstreamErr } from "./generationErrors.js";
import type { RuntimeContext } from "./runtimeContext.js";
import { writeSse } from "./routeHelpers.js";
import { publishJobEvent } from "./ssePublish.js";
import { errorEnvelopeFields } from "./errors/envelope.js";
import { safeDiagnosticLabel } from "./diagnosticLabel.js";
import type { NaiRequestOptions } from "./naiOptions.js";

/**
 * The NovelAI tuning fields ride along here so the node lane has the same
 * typed surface as /api/generate. readNaiOptions() still validates them at
 * dispatch; this stops the next contributor from re-adding a private ladder.
 */
export interface NodeGenerateBody extends Partial<NaiRequestOptions> {
  prompt?: string;
  parentNodeId?: string;
  /** Cha phu: chi lay ANH cua tung node lam tham chieu, khong phai anh goc dem di sua. */
  extraParentNodeIds?: unknown;
  requestId?: string;
  sessionId?: string;
  clientNodeId?: string;
  references?: unknown;
  quality?: string;
  size?: string;
  format?: string;
  moderation?: string;
  externalSrc?: string | null;
  mode?: string;
  contextMode?: string;
  searchMode?: string;
  model?: string;
  imageToolModel?: unknown;
  reasoningEffort?: string;
  provider?: string;
  webSearchEnabled?: boolean;
  async?: boolean;
  elementIds?: unknown;
  elementRevisions?: unknown;
  elementNotes?: unknown;
}

export function asUpstream(e: unknown): UpstreamErr {
  return (e && typeof e === "object" ? e : {}) as UpstreamErr;
}

export function wantsSse(req: Request) {
  const accept = typeof req.headers.accept === "string" ? req.headers.accept : "";
  return accept.includes("text/event-stream");
}

export function writeNodeError(
  res: Response,
  status: number,
  code: string,
  message: string,
  parentNodeId: string | null,
  details: Record<string, unknown> = {},
  requestId?: string,
) {
  const { rawCode: _rawCode, errorClass: _errorClass, ...payloadDetails } = details;
  const payload = {
    error: { code, message, ...errorEnvelopeFields({ ...details, code, status }) },
    parentNodeId,
    status,
    ...payloadDetails,
  };
  if (requestId) {
    // #151 stage 2: node-mode terminal failure carries the canonical envelope.
    // The bus record flattens code/error to top-level strings because
    // buildEnvelope's errorFromData/resolvePhase read data.code / data.error as
    // strings — the nested shape would stamp every node error "failed" and drop
    // envelope.error (cancel/timeout classification depends on data.code).
    publishJobEvent(requestId, "error", { ...payload, code, error: message });
  }
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) {
    writeSse(res, "error", payload);
    res.end();
    return;
  }
  res.status(status).json(payload);
}

export async function loadParentNodeB64(ctx: RuntimeContext, nodeId: string) {
  for (const ext of ["png", "jpeg", "webp"] as const) {
    const meta = await loadNodeMeta(ctx.rootDir, nodeId, ext, ctx.config.storage.generatedDir);
    if (meta) return loadNodeB64(ctx.rootDir, `${nodeId}.${ext}`, ctx.config.storage.generatedDir);
  }
  return loadNodeB64(ctx.rootDir, `${nodeId}.png`, ctx.config.storage.generatedDir);
}

export function toGrokReferences(parentB64: string | null, refs: Array<GrokReferenceImage | string>): GrokReferenceImage[] {
  const parentMime = parentB64 ? detectImageMimeFromB64(parentB64) : null;
  const parentRefs = parentB64
    ? [{ b64: parentB64, declaredMime: parentMime, detectedMime: parentMime }]
    : [];
  const normalizedRefs = refs.map((ref) => typeof ref === "string" ? { b64: ref } : ref);
  return [...parentRefs, ...normalizedRefs];
}

/**
 * Upstream code and type for node error envelopes and the final_error log, passed
 * through the diagnostic label filter. Some paths (the OAuth passthrough) carry the
 * provider's raw code and type, so these are filtered where they are emitted.
 */
export function finalErrorUpstreamLabels(lastErr: UpstreamErr | null | undefined) {
  return {
    upstreamCode: safeDiagnosticLabel(lastErr?.upstreamCode || lastErr?.code),
    upstreamType: safeDiagnosticLabel(lastErr?.upstreamType),
  };
}

export function nodeErrorDetails(finalErr: Record<string, unknown>, lastErr: UpstreamErr | null) {
  return {
    // The normalized error carries the provider identity that 061 attached;
    // without copying it here the nested Node envelope loses both fields even
    // though writeNodeError knows how to nest them.
    ...errorEnvelopeFields(finalErr),
    ...finalErrorUpstreamLabels(lastErr),
    upstreamParam: safeDiagnosticLabel(lastErr?.upstreamParam),
    errorEventType: lastErr?.eventType || null,
    errorEventCount: lastErr?.eventCount ?? null,
    diagnosticReason: finalErr.diagnosticReason || lastErr?.diagnosticReason || null,
    retryKind: finalErr.retryKind || lastErr?.retryKind || null,
    referencesDroppedOnRetry: finalErr.referencesDroppedOnRetry ?? lastErr?.referencesDroppedOnRetry ?? null,
    refsCount: finalErr.refsCount ?? lastErr?.refsCount ?? null,
    inputImageCount: finalErr.inputImageCount ?? lastErr?.inputImageCount ?? null,
  };
}
