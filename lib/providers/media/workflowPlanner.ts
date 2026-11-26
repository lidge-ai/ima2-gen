import { oauthFetch } from "../../codexBackend/index.js";
import { WorkflowError } from "../../workflows/errors.js";
import type { TextPlanRequest } from "../../workflows/types.js";
import type { RuntimeContext } from "../../runtimeContext.js";

function outputText(json: unknown): string {
  const obj = (json ?? {}) as { output_text?: unknown; output?: unknown };
  if (typeof obj.output_text === "string") return obj.output_text;
  for (const item of Array.isArray(obj.output) ? obj.output : []) {
    const content = (item as { content?: unknown })?.content;
    for (const part of Array.isArray(content) ? content : []) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text === "string") return text;
    }
  }
  return "";
}

function userContent(request: TextPlanRequest): unknown {
  if (!request.images?.length) return request.user;
  return [
    { type: "input_text", text: request.user },
    ...request.images.map((image) => ({ type: "input_image", image_url: "data:" + image.mimeType + ";base64," + Buffer.from(image.bytes).toString("base64") })),
  ];
}

/**
 * gateway.planText for the L6 engine (Director shot planning): one JSON-mode call
 * on the GPT OAuth transport the rest of ima2 already uses for planners. Images (Remix
 * captions) go in as input_image parts.
 */
export function createOAuthPlanText(ctx: Pick<RuntimeContext, "oauthUrl" | "oauthTransport" | "config">) {
  const { model, timeoutMs } = ctx.config.workflowPlanner;
  return async (request: TextPlanRequest, signal: AbortSignal): Promise<unknown> => {
    const res = await oauthFetch({ oauthUrl: ctx.oauthUrl, oauthTransport: ctx.oauthTransport, config: ctx.config }, "/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      body: JSON.stringify({
        model,
        stream: false,
        input: [{ role: "system", content: `${request.system}\nReply with JSON only.` }, { role: "user", content: userContent(request) }],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!res.ok) {
      throw new WorkflowError("WORKFLOW_PLANNER_FAILED", `The text planner (${model}) answered HTTP ${res.status}`, {
        status: 502, retryable: res.status === 429 || res.status >= 500, category: res.status === 401 || res.status === 403 ? "auth" : "upstream",
      });
    }
    try {
      return JSON.parse(outputText(await res.json()));
    } catch {
      throw new WorkflowError("WORKFLOW_PLANNER_INVALID", "The text planner did not return JSON", { status: 502, retryable: true });
    }
  };
}
