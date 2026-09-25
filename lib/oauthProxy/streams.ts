import { setJobPhase } from "../inflight.js";
import { logEvent } from "../logger.js";
import { makeOAuthError } from "./errors.js";

import { errInfo } from "../errInfo.js";
export function extractSseData(block: string): string {
  let eventData = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("data: ")) eventData += line.slice(6);
  }
  return eventData;
}

interface SseImageData {
  type?: string;
  partial_image?: string;
  image?: string;
  result?: string;
  index?: number;
  item?: {
    type?: string;
    partial_image?: string;
    image?: string;
    result?: string;
    revised_prompt?: string;
    index?: number;
  };
  error?: { code?: string };
  response?: {
    usage?: unknown;
    tool_usage?: { web_search?: { num_requests?: number } };
  };
}

export interface PartialImage {
  b64: string;
  index: number | null | undefined;
  eventType: string;
}

export function extractPartialImage(data: SseImageData | null | undefined): PartialImage | null {
  if (!data || typeof data?.type !== "string" || !data.type.includes("partial")) return null;
  const item = data.item || {};
  const b64 =
    data.partial_image ||
    data.image ||
    data.result ||
    item.partial_image ||
    item.image ||
    item.result;
  if (typeof b64 !== "string" || b64.length === 0) return null;
  const index =
    Number.isFinite(data.index) ? data.index :
      Number.isFinite(item.index) ? item.index :
        null;
  return { b64, index, eventType: data.type };
}

export async function readImageStream(res: Response, { requestId = null, scope = "oauth", onPartialImage = null as ((p: PartialImage) => void) | null | undefined }: { requestId?: string | null; scope?: string; onPartialImage?: ((p: PartialImage) => void) | null | undefined } = {}) {
  const eventTypes: Record<string, number> = {};
  let parseSkipCount = 0;
  if (!res.body) throw makeOAuthError("OAuth response missing body", { code: "OAUTH_NO_BODY" });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let imageB64: string | null = null;
  let usage: unknown = null;
  let webSearchCalls = 0;
  let eventCount = 0;
  let revisedPrompt: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const eventData = extractSseData(block);
      if (!eventData || eventData === "[DONE]") continue;

      try {
        const data = JSON.parse(eventData) as SseImageData;
        eventCount++;
        const t = typeof data.type === "string" ? data.type : "_unknown";
        eventTypes[t] = (eventTypes[t] || 0) + 1;

        const partial = extractPartialImage(data);
        if (partial) {
          logEvent(scope, "partial", {
            requestId,
            index: partial.index,
            imageChars: partial.b64.length,
            eventType: partial.eventType,
          });
          if (requestId) setJobPhase(requestId, "partial");
          if (typeof onPartialImage === "function") onPartialImage(partial);
        }
        if (data.type === "response.output_item.done" && data.item?.type === "image_generation_call") {
          if (data.item.result) {
            const imageB64Local: string = data.item.result;
            imageB64 = imageB64Local;
            logEvent(scope, "image", { requestId, imageChars: imageB64.length });
            if (requestId) setJobPhase(requestId, "decoding");
          }
          if (typeof data.item.revised_prompt === "string" && data.item.revised_prompt.length) {
            revisedPrompt = data.item.revised_prompt;
          }
        }
        if (data.type === "response.output_item.done" && data.item?.type === "web_search_call") {
          webSearchCalls += 1;
        }
        if (data.type === "response.completed") {
          usage = data.response?.usage || null;
          const wsNum = data.response?.tool_usage?.web_search?.num_requests;
          if (typeof wsNum === "number" && wsNum > webSearchCalls) webSearchCalls = wsNum;
        }
        if (data.type === "error") {
          const code = data.error?.code || "OAUTH_STREAM_ERROR";
          logEvent(scope, "stream_error", { requestId, code, eventType: data.type, eventCount });
          throw makeOAuthError("OAuth stream returned an error", {
            code,
            eventType: data.type,
            eventCount,
          });
        }
      } catch (e) {
        const err = errInfo(e);
        if (err.message && !err.message.startsWith("Unexpected")) throw e;
        parseSkipCount++;
      }
    }
  }

  if (parseSkipCount > 0) {
    logEvent(scope, "parse_skip", { requestId, count: parseSkipCount });
  }

  return { imageB64, usage, webSearchCalls, revisedPrompt, eventCount, eventTypes };
}

export async function readMultimodeImageStream(
  res: Response,
  { requestId = null, maxImages = 1, scope = "oauth-multimode", onPartialImage = null as ((p: PartialImage) => void) | null | undefined }: { requestId?: string | null; maxImages?: number; scope?: string; onPartialImage?: ((p: PartialImage) => void) | null | undefined } = {},
) {
  const eventTypes: Record<string, number> = {};
  let parseSkipCount = 0;
  if (!res.body) throw makeOAuthError("OAuth response missing body", { code: "OAUTH_NO_BODY" });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const images: Array<{ b64: string; revisedPrompt: string | null; index?: number }> = [];
  let usage: unknown = null;
  let webSearchCalls = 0;
  let eventCount = 0;
  const limit = Math.max(1, Math.trunc(Number(maxImages) || 1));
  let extraIgnored = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const eventData = extractSseData(block);
      if (!eventData || eventData === "[DONE]") continue;

      try {
        const data = JSON.parse(eventData) as SseImageData;
        eventCount++;
        const t = typeof data.type === "string" ? data.type : "_unknown";
        eventTypes[t] = (eventTypes[t] || 0) + 1;

        const partial = extractPartialImage(data);
        if (partial) {
          logEvent(scope, "partial", {
            requestId,
            index: partial.index,
            imageChars: partial.b64.length,
            eventType: partial.eventType,
          });
          if (requestId) setJobPhase(requestId, "partial");
          if (typeof onPartialImage === "function") onPartialImage(partial);
        }
        if (data.type === "response.output_item.done" && data.item?.type === "image_generation_call") {
          if (data.item.result) {
            if (images.length < limit) {
              images.push({
                b64: data.item.result,
                revisedPrompt:
                  typeof data.item.revised_prompt === "string" && data.item.revised_prompt.length
                    ? data.item.revised_prompt
                    : null,
              });
              logEvent(scope, "image", { requestId, imageChars: data.item.result.length, index: images.length });
              if (requestId) setJobPhase(requestId, "decoding");
            } else {
              extraIgnored += 1;
              logEvent(scope, "extra_ignored", { requestId, maxImages: limit });
            }
          }
        }
        if (data.type === "response.output_item.done" && data.item?.type === "web_search_call") {
          webSearchCalls += 1;
        }
        if (data.type === "response.completed") {
          usage = data.response?.usage || null;
          const wsNum = data.response?.tool_usage?.web_search?.num_requests;
          if (typeof wsNum === "number" && wsNum > webSearchCalls) webSearchCalls = wsNum;
        }
        if (data.type === "error") {
          const code = data.error?.code || "OAUTH_STREAM_ERROR";
          logEvent(scope, "stream_error", { requestId, code, eventType: data.type, eventCount });
          throw makeOAuthError("OAuth stream returned an error", {
            code,
            eventType: data.type,
            eventCount,
          });
        }
      } catch (e) {
        const err = errInfo(e);
        if (err.message && !err.message.startsWith("Unexpected")) throw e;
        parseSkipCount++;
      }
    }
  }

  if (parseSkipCount > 0) {
    logEvent(scope, "parse_skip", { requestId, count: parseSkipCount });
  }

  return { images, usage, webSearchCalls, eventCount, eventTypes, extraIgnored };
}

/** Non-streaming Responses API body returned when the proxy answers with plain JSON. */
export interface OAuthResponsesJson {
  output?: Array<{ type?: string; result?: string; revised_prompt?: unknown }>;
  usage?: Record<string, number> | null;
}
