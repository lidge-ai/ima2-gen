import { setJobPhase } from "./inflight.js";
import { logEvent } from "./logger.js";
import { safeDiagnosticLabel } from "./diagnosticLabel.js";

export { safeDiagnosticLabel };

export interface ParsedImage {
  b64: string;
  revisedPrompt: string | null;
}

/** A client function-tool call the model emitted (the OAuth planner's image_gen call). */
export interface ParsedFunctionCall {
  name: string;
  arguments: string;
  callId: string | null;
}

export type FinalImageHandler = (image: ParsedImage, index: number) => Promise<void> | void;

export interface ResponseOutputSummary {
  eventType: string;
  itemType: string | null;
  status: string | null;
  hasResult: boolean;
  resultChars: number;
  revisedPromptChars: number;
  hasError: boolean;
  errorCode: string | null;
  errorType: string | null;
  errorParam: string | null;
}

export interface ResponseDiagnostics {
  eventTypes: Record<string, number>;
  streamStats: {
    chunkCount: number;
    bytesRead: number;
    maxChunkBytes: number;
    lfBoundaryCount: number;
    crlfBoundaryCount: number;
    parseSkipCount: number;
    finalBufferChars: number;
    sawDoneSentinel: boolean;
    sawResponseCompleted: boolean;
  };
  outputItemSummary: ResponseOutputSummary[];
  imageCallSeen: boolean;
  imageCallCompleted: boolean;
  imageCallFailed: boolean;
  imageResultCount: number;
  webSearchCallSeen: boolean;
  messageOutputSeen: boolean;
  outputTextChars: number;
}

export interface ParsedResponsesResult {
  images: ParsedImage[];
  usage: Record<string, number> | null;
  webSearchCalls: number;
  eventCount: number;
  eventTypes: Record<string, number>;
  extraIgnored: number;
  text: string | null;
  diagnostics: ResponseDiagnostics;
  functionCalls?: ParsedFunctionCall[];
}

interface SseItem {
  type?: string;
  partial_image_b64?: string;
  partial_image_index?: number;
  partial_image?: string;
  image?: string;
  result?: string;
  index?: number;
  revised_prompt?: string;
  status?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  error?: {
    code?: string;
    type?: string;
    param?: string;
  };
  content?: Array<{ type?: string; text?: string }>;
}

interface SseData {
  type?: string;
  delta?: string;
  text?: string;
  item?: SseItem;
  partial_image_b64?: string;
  partial_image_index?: number;
  partial_image?: string;
  image?: string;
  result?: string;
  index?: number;
  response?: {
    usage?: Record<string, number>;
    output?: SseItem[];
    tool_usage?: { web_search?: { num_requests?: number } };
  };
  error?: { code?: string };
}

interface ParseState {
  images: ParsedImage[];
  functionCalls: ParsedFunctionCall[];
  eventTypes: Record<string, number>;
  outputItemSummary: ResponseOutputSummary[];
  usage: Record<string, number> | null;
  textOutput: string;
  finalTextOutput: string | null;
  webSearchCalls: number;
  eventCount: number;
  extraIgnored: number;
  chunkCount: number;
  bytesRead: number;
  maxChunkBytes: number;
  lfBoundaryCount: number;
  crlfBoundaryCount: number;
  parseSkipCount: number;
  finalBufferChars: number;
  sawDoneSentinel: boolean;
  sawResponseCompleted: boolean;
  imageCallSeen: boolean;
  imageCallCompleted: boolean;
  imageCallFailed: boolean;
  imageResultCount: number;
  webSearchCallSeen: boolean;
  messageOutputSeen: boolean;
}

function createState(): ParseState {
  return {
    images: [],
    functionCalls: [],
    eventTypes: {},
    outputItemSummary: [],
    usage: null,
    textOutput: "",
    finalTextOutput: null,
    webSearchCalls: 0,
    eventCount: 0,
    extraIgnored: 0,
    chunkCount: 0,
    bytesRead: 0,
    maxChunkBytes: 0,
    lfBoundaryCount: 0,
    crlfBoundaryCount: 0,
    parseSkipCount: 0,
    finalBufferChars: 0,
    sawDoneSentinel: false,
    sawResponseCompleted: false,
    imageCallSeen: false,
    imageCallCompleted: false,
    imageCallFailed: false,
    imageResultCount: 0,
    webSearchCallSeen: false,
    messageOutputSeen: false,
  };
}

function extractSseData(block: string): string {
  let eventData = "";
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("data:")) eventData += line.slice(5).trimStart();
  }
  return eventData;
}

function nextSseBlock(buffer: string): { block: string; rest: string; delimiter: string } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (!match) return null;
  return {
    block: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
    delimiter: match[0],
  };
}

function extractPartialImage(data: SseData): { b64: string; index: number | null } | null {
  if (typeof data?.type !== "string" || !data.type.includes("partial")) return null;
  const item = data.item || {};
  const b64 =
    data.partial_image_b64 ||
    data.partial_image ||
    data.image ||
    data.result ||
    item.partial_image_b64 ||
    item.partial_image ||
    item.image ||
    item.result;
  if (typeof b64 !== "string" || b64.length === 0) return null;
  const index =
    typeof data.partial_image_index === "number" && Number.isFinite(data.partial_image_index)
      ? data.partial_image_index
      : typeof data.index === "number" && Number.isFinite(data.index)
      ? data.index
      : typeof item.partial_image_index === "number" && Number.isFinite(item.partial_image_index)
        ? item.partial_image_index
      : typeof item.index === "number" && Number.isFinite(item.index)
        ? item.index
        : null;
  return { b64, index };
}

function extractTextDelta(data: SseData): string | null {
  if (data.type === "response.output_text.delta" && typeof data.delta === "string") return data.delta;
  return null;
}

function extractFinalText(data: SseData): string | null {
  if (data.type === "response.output_text.done" && typeof data.text === "string") return cleanTextOutput(data.text);
  if (data.type === "response.output_item.done" && data.item?.type === "message") {
    return extractJsonItemText(data.item);
  }
  return null;
}

function extractJsonItemText(item: { type?: string; text?: string; content?: Array<{ type?: string; text?: string }> }): string | null {
  if (item.type === "output_text" && typeof item.text === "string") return cleanTextOutput(item.text);
  if (!Array.isArray(item.content)) return null;
  const text = item.content
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n\n");
  return cleanTextOutput(text);
}

function cleanTextOutput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 4_000) : null;
}

function summarizeItem(eventType: string, item: SseItem): ResponseOutputSummary {
  const result = typeof item.result === "string" ? item.result : "";
  const revised = typeof item.revised_prompt === "string" ? item.revised_prompt : "";
  return {
    eventType: safeDiagnosticLabel(eventType, "_unknown") || "_unknown",
    itemType: safeDiagnosticLabel(item.type),
    status: safeDiagnosticLabel(item.status),
    hasResult: result.length > 0,
    resultChars: result.length,
    revisedPromptChars: revised.length,
    hasError: Boolean(item.error),
    errorCode: safeDiagnosticLabel(item.error?.code),
    errorType: safeDiagnosticLabel(item.error?.type),
    errorParam: safeDiagnosticLabel(item.error?.param),
  };
}

function recordOutputItem(state: ParseState, eventType: string, item: SseItem | undefined): void {
  if (!item) return;
  const summary = summarizeItem(eventType, item);
  state.outputItemSummary.push(summary);
  if (item.type === "image_generation_call") {
    state.imageCallSeen = true;
    state.imageCallCompleted = state.imageCallCompleted || eventType === "response.output_item.done" || item.status === "completed";
    state.imageCallFailed = state.imageCallFailed || item.status === "failed" || Boolean(item.error);
    if (summary.hasResult) state.imageResultCount++;
  }
  if (item.type === "web_search_call") state.webSearchCallSeen = true;
  if (item.type === "message") state.messageOutputSeen = true;
  if (item.type === "function_call" && typeof item.name === "string") {
    const callId = typeof item.call_id === "string" ? item.call_id : null;
    const duplicate = callId !== null && state.functionCalls.some((call) => call.callId === callId);
    if (!duplicate) {
      state.functionCalls.push({
        name: item.name,
        arguments: typeof item.arguments === "string" ? item.arguments : "",
        callId,
      });
    }
  }
}

function diagnosticsFromState(state: ParseState): ResponseDiagnostics {
  const outputTextChars = (state.finalTextOutput ?? cleanTextOutput(state.textOutput) ?? "").length;
  return {
    eventTypes: state.eventTypes,
    streamStats: {
      chunkCount: state.chunkCount,
      bytesRead: state.bytesRead,
      maxChunkBytes: state.maxChunkBytes,
      lfBoundaryCount: state.lfBoundaryCount,
      crlfBoundaryCount: state.crlfBoundaryCount,
      parseSkipCount: state.parseSkipCount,
      finalBufferChars: state.finalBufferChars,
      sawDoneSentinel: state.sawDoneSentinel,
      sawResponseCompleted: state.sawResponseCompleted,
    },
    outputItemSummary: state.outputItemSummary,
    imageCallSeen: state.imageCallSeen,
    imageCallCompleted: state.imageCallCompleted,
    imageCallFailed: state.imageCallFailed,
    imageResultCount: state.imageResultCount,
    webSearchCallSeen: state.webSearchCallSeen,
    messageOutputSeen: state.messageOutputSeen,
    outputTextChars,
  };
}

function resultFromState(state: ParseState): ParsedResponsesResult {
  const text = state.finalTextOutput ?? cleanTextOutput(state.textOutput);
  return {
    images: state.images,
    usage: state.usage,
    webSearchCalls: state.webSearchCalls,
    eventCount: state.eventCount,
    eventTypes: state.eventTypes,
    extraIgnored: state.extraIgnored,
    text,
    diagnostics: diagnosticsFromState(state),
    ...(state.functionCalls.length ? { functionCalls: state.functionCalls } : {}),
  };
}

interface ParseStreamOptions {
  requestId?: string | null | undefined;
  scope: string;
  maxImages?: number | undefined;
  onPartialImage?: ((partial: { b64: string | undefined; index: number | null | undefined }) => void) | null | undefined;
  onFinalImage?: FinalImageHandler | null | undefined;
}

function makeStreamError(message: string, code: string, eventCount: number, eventType: string): Error {
  const err = new Error(message) as Error & { code?: string; upstreamCode?: string; status?: number; eventCount?: number; eventType?: string };
  err.code = "RESPONSES_STREAM_ERROR";
  err.upstreamCode = code;
  err.status = 502;
  err.eventCount = eventCount;
  err.eventType = eventType;
  Object.defineProperty(err, "ima2ResponsesError", { value: true });
  return err;
}

async function appendFinalImageFromItem(
  state: ParseState,
  item: SseItem,
  maxImages: number,
  requestId: string | null | undefined,
  onFinalImage: FinalImageHandler | null,
): Promise<void> {
  if (item.type !== "image_generation_call" || typeof item.result !== "string" || !item.result) return;
  if (state.images.some((image) => image.b64 === item.result)) return;
  if (state.images.length < maxImages) {
    const image = {
      b64: item.result,
      revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : null,
    };
    const index = state.images.length;
    state.images.push(image);
    if (requestId) setJobPhase(requestId, "decoding");
    await onFinalImage?.(image, index);
  } else {
    state.extraIgnored++;
  }
}

export async function parseStream(res: Response, {
  requestId,
  scope,
  maxImages = 1,
  onPartialImage = null,
  onFinalImage = null,
}: ParseStreamOptions): Promise<ParsedResponsesResult> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const state = createState();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    state.chunkCount++;
    state.bytesRead += value.byteLength;
    state.maxChunkBytes = Math.max(state.maxChunkBytes, value.byteLength);
    buffer += decoder.decode(value, { stream: true });
    let next;
    while ((next = nextSseBlock(buffer)) !== null) {
      const block = next.block;
      buffer = next.rest;
      if (next.delimiter.includes("\r\n")) state.crlfBoundaryCount++;
      else state.lfBoundaryCount++;
      const eventData = extractSseData(block);
      if (eventData === "[DONE]") {
        state.sawDoneSentinel = true;
        continue;
      }
      if (!eventData) continue;
      let data: SseData;
      try { data = JSON.parse(eventData); } catch { state.parseSkipCount++; continue; }
      state.eventCount++;
      const eventType = safeDiagnosticLabel(data.type, "_unknown") || "_unknown";
      state.eventTypes[eventType] = (state.eventTypes[eventType] || 0) + 1;
      const delta = extractTextDelta(data);
      if (delta) state.textOutput += delta;
      const finalText = extractFinalText(data);
      if (finalText) state.finalTextOutput = finalText;
      if (finalText) state.messageOutputSeen = true;
      const partial = extractPartialImage(data);
      if (partial && typeof onPartialImage === "function") onPartialImage(partial);
      if (data.type === "response.output_item.done") recordOutputItem(state, data.type, data.item);
      if (data.type === "response.output_item.done" && data.item?.type === "image_generation_call") {
        await appendFinalImageFromItem(state, data.item, maxImages, requestId, onFinalImage);
      }
      if (data.type === "response.output_item.done" && data.item?.type === "web_search_call") state.webSearchCalls++;
      if (data.type === "response.completed") {
        state.sawResponseCompleted = true;
        state.usage = data.response?.usage || null;
        for (const item of data.response?.output || []) {
          recordOutputItem(state, data.type, item);
          await appendFinalImageFromItem(state, item, maxImages, requestId, onFinalImage);
        }
        const wsNum = data.response?.tool_usage?.web_search?.num_requests;
        if (typeof wsNum === "number" && wsNum > state.webSearchCalls) state.webSearchCalls = wsNum;
      }
      if (data.type === "error") {
        throw makeStreamError(
          "Responses stream returned an error",
          safeDiagnosticLabel(data.error?.code, "RESPONSES_STREAM_ERROR") || "RESPONSES_STREAM_ERROR",
          state.eventCount,
          eventType,
        );
      }
    }
  }
  state.finalBufferChars = buffer.length;
  logEvent(scope, "stream_end", {
    requestId,
    events: state.eventCount,
    imageCount: state.images.length,
    webSearchCalls: state.webSearchCalls,
    imageCallSeen: state.imageCallSeen,
    messageOutputSeen: state.messageOutputSeen,
    bytesRead: state.bytesRead,
    parseSkipCount: state.parseSkipCount,
  });
  return resultFromState(state);
}

export async function parseJson(res: Response, maxImages: number): Promise<ParsedResponsesResult> {
  const json = await res.json() as {
    output?: SseItem[];
    usage?: Record<string, number>;
  };
  const state = createState();
  state.usage = json.usage || null;
  for (const item of json.output || []) {
    state.eventCount++;
    state.eventTypes["json.output"] = (state.eventTypes["json.output"] || 0) + 1;
    recordOutputItem(state, "json.output", item);
    if (item.type === "image_generation_call" && item.result && state.images.length < maxImages) {
      state.images.push({
        b64: item.result,
        revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : null,
      });
    }
    if (item.type === "web_search_call") state.webSearchCalls++;
    const itemText = extractJsonItemText(item);
    if (itemText) state.textOutput += `${state.textOutput ? "\n\n" : ""}${itemText}`;
  }
  return resultFromState(state);
}
