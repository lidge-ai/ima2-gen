// lib/comfy/submit.ts — POST /prompt and file upload, shared by the classic lane and the media route.
import type { ComfyTarget } from "./access.js";
import { COMFY_ERR, canceled, comfyError, readJson } from "./artifacts.js";
import { comfyFetch, explainComfyRejection, redactForTarget, type ComfyRejection } from "./client.js";

/** Queues a bound graph. Returns the id ComfyUI queued the job under, or throws with the reasons it refused. */
export async function submitComfyPrompt(
  target: ComfyTarget,
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  let submitJson: Awaited<ReturnType<typeof readJson>>;
  try {
    const res = await comfyFetch(target, fetchImpl, "/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    submitJson = await readJson(res);
    if (!res.ok) {
      const reasons = explainComfyRejection(submitJson as ComfyRejection);
      const detail = reasons.length > 0 ? reasons.join("; ") : "HTTP " + String(res.status);
      throw comfyError(
        COMFY_ERR.SUBMIT_REJECTED,
        redactForTarget(target, "ComfyUI rejected the workflow: " + detail),
        res.status === 400 ? 400 : 502,
      );
    }
  } catch (error: unknown) {
    if ((error as { code?: string }).code) throw error;
    if (signal?.aborted) throw canceled();
    throw comfyError(COMFY_ERR.OFFLINE, redactForTarget(target, "Could not reach ComfyUI at " + target.origin + ": " + (error instanceof Error ? error.message : "unknown error")));
  }
  // A 200 can still carry per-node validation failures.
  const nodeErrors = submitJson?.node_errors;
  if (nodeErrors && typeof nodeErrors === "object" && Object.keys(nodeErrors).length > 0) {
    const reasons = explainComfyRejection({ node_errors: nodeErrors } as ComfyRejection);
    throw comfyError(COMFY_ERR.SUBMIT_REJECTED, redactForTarget(target, "ComfyUI rejected nodes: " + reasons.join("; ")), 400);
  }
  const promptId = typeof submitJson?.prompt_id === "string" ? submitJson.prompt_id : null;
  if (!promptId) throw comfyError(COMFY_ERR.SUBMIT_REJECTED, "ComfyUI did not return a prompt_id.");
  return promptId;
}

/**
 * Puts a file in the server's input folder and returns the name ComfyUI gave it.
 *
 * /upload/image is ComfyUI's one upload route: its own editor sends video and
 * audio through it too. The returned name can differ from the one sent (a clash
 * becomes "name (1).ext"), so the graph must use what comes back.
 */
export async function uploadComfyInput(
  target: ComfyTarget,
  fetchImpl: typeof fetch,
  file: { bytes: Uint8Array; mimeType: string; name: string },
  timeoutMs: number,
): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.mimeType }), file.name);
  form.append("type", "input");
  let res: Response;
  try {
    res = await comfyFetch(target, fetchImpl, "/upload/image", { method: "POST", body: form, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error: unknown) {
    throw comfyError(COMFY_ERR.OFFLINE, redactForTarget(target, "Could not upload an input to ComfyUI at " + target.origin + ": " + (error instanceof Error ? error.message : "unknown error")));
  }
  const body = res.ok ? await res.json().catch(() => null) as { name?: unknown } | null : null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    throw comfyError(COMFY_ERR.INPUT_INVALID, "ComfyUI did not accept the uploaded input (HTTP " + String(res.status) + ").", res.status === 413 ? 400 : 502);
  }
  return body.name;
}
