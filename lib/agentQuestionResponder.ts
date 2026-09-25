import { errInfo } from "./errInfo.js";
import { logEvent } from "./logger.js";
import { waitForOAuthReady } from "./oauthProxy/runtime.js";
import { oauthFetch } from "./codexBackend/index.js";
import { migrateOAuthImageModel } from "./oauthLegacyModels.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "./runtimeContext.js";

const AGENT_QUESTION_DEVELOPER_PROMPT = [
  "You are the text-only question mode for ima2-gen Agent.",
  "Answer the user's question directly and naturally in the user's language.",
  "Do not generate images, do not call image tools, and do not turn the question into an image prompt.",
  "Do not simply repeat the user's question unless the user explicitly asks you to repeat text.",
  "Keep the answer concise and useful for an image-generation workflow when relevant.",
].join(" ");

type AgentQuestionOptions = {
  provider?: string | undefined;
  model?: string | undefined;
  reasoningEffort?: string | undefined;
  requestId?: string | undefined;
  signal?: AbortSignal | null | undefined;
};

type AgentQuestionResult = {
  text: string;
  usage: Record<string, unknown> | null;
};

type QuestionEndpoint = {
  /** null for GPT OAuth: the request goes through oauthFetch. */
  url: string | null;
  headers: Record<string, string>;
};

type TextContentPart = {
  type?: string | undefined;
  text?: string | { value?: string } | undefined;
  value?: string | undefined;
  refusal?: string | undefined;
};

type TextResponseBody = {
  output_text?: string | undefined;
  output?: Array<{
    type?: string | undefined;
    content?: TextContentPart[] | undefined;
  }>;
  usage?: Record<string, unknown> | undefined;
};

type SseEvent = {
  type?: string | undefined;
  delta?: string | undefined;
  text?: string | undefined;
  item?: {
    type?: string | undefined;
    content?: TextContentPart[] | undefined;
  };
  response?: { usage?: Record<string, unknown> } | undefined;
  error?: { code?: string; message?: string };
};

export async function requestAgentQuestionAnswer(
  ctxRaw: RouteRuntimeContext,
  question: string,
  options: AgentQuestionOptions = {},
): Promise<AgentQuestionResult> {
  try {
    const ctx = requireRuntimeContext(ctxRaw);
    const endpoint = await resolveQuestionEndpoint(ctx, options.provider);
    const timeoutMs = ctx.config.oauth?.generationTimeoutMs ?? 120_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = options.signal ? combineSignals([controller.signal, options.signal]) : controller.signal;
    try {
      const init: RequestInit = {
        method: "POST",
        headers: endpoint.headers,
        signal,
        body: JSON.stringify({
          model: migrateOAuthImageModel(options.model || ctx.config.imageModels?.default || "gpt-6-luna"),
          input: [
            { role: "developer", content: AGENT_QUESTION_DEVELOPER_PROMPT },
            { role: "user", content: question },
          ],
          reasoning: { effort: options.reasoningEffort || "low" },
          stream: true,
        }),
      };
      const res = endpoint.url ? await fetch(endpoint.url, init) : await oauthFetch(ctx, "/v1/responses", init);
      logEvent("agent_question", "response", {
        requestId: options.requestId,
        provider: options.provider,
        status: res.status,
        contentType: res.headers.get("content-type"),
      });
      if (!res.ok) throw await questionHttpError(res, options.provider);
      const parsed = await readResponsesTextPayload(res);
      if (!parsed.text.trim()) throw questionError("Agent question returned an empty response", "AGENT_QUESTION_EMPTY", 502);
      return { text: parsed.text.trim().slice(0, 4_000), usage: parsed.usage };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const err = errInfo(error);
    if (err.name === "AbortError") {
      throw questionError("Agent question timed out", "AGENT_QUESTION_TIMEOUT", 504, err.raw);
    }
    throw err.raw;
  }
}

async function resolveQuestionEndpoint(
  ctx: ReturnType<typeof requireRuntimeContext>,
  provider: string | undefined,
): Promise<QuestionEndpoint> {
  try {
    if (provider === "api") {
      if (!ctx.apiKey) throw questionError("API key is required for Agent question mode", "API_KEY_REQUIRED", 401);
      return {
        url: "https://api.openai.com/v1/responses",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${ctx.apiKey}`,
        },
      };
    }
    await waitForOAuthReady(ctx);
    return {
      url: null, // GPT OAuth: oauthFetch routes to the native Codex client or the proxy
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    };
  } catch (error) {
    throw errInfo(error).raw;
  }
}

async function questionHttpError(res: Response, provider: string | undefined): Promise<Error> {
  try {
    const text = await res.text();
    const err = questionError(
      `${provider === "api" ? "OpenAI API" : "OAuth proxy"} rejected Agent question mode`,
      "AGENT_QUESTION_UPSTREAM_FAILED",
      res.status >= 400 && res.status < 600 ? res.status : 502,
    );
    err.upstreamBodyChars = text.length;
    return err;
  } catch (error) {
    throw errInfo(error).raw;
  }
}

// Shared with the agent planner: the bundled OAuth proxy returns an empty
// `output` array for stream:false Responses calls, so any text consumer must
// be able to read the SSE stream instead of relying on the JSON body.
export async function readResponsesTextPayload(res: Response): Promise<AgentQuestionResult> {
  return res.headers.get("content-type")?.includes("text/event-stream")
    ? readTextStream(res)
    : readTextBody(await res.json() as TextResponseBody);
}

async function readTextStream(res: Response): Promise<AgentQuestionResult> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return { text: "", usage: null };
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let usage: Record<string, unknown> | null = null;
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseSseEvent(block);
        if (event) collectTextEvent(event, parts, (nextUsage) => {
          usage = nextUsage;
        });
        boundary = buffer.indexOf("\n\n");
      }
    }
    const finalEvent = parseSseEvent(buffer);
    if (finalEvent) collectTextEvent(finalEvent, parts, (nextUsage) => {
      usage = nextUsage;
    });
    return { text: parts.join("").trim(), usage };
  } catch (error) {
    throw errInfo(error).raw;
  }
}

function readTextBody(body: TextResponseBody): AgentQuestionResult {
  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return { text: body.output_text, usage: body.usage ?? null };
  }
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    appendContentText(item.content, parts);
  }
  return { text: parts.join("\n\n").trim(), usage: body.usage ?? null };
}

function parseSseEvent(block: string): SseEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" ? parsed as SseEvent : null;
  } catch {
    return null;
  }
}

function collectTextEvent(
  event: SseEvent,
  parts: string[],
  setUsage: (usage: Record<string, unknown>) => void,
) {
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") parts.push(event.delta);
  if (event.type === "response.output_text.done" && typeof event.text === "string" && parts.length === 0) parts.push(event.text);
  if (event.type === "response.output_item.done" && event.item?.type === "message" && parts.length === 0) {
    appendContentText(event.item.content, parts);
  }
  if ((event.type === "response.completed" || event.type === "response.incomplete") && event.response?.usage) {
    setUsage(event.response.usage);
  }
  if (event.type === "error") {
    throw questionError(
      event.error?.message || "Agent question stream failed",
      event.error?.code || "AGENT_QUESTION_STREAM_ERROR",
      502,
    );
  }
}

function appendContentText(content: TextContentPart[] | undefined, parts: string[]) {
  for (const part of content ?? []) {
    if (typeof part.text === "string" && part.text.trim()) parts.push(part.text);
    else if (part.text && typeof part.text === "object" && typeof part.text.value === "string") parts.push(part.text.value);
    else if (typeof part.value === "string" && part.value.trim()) parts.push(part.value);
    else if (typeof part.refusal === "string" && part.refusal.trim()) parts.push(part.refusal);
  }
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  const only = signals[0];
  if (signals.length === 1 && only) return only;
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function questionError(message: string, code: string, status: number, cause?: unknown) {
  const err = new Error(message) as Error & {
    code?: string | undefined;
    status?: number | undefined;
    cause?: unknown | undefined;
    upstreamBodyChars?: number | undefined;
  };
  err.code = code;
  err.status = status;
  if (cause) err.cause = cause;
  return err;
}
