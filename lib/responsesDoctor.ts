import { config as defaultConfig } from "../config.js";
import { errInfo } from "./errInfo.js";
import { parseJson, parseStream, safeDiagnosticLabel, type ResponseDiagnostics } from "./responsesParse.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";
import { runOAuthImageJob } from "./oauthImages.js";
import { migrateOAuthImageModel } from "./oauthLegacyModels.js";
import {
  GENERATE_DEVELOPER_PROMPT,
  GENERATE_NO_SEARCH_DEVELOPER_PROMPT,
  buildUserTextPrompt,
} from "./oauthProxy.js";

type ToolChoiceSummary = "none" | "required" | "image_generation";
type ProbeExpectation = "text" | "image";

interface ProbeSpec {
  id: string;
  expectation: ProbeExpectation;
  promptId: string;
  promptChars: number;
  stream: boolean;
  toolTypes: string[];
  toolChoiceKind: ToolChoiceSummary;
  payload: Record<string, unknown>;
}

export interface ImageDoctorProbeOptions {
  provider?: string | undefined;
  apiKey?: string | undefined;
  oauthUrl?: string | undefined;
  model?: string | undefined;
  size?: string | undefined;
  quality?: string | undefined;
  moderation?: string | undefined;
  prompt?: string | undefined;
  matrix?: boolean | undefined;
  timeoutMs?: number | undefined;
  ctx?: RouteRuntimeContext | undefined;
}

export interface ImageDoctorProbeResult {
  id: string;
  ok: boolean;
  expectation: ProbeExpectation;
  diagnosticReason: string | null;
  request: {
    stream: boolean;
    toolTypes: string[];
    toolChoiceKind: ToolChoiceSummary;
    promptId: string;
    promptChars: number;
  };
  response: {
    httpStatus: number | null;
    contentType: string | null;
    upstreamRequestId: string | null;
    durationMs: number;
    eventCount: number;
    eventTypes: Record<string, number>;
    webSearchCalls: number;
    textOutputChars: number;
    imageResultCount: number;
    firstImageChars: number;
    diagnostics: ResponseDiagnostics | null;
  };
  error: {
    code: string | null;
    type: string | null;
    param: string | null;
    message: string;
    upstreamBodyChars?: number | undefined;
  } | null;
}

const BUILTIN_PROMPT_ID = "builtin_cat";
const BUILTIN_CAT_PROMPT = "고양이";
const TEXT_OK_PROMPT = "Reply with exactly OK.";

function imageTool(size: string, quality: string, moderation: string) {
  return { type: "image_generation", size, quality, moderation, action: "generate" };
}

function createProbeSpecs({
  model,
  size,
  quality,
  moderation,
  prompt,
  matrix,
}: { model: string; size: string; quality: string; moderation: string; prompt: string; matrix: boolean }): ProbeSpec[] {
  const imageOnlyTools = [imageTool(size, quality, moderation)];
  const webSearchImageTools = [{ type: "web_search" }, imageTool(size, quality, moderation)];
  const specs: ProbeSpec[] = [
    {
      id: "text_sanity",
      expectation: "text",
      promptId: "builtin_text_ok",
      promptChars: TEXT_OK_PROMPT.length,
      stream: false,
      toolTypes: [],
      toolChoiceKind: "none",
      payload: {
        model,
        input: [{ role: "user", content: TEXT_OK_PROMPT }],
        stream: false,
      },
    },
    {
      id: "minimal_image_non_stream",
      expectation: "image",
      promptId: BUILTIN_PROMPT_ID,
      promptChars: (prompt ?? BUILTIN_CAT_PROMPT).length,
      stream: false,
      toolTypes: ["image_generation"],
      toolChoiceKind: "image_generation",
      payload: {
        model,
        input: [{ role: "user", content: prompt ?? BUILTIN_CAT_PROMPT }],
        tools: imageOnlyTools,
        tool_choice: { type: "image_generation" },
        stream: false,
      },
    },
    {
      id: "minimal_image_stream",
      expectation: "image",
      promptId: BUILTIN_PROMPT_ID,
      promptChars: (prompt ?? BUILTIN_CAT_PROMPT).length,
      stream: true,
      toolTypes: ["image_generation"],
      toolChoiceKind: "image_generation",
      payload: {
        model,
        input: [{ role: "user", content: prompt ?? BUILTIN_CAT_PROMPT }],
        tools: imageOnlyTools,
        tool_choice: { type: "image_generation" },
        stream: true,
      },
    },
  ];
  if (!matrix) return specs;
  return [
    ...specs,
    {
      id: "current_payload_no_search_required",
      expectation: "image",
      promptId: BUILTIN_PROMPT_ID,
      promptChars: (prompt ?? BUILTIN_CAT_PROMPT).length,
      stream: true,
      toolTypes: ["image_generation"],
      toolChoiceKind: "required",
      payload: {
        model,
        input: [
          { role: "developer", content: GENERATE_NO_SEARCH_DEVELOPER_PROMPT },
          { role: "user", content: buildUserTextPrompt(prompt, "auto", { webSearchEnabled: false, size }) },
        ],
        tools: imageOnlyTools,
        tool_choice: "required",
        reasoning: { effort: "low" },
        stream: true,
      },
    },
    {
      id: "current_payload_web_search_required",
      expectation: "image",
      promptId: BUILTIN_PROMPT_ID,
      promptChars: (prompt ?? BUILTIN_CAT_PROMPT).length,
      stream: true,
      toolTypes: ["web_search", "image_generation"],
      toolChoiceKind: "required",
      payload: {
        model,
        input: [
          { role: "developer", content: GENERATE_DEVELOPER_PROMPT },
          { role: "user", content: buildUserTextPrompt(prompt, "auto", { webSearchEnabled: true, size }) },
        ],
        tools: webSearchImageTools,
        tool_choice: "required",
        reasoning: { effort: "low" },
        stream: true,
      },
    },
    {
      id: "current_payload_web_search_forced_image",
      expectation: "image",
      promptId: BUILTIN_PROMPT_ID,
      promptChars: (prompt ?? BUILTIN_CAT_PROMPT).length,
      stream: true,
      toolTypes: ["web_search", "image_generation"],
      toolChoiceKind: "image_generation",
      payload: {
        model,
        input: [
          { role: "developer", content: GENERATE_DEVELOPER_PROMPT },
          { role: "user", content: buildUserTextPrompt(prompt, "auto", { webSearchEnabled: true, size }) },
        ],
        tools: webSearchImageTools,
        tool_choice: { type: "image_generation" },
        reasoning: { effort: "low" },
        stream: true,
      },
    },
  ];
}

async function endpointFor(provider: string, options: ImageDoctorProbeOptions) {
  const ctx = options.ctx || { config: defaultConfig };
  if (provider === "api") {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      Authorization: apiAuthorizationHeader(options.apiKey),
    };
    return {
      url: "https://api.openai.com/v1/responses",
      headers,
    };
  }
  // GPT OAuth probes go through runOAuthLaneProbe; only the API key lane reaches here.
  void ctx;
  throw Object.assign(new Error(`hosted-tool probes are API-only (provider ${provider})`), { code: "PROBE_PROVIDER_UNSUPPORTED" });
}

function apiAuthorizationHeader(apiKey: string | undefined) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    throw Object.assign(new Error("API key is required for API provider image probe"), {
      code: "API_KEY_REQUIRED",
    });
  }
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    throw Object.assign(new Error("API key contains invalid characters."), {
      code: "AUTH_API_KEY_INVALID",
    });
  }
  return `Bearer ${key}`;
}

function sanitizeProbeErrorMessage(value: string) {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi, "$1[redacted]@")
    .replace(/([?&](?:access_token|api_key|key|secret|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[^"'\s]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]");
}

function safeUpstreamError(text: string) {
  try {
    const parsed = JSON.parse(text);
    const error = parsed?.error || {};
    return {
      code: safeDiagnosticLabel(error.code),
      type: safeDiagnosticLabel(error.type),
      param: safeDiagnosticLabel(error.param),
    };
  } catch {
    return { code: null, type: null, param: null };
  }
}

function reasonFrom(result: Omit<ImageDoctorProbeResult, "diagnosticReason">): string | null {
  const diagnostics = result.response.diagnostics;
  if (!result.error && result.ok) return null;
  if (result.error?.code) return result.error.code;
  if (!diagnostics) return "probe_failed";
  if (diagnostics.streamStats.bytesRead > 0 && result.response.eventCount === 0) return "stream_parse_failed";
  if (diagnostics.imageCallFailed) return "image_tool_failed";
  if (diagnostics.imageCallCompleted && diagnostics.imageResultCount === 0) return "image_tool_completed_without_result";
  if (!diagnostics.imageCallSeen && result.response.webSearchCalls > 0) return "web_search_only_response";
  if (!diagnostics.imageCallSeen && diagnostics.messageOutputSeen) return "image_tool_not_called";
  if (result.expectation === "text" && result.response.textOutputChars === 0) return "text_output_missing";
  if (result.expectation === "image" && result.response.imageResultCount === 0) return "image_output_missing";
  return "probe_failed";
}

async function runSingleProbe(provider: string, options: ImageDoctorProbeOptions, spec: ProbeSpec): Promise<ImageDoctorProbeResult> {
  const start = Date.now();
  let httpStatus: number | null = null;
  let contentType: string | null = null;
  let upstreamRequestId: string | null = null;
  try {
    const endpoint = await endpointFor(provider, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || defaultConfig.oauth.generationTimeoutMs);
    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: endpoint.headers,
        signal: controller.signal,
        body: JSON.stringify(spec.payload),
      });
      httpStatus = res.status;
      contentType = res.headers.get("content-type");
      upstreamRequestId = res.headers.get("x-request-id") || res.headers.get("openai-request-id");
      if (!res.ok) {
        const body = await res.text();
        const upstream = safeUpstreamError(body);
        const partial = {
          id: spec.id,
          ok: false,
          expectation: spec.expectation,
          request: {
            stream: spec.stream,
            toolTypes: spec.toolTypes,
            toolChoiceKind: spec.toolChoiceKind,
            promptId: spec.promptId,
            promptChars: spec.promptChars,
          },
          response: {
            httpStatus,
            contentType,
            upstreamRequestId,
            durationMs: Date.now() - start,
            eventCount: 0,
            eventTypes: {},
            webSearchCalls: 0,
            textOutputChars: 0,
            imageResultCount: 0,
            firstImageChars: 0,
            diagnostics: null,
          },
          error: {
            ...upstream,
            message: "Upstream returned a non-2xx response",
            upstreamBodyChars: body.length,
          },
        };
        return { ...partial, diagnosticReason: reasonFrom(partial) };
      }
      const parsed = contentType?.includes("text/event-stream")
        ? await parseStream(res, { scope: "doctor-image-probe", maxImages: 1 })
        : await parseJson(res, 1);
      const ok = spec.expectation === "image"
        ? Boolean(parsed.images[0]?.b64)
        : Boolean(parsed.text && parsed.text.trim());
      const partial = {
        id: spec.id,
        ok,
        expectation: spec.expectation,
        request: {
          stream: spec.stream,
          toolTypes: spec.toolTypes,
          toolChoiceKind: spec.toolChoiceKind,
          promptId: spec.promptId,
          promptChars: spec.promptChars,
        },
        response: {
          httpStatus,
          contentType,
          upstreamRequestId,
          durationMs: Date.now() - start,
          eventCount: parsed.eventCount,
          eventTypes: parsed.eventTypes,
          webSearchCalls: parsed.webSearchCalls,
          textOutputChars: parsed.text?.length || 0,
          imageResultCount: parsed.images.length,
          firstImageChars: parsed.images[0]?.b64.length || 0,
          diagnostics: parsed.diagnostics,
        },
        error: null,
      };
      return { ...partial, diagnosticReason: reasonFrom(partial) };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const err = errInfo(e);
    const partial = {
      id: spec.id,
      ok: false,
      expectation: spec.expectation,
      request: {
        stream: spec.stream,
        toolTypes: spec.toolTypes,
        toolChoiceKind: spec.toolChoiceKind,
        promptId: spec.promptId,
        promptChars: spec.promptChars,
      },
      response: {
        httpStatus,
        contentType,
        upstreamRequestId,
        durationMs: Date.now() - start,
        eventCount: Number((err.raw as { eventCount?: unknown | undefined })?.eventCount) || 0,
        eventTypes: {},
        webSearchCalls: 0,
        textOutputChars: 0,
        imageResultCount: 0,
        firstImageChars: 0,
        diagnostics: null,
      },
      error: {
        code: safeDiagnosticLabel(err.code),
        type: null,
        param: null,
        message: err.name === "AbortError" ? "Probe timed out" : sanitizeProbeErrorMessage(err.message),
      },
    };
    return { ...partial, diagnosticReason: reasonFrom(partial) };
  }
}


/**
 * GPT OAuth has no hosted image tool on GPT-6: the lane plans with the selected model and
 * renders through the Images API (lib/oauthImages.ts). Probe that lane end to end instead of
 * the hosted-tool variants, which would all fail by construction.
 */
async function runOAuthLaneProbe(
  options: ImageDoctorProbeOptions,
  id: string,
  mode: "auto" | "direct",
  settings: { model: string; size: string; quality: string; prompt: string },
): Promise<ImageDoctorProbeResult> {
  const start = Date.now();
  const ctx = {
    ...(options.ctx ?? { config: defaultConfig }),
    ...(options.oauthUrl ? { oauthUrl: options.oauthUrl, oauthTransport: "proxy" as const } : { oauthTransport: "native" as const }),
  } as RouteRuntimeContext;
  const request = { stream: true, toolTypes: ["function"], toolChoiceKind: "none" as ToolChoiceSummary, promptId: options.prompt ? "custom" : BUILTIN_PROMPT_ID, promptChars: settings.prompt.length };
  try {
    const result = await runOAuthImageJob({
      ctx, scope: "doctor-oauth", model: settings.model, mode, reasoningEffort: "low", webSearchEnabled: false,
      developerPrompt: GENERATE_NO_SEARCH_DEVELOPER_PROMPT,
      userText: buildUserTextPrompt(settings.prompt, mode, { webSearchEnabled: false, size: settings.size }),
      directPrompt: settings.prompt, images: [], maxImages: 1, quality: settings.quality, size: settings.size,
    });
    const image = result.images[0];
    const partial = {
      id, ok: Boolean(image?.b64), expectation: "image" as ProbeExpectation, request,
      response: {
        httpStatus: 200, contentType: "application/json", upstreamRequestId: null, durationMs: Date.now() - start,
        eventCount: result.eventCount, eventTypes: result.eventTypes, webSearchCalls: result.webSearchCalls,
        textOutputChars: result.text?.length ?? 0, imageResultCount: result.images.length,
        firstImageChars: image?.b64.length ?? 0, diagnostics: result.diagnostics,
      },
      error: null,
    };
    return { ...partial, diagnosticReason: reasonFrom(partial) };
  } catch (error) {
    const err = error as { status?: number; code?: string; message?: string };
    const partial = {
      id, ok: false, expectation: "image" as ProbeExpectation, request,
      response: {
        httpStatus: typeof err.status === "number" ? err.status : null, contentType: null, upstreamRequestId: null,
        durationMs: Date.now() - start, eventCount: 0, eventTypes: {}, webSearchCalls: 0, textOutputChars: 0,
        imageResultCount: 0, firstImageChars: 0, diagnostics: null,
      },
      error: { code: err.code ?? null, type: null, param: null, message: sanitizeProbeErrorMessage(err.message ?? "OAuth lane probe failed") },
    };
    return { ...partial, diagnosticReason: reasonFrom(partial) };
  }
}

export async function runImageDoctorProbe(options: ImageDoctorProbeOptions = {}) {
  const provider = options.provider || "oauth";
  const requested = options.model || defaultConfig.imageModels?.default || "gpt-6-luna";
  const model = provider === "oauth" ? migrateOAuthImageModel(requested) : requested;
  const size = options.size || "1024x1024";
  const quality = options.quality || "low";
  const moderation = options.moderation || "low";
  const prompt = options.prompt || BUILTIN_CAT_PROMPT;
  const specs = createProbeSpecs({
    model,
    size,
    quality,
    moderation,
    prompt,
    matrix: options.matrix === true,
  });
  const probes: ImageDoctorProbeResult[] = [];
  if (provider === "api") {
    for (const spec of specs) probes.push(await runSingleProbe(provider, options, spec));
  } else {
    const settings = { model, size, quality, prompt };
    probes.push(await runOAuthLaneProbe(options, "oauth_plan_render", "auto", settings));
    if (options.matrix === true) probes.push(await runOAuthLaneProbe(options, "oauth_direct_render", "direct", settings));
  }
  return {
    provider,
    endpointKind: provider === "api" ? "api" : "oauth",
    model,
    size,
    quality,
    moderation,
    promptId: options.prompt ? "custom" : BUILTIN_PROMPT_ID,
    promptChars: (prompt ?? BUILTIN_CAT_PROMPT).length,
    matrix: options.matrix === true,
    probes,
    summary: {
      ok: probes.every((probe) => probe.ok),
      passed: probes.filter((probe) => probe.ok).length,
      failed: probes.filter((probe) => !probe.ok).length,
    },
  };
}
