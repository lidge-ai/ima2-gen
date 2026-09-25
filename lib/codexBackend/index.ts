/**
 * GPT OAuth transport. \`oauthFetch(ctx, "/v1/…", init)\` is the single entry every GPT OAuth
 * caller uses:
 *   - native (default for a running server): ima2 calls chatgpt.com/backend-api/codex itself
 *     with the ChatGPT session file — no child proxy, no port;
 *   - proxy: plain HTTP to \`ctx.oauthUrl\` (IMA2_NO_OAUTH_PROXY pointing at an external
 *     OpenAI-compatible proxy, and every test that stubs the proxy URL).
 * The native side answers with the same OpenAI-compatible shapes the proxy returned, so callers
 * keep their parsing code.
 */
import { coerceReasoningEffortForModel } from "../imageModels.js";
import { codexCatalog, codexUpstream, isLiteModel } from "./client.js";
import {
  RESPONSES_LITE_HEADER,
  chatToResponsesBody,
  collectCompletedResponse,
  editsFormToJson,
  normalizeResponsesBody,
  responsesToChatCompletion,
} from "./normalize.js";
import { CodexSessionError } from "./session.js";

export { codexCatalog, codexSessionStore, setCodexSessionStoreForTests, codexClientVersion, resetCodexCaches } from "./client.js";
export { CodexSessionError } from "./session.js";

export const CODEX_IMAGE_MODEL = "gpt-image-2";

interface OAuthTransportContext {
  oauthUrl?: string | undefined;
  oauthTransport?: "native" | "proxy" | undefined;
}

type Json = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorResponse(message: string, status: number, code: string): Response {
  return jsonResponse({ error: { message, type: status === 401 ? "authentication_error" : "invalid_request_error", code } }, status);
}

async function readJsonBody(init: RequestInit): Promise<Json | null> {
  if (typeof init.body !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(init.body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : null;
  } catch {
    return null;
  }
}

/** POST a Responses body upstream; stream it back or collect it into the completed JSON. */
async function sendResponses(body: Json, wantsStream: boolean, signal: AbortSignal | null | undefined): Promise<Response> {
  const lite = await isLiteModel(body.model);
  const reasoning = body.reasoning && typeof body.reasoning === "object" ? { ...(body.reasoning as Json) } : null;
  if (reasoning && typeof body.model === "string") {
    reasoning.effort = coerceReasoningEffortForModel(body.model, reasoning.effort as string | undefined);
  }
  const normalized = normalizeResponsesBody(reasoning ? { ...body, reasoning } : body, lite);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
  if (lite) headers[RESPONSES_LITE_HEADER] = "true";
  const res = await codexUpstream("/responses", { method: "POST", headers, body: JSON.stringify(normalized), ...(signal ? { signal } : {}) });
  if (!res.ok || !res.body) return res;
  if (wantsStream) {
    return new Response(res.body, { status: res.status, headers: { "content-type": "text/event-stream" } });
  }
  const { response, error } = await collectCompletedResponse(res.body);
  if (response) return jsonResponse(response);
  return jsonResponse({ error: error ?? { message: "Codex response stream ended without a completed response" } }, 502);
}

async function routeResponses(init: RequestInit): Promise<Response> {
  const body = await readJsonBody(init);
  if (!body) return errorResponse("Responses requests need a JSON body.", 400, "invalid_request");
  return sendResponses(body, body.stream === true, init.signal);
}

async function routeChat(init: RequestInit): Promise<Response> {
  const body = await readJsonBody(init);
  if (!body) return errorResponse("Chat requests need a JSON body.", 400, "invalid_request");
  if (body.stream === true) return errorResponse("Streaming chat completions are not supported on GPT OAuth.", 400, "invalid_request");
  const res = await sendResponses(chatToResponsesBody(body), false, init.signal);
  if (!res.ok) return res;
  return jsonResponse(responsesToChatCompletion((await res.json()) as Json));
}

async function routeImages(kind: "generations" | "edits", init: RequestInit): Promise<Response> {
  let body: Json | null;
  if (kind === "edits" && typeof FormData !== "undefined" && init.body instanceof FormData) {
    body = await editsFormToJson(init.body);
  } else {
    body = await readJsonBody(init);
  }
  if (!body) return errorResponse("Image requests need a JSON or multipart body.", 400, "invalid_request");
  const { stream: _stream, response_format: _format, ...rest } = body;
  const payload = { ...rest, model: typeof rest.model === "string" && rest.model ? rest.model : CODEX_IMAGE_MODEL };
  return codexUpstream(`/images/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

async function routeModels(): Promise<Response> {
  const models = await codexCatalog();
  if (!models.length) return errorResponse("Failed to load models from Codex.", 502, "catalog_unavailable");
  const ids = [...new Set([...models.map((model) => model.slug), CODEX_IMAGE_MODEL])];
  return jsonResponse({ object: "list", data: ids.map((id) => ({ id, object: "model", created: 0, owned_by: "codex-oauth" })) });
}

/** In-process equivalent of the proxy's /v1 surface. */
export async function codexFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const route = path.split("?")[0];
    if (route === "/v1/responses") return await routeResponses(init);
    if (route === "/v1/chat/completions") return await routeChat(init);
    if (route === "/v1/images/generations") return await routeImages("generations", init);
    if (route === "/v1/images/edits") return await routeImages("edits", init);
    if (route === "/v1/models") return await routeModels();
    return errorResponse(`Unknown GPT OAuth route ${route}`, 404, "not_found");
  } catch (error) {
    if (error instanceof CodexSessionError) return errorResponse(error.message, 401, error.code);
    throw error;
  }
}

export function usesNativeOAuth(ctx: OAuthTransportContext | null | undefined): boolean {
  return ctx?.oauthTransport === "native";
}

/** An external endpoint URL without embedded credentials or a trailing slash. */
export function safeOAuthBaseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return value.replace(/\/+$/, "");
  }
}

/** The one call every GPT OAuth caller makes. */
export function oauthFetch(ctx: OAuthTransportContext | null | undefined, path: string, init: RequestInit = {}): Promise<Response> {
  if (usesNativeOAuth(ctx)) return codexFetch(path, init);
  const base = safeOAuthBaseUrl(ctx?.oauthUrl || "http://127.0.0.1:10531");
  return fetch(`${base}${path}`, init);
}
