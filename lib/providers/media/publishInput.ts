import type { MediaInput } from "./contract.js";
import { WorkflowError } from "../../workflows/errors.js";

const SUME_API = "https://api.sume.com";

/**
 * Makes a local input reachable by URL through Sume's file upload, which its client README
 * documents as free: POST /v1/files/generate-upload-url {content_type, size_bytes}, PUT the bytes
 * to the returned upload_url without the key, then use public_url. Used for workflow video inputs
 * that providers read only by URL (BytePlus Seedance takes no inline video).
 */
export function createSumePublisher(apiKey: string, fetchImpl: typeof fetch = globalThis.fetch, baseUrl = SUME_API) {
  return async (input: MediaInput, signal: AbortSignal): Promise<{ url: string }> => {
    if (!input.bytes) throw new WorkflowError("WORKFLOW_INTERNAL", "nothing to publish", { status: 500 });
    const res = await fetchImpl(baseUrl + "/v1/files/generate-upload-url", {
      method: "POST", signal,
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ content_type: input.mimeType, size_bytes: input.bytes.byteLength }),
    });
    if (!res.ok) {
      throw new WorkflowError("WORKFLOW_PUBLISH_FAILED", "Sume upload link failed (HTTP " + res.status + ")", { status: 502, retryable: res.status >= 500, category: res.status === 401 || res.status === 403 ? "auth" : "upstream" });
    }
    const body = (await res.json()) as { data?: unknown };
    const link = (body.data ?? body) as { upload_url?: string; upload_method?: string; upload_headers?: Record<string, string>; public_url?: string };
    if (!link.upload_url || !link.public_url) throw new WorkflowError("WORKFLOW_PUBLISH_FAILED", "Sume upload link had no URL", { status: 502 });
    const put = await fetchImpl(link.upload_url, {
      method: link.upload_method ?? "PUT", signal,
      headers: link.upload_headers ?? { "Content-Type": input.mimeType },
      body: new Uint8Array(input.bytes),
    });
    if (!put.ok) throw new WorkflowError("WORKFLOW_PUBLISH_FAILED", "Sume storage upload failed (HTTP " + put.status + ")", { status: 502, retryable: put.status >= 500 });
    return { url: link.public_url };
  };
}
