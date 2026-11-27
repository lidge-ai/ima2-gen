import { fetchApi, jsonFetch } from "./api-core";
import { armStreamTimeout, subscribe, whenConnected } from "./eventChannel";
import { parseSseErrorPayload } from "./sseStreamError";
import { fetchMediaCatalog } from "./mediaCatalog";
import { resolveRoute } from "./mediaRoutes";
import type { MediaSelection } from "./mediaSelection";
import type { MediaInput, MediaInputRole } from "./mediaSubmitBody";
import { inputProblem, inputRoles } from "./mediaTasks";
import { t } from "../i18n";

export type MediaOutput = { filename: string; url: string; mediaType: "image" | "video" };

export function cancelMediaJob(id: string): Promise<unknown> {
  return jsonFetch(`/api/media/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

async function inputFor(value: string, role: MediaInputRole, signal: AbortSignal): Promise<MediaInput> {
  if (value.startsWith("/generated/")) return { role, filename: decodeURIComponent(value.slice(11).split(/[?#]/, 1)[0]) };
  if (/^https:\/\//i.test(value)) return { role, url: value };
  if (!value.startsWith("data:") && !value.startsWith("blob:")) throw new Error(t("toast.refNotBase64"));
  const response = await fetch(value, { signal });
  if (!response.ok) throw new Error(t("toast.refNotBase64"));
  const blob = await response.blob();
  const uploaded = await jsonFetch<{ ref: string }>("/api/media/inputs", {
    method: "POST", headers: { "Content-Type": blob.type }, body: blob, signal,
  });
  return { role, ref: uploaded.ref };
}

export async function prepareMediaInputs(selection: MediaSelection, references: string[], signal: AbortSignal): Promise<{ inputs: MediaInput[]; adapter: string }> {
  const catalog = await fetchMediaCatalog(selection.kind);
  const model = catalog.models.find((item) => item.id === selection.model);
  const resolved = model && resolveRoute(model, selection);
  if (!resolved || !resolved.route.tasks.includes(selection.task)) throw new Error(t("mediaPicker.loadError"));
  if (resolved.state === "needs-key") throw new Error(t("mediaPicker.noKey"));
  const route = resolved.route;
  // The settings panel already explains a tray that does not fit; this is the last check before upload.
  const problem = inputProblem(selection.task, route, references.length);
  if (problem) throw new Error(`${t("toast.generateFailed")} (${selection.task}: ${problem.have}/${problem.min}–${problem.max})`);
  const roles = inputRoles(selection.task, references.length);
  return { inputs: await Promise.all(references.map((value, index) => inputFor(value, roles[index]!, signal))), adapter: route.adapter };
}

export async function submitMediaJob(payload: Record<string, unknown>, id: string, signal: AbortSignal,
  callbacks: { onSubmitted?: () => void; onProgress?: (data: Record<string, unknown>) => void } = {},
): Promise<MediaOutput[]> {
  signal.throwIfAborted();
  return new Promise<MediaOutput[]>((resolve, reject) => {
    let settled = false;
    let cancelRequested = false;
    const finish = (error?: unknown, outputs?: MediaOutput[]) => {
      if (settled) return;
      settled = true; unsubscribe(); clearTimer(); signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(outputs ?? []);
    };
    const unsubscribe = subscribe(id, null, (event, data) => {
      if (data.jobKind !== "media") return;
      if (event === "submitted") callbacks.onSubmitted?.();
      if (event === "progress") callbacks.onProgress?.(data);
      if (event === "done") {
        if (!Array.isArray(data.outputs) || data.outputs.length === 0 || data.outputs.some((item: MediaOutput) =>
          !item || typeof item.filename !== "string" || typeof item.url !== "string" || (item.mediaType !== "image" && item.mediaType !== "video"))) {
          finish(new Error(t("toast.generateFailed")));
        } else finish(undefined, data.outputs as MediaOutput[]);
      }
      if (event === "error") finish(parseSseErrorPayload(data, t("toast.generateFailed")));
    });
    const clearTimer = armStreamTimeout(() => {
      cancelRequested = true;
      void cancelMediaJob(id).catch(() => {});
      finish(new Error(t("toast.generateFailed")));
    });
    const onAbort = () => { cancelRequested = true; finish(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    void (async () => {
      await whenConnected();
      if (settled) return;
      signal.throwIfAborted();
      const response = await fetchApi("/api/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (cancelRequested && response.ok) { await cancelMediaJob(id); return; }
      if (!response.ok) throw parseSseErrorPayload(data, `Request failed: ${response.status}`);
    })().catch(finish);
  });
}
