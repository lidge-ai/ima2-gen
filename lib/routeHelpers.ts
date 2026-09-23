import type { Response } from "express";
import { type RuntimeContext } from "./runtimeContext.js";
import { errorEnvelopeFields } from "./errors/envelope.js";
import { upstreamLabelFields } from "./diagnosticLabel.js";

export function validateModeration(ctx: RuntimeContext, moderation: unknown) {
  if (typeof moderation !== "string" || !ctx.config.oauth.validModeration.has(moderation)) {
    return { error: "moderation must be one of: auto, low" };
  }
  return { moderation };
}

export function imageFormatFromMime(mime: string | null | undefined): "png" | "jpeg" | "webp" {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export function writeSse(res: Response, event: string, data: unknown): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function dataUrlFromB64(format: string, b64: string) {
  return `data:image/${format === "jpeg" ? "jpeg" : format};base64,${b64}`;
}

export function upstreamErrorFields(src: Record<string, unknown>) {
  return {
    ...errorEnvelopeFields(src),
    ...upstreamLabelFields(src),
    diagnosticReason: src.diagnosticReason || null,
    retryKind: src.retryKind || null,
    initialEventCount: src.initialEventCount ?? null,
    initialEventTypes: src.initialEventTypes || null,
    hadReferences: src.hadReferences ?? null,
    referencesDroppedOnRetry: src.referencesDroppedOnRetry ?? null,
    developerPromptDroppedOnRetry: src.developerPromptDroppedOnRetry ?? null,
    webSearchDroppedOnRetry: src.webSearchDroppedOnRetry ?? null,
    fallbackEventCount: src.fallbackEventCount ?? null,
    fallbackEventTypes: src.fallbackEventTypes || null,
    fallbackImageCallSeen: src.fallbackImageCallSeen ?? null,
    fallbackImageResultCount: src.fallbackImageResultCount ?? null,
    errorEventCount: src.eventCount ?? null,
    eventTypes: src.eventTypes || null,
    webSearchCalls: src.webSearchCalls ?? null,
    responseDiagnostics: src.responseDiagnostics || null,
    toolTypes: src.toolTypes || null,
    toolChoiceKind: src.toolChoiceKind || null,
  };
}
