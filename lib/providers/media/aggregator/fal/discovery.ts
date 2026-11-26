/**
 * fal live catalog via the public Platform API (GET /v1/models, cursor paged).
 * The listing needs no key, but the user's key is sent so the per-key rate
 * limit applies instead of the anonymous one.
 */
import type { MediaAdapterContext, MediaKind, MediaModelSpec, MediaTask } from "../../contract.js";
import type { EndpointSchema } from "../shared/fields.js";
import { asArray, asRecord, asString, requestJson } from "../shared/http.js";
import { endpointFromJsonSchema, requestSchemaFromOpenApi } from "../shared/openapi.js";
import { readFalError } from "./errors.js";

const PLATFORM = "https://api.fal.ai/v1";
const PREFIX = "FAL";
const PAGE_LIMIT = 100;
const MAX_PAGES = 30;

const CATEGORY_TASK: Record<string, { task: MediaTask; kind: MediaKind }> = {
  "text-to-image": { task: "text-to-image", kind: "image" },
  "image-to-image": { task: "image-to-image", kind: "image" },
  "text-to-video": { task: "text-to-video", kind: "video" },
  "image-to-video": { task: "image-to-video", kind: "video" },
  "video-to-video": { task: "video-to-video", kind: "video" },
  "text-to-audio": { task: "text-to-audio", kind: "audio" },
  "text-to-speech": { task: "text-to-audio", kind: "audio" },
  "video-to-audio": { task: "video-to-audio", kind: "audio" },
};

function headers(ctx: MediaAdapterContext): Record<string, string> {
  return { authorization: `Key ${ctx.apiKey}` };
}

function specFromListing(model: Record<string, unknown>): MediaModelSpec | undefined {
  const id = asString(model.endpoint_id);
  const meta = asRecord(model.metadata);
  const mapped = CATEGORY_TASK[asString(meta.category) ?? ""];
  if (!id || !mapped || (asString(meta.status) ?? "active") !== "active") return undefined;
  return {
    id, upstreamId: id, vendor: id.split("/")[0] ?? "fal", label: asString(meta.display_name) ?? id,
    kind: mapped.kind, tasks: [mapped.task], params: {}, pricing: [], docsUrl: `https://fal.ai/models/${id}`,
  };
}

/** Curated specs first, then every active media endpoint not already routed by one. */
export async function discoverFalModels(ctx: MediaAdapterContext, curated: readonly MediaModelSpec[]): Promise<readonly MediaModelSpec[]> {
  const routed = new Set(curated.map((spec) => spec.upstreamId));
  const found: MediaModelSpec[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = `limit=${PAGE_LIMIT}&status=active${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const body = asRecord(await requestJson(ctx, { url: `${PLATFORM}/models?${query}`, headers: headers(ctx), prefix: PREFIX, readError: readFalError }));
    for (const raw of asArray(body.models)) {
      const spec = specFromListing(asRecord(raw));
      if (spec && !routed.has(spec.id)) found.push(spec);
    }
    cursor = asString(body.next_cursor);
    if (body.has_more !== true || !cursor) break;
  }
  return [...curated, ...found];
}

/** Reads one endpoint's OpenAPI input schema so an uncurated endpoint can be submitted. */
export async function falEndpointFromPlatform(
  ctx: MediaAdapterContext, endpointId: string,
): Promise<{ schema: EndpointSchema; kind: MediaKind } | undefined> {
  const url = `${PLATFORM}/models?endpoint_id=${encodeURIComponent(endpointId)}&expand=openapi-3.0`;
  const body = asRecord(await requestJson(ctx, { url, headers: headers(ctx), prefix: PREFIX, readError: readFalError }));
  const model = asArray(body.models).map(asRecord).find((m) => m.endpoint_id === endpointId);
  if (!model) return undefined;
  const mapped = CATEGORY_TASK[asString(asRecord(model.metadata).category) ?? ""];
  const inputSchema = requestSchemaFromOpenApi(model.openapi);
  if (!mapped || !inputSchema) return undefined;
  return { schema: endpointFromJsonSchema(endpointId, mapped.task, inputSchema), kind: mapped.kind };
}
