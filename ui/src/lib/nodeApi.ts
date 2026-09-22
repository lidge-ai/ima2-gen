import type { ImageToolModel } from "../types";
import { fetchApi } from "./api-core";
import type { ImageModel, Provider } from "../types";
import { subscribe, ensureConnected, armStreamTimeout } from "./eventChannel";
import { cancelInflight } from "./api-inflight";
import { parseSseErrorPayload } from "./sseStreamError";
import { mergeAbortSignals, submitAsyncJobWithCapacityRetry } from "./asyncJobSubmit";

export type NodeGenerateRequest = {
  parentNodeId: string | null;
  prompt: string;
  quality: string;
  size: string;
  format: string;
  moderation: "low" | "auto";
  model?: ImageModel;
  imageToolModel?: ImageToolModel;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  provider?: Provider;
  mode?: "auto" | "direct";
  contextMode?: "parent-plus-refs" | "parent-only" | "ancestry";
  searchMode?: "off" | "auto" | "on";
  webSearchEnabled?: boolean;
  references?: string[];
  /** Resolved element inputs for this run (higgsfield 120): server records
   * ids/revisions into the sidecar and appends notes at generation time
   * while keeping the stored prompt raw. */
  elementIds?: string[];
  elementRevisions?: Record<string, unknown>;
  elementNotes?: string[];
  requestId?: string;
  sessionId?: string | null;
  clientNodeId?: string | null;
  storyboard?: boolean;
  // NovelAI tuning. Node has its own request type — it does not derive from
  // GenerateRequest — so the fields are declared explicitly here too.
  negativePrompt?: string;
  steps?: number;
  scale?: number;
  cfgRescale?: number;
  sampler?: string;
  noiseSchedule?: string;
  seed?: number;
  straightAlpha?: boolean;
  varietyPlus?: boolean;
  ucPresetId?: string;
  qualityPresetId?: string;
};

export type NodeGenerateResponse = {
  nodeId: string;
  parentNodeId: string | null;
  requestId?: string | null;
  image: string;
  filename: string;
  url: string;
  elapsed: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  usage?: { total_tokens?: number } & Record<string, unknown>;
  webSearchCalls: number;
  provider: Provider;
  moderation?: string;
  model?: string | null;
  imageToolModel?: ImageToolModel | null;
  size?: string | null;
  refsCount?: number;
  contextMode?: "parent-plus-refs" | "parent-only" | "ancestry";
  searchMode?: "off" | "auto" | "on";
  revisedPrompt?: string | null;
  promptMode?: "auto" | "direct";
};

export type NodeErrorResponse = {
  error: { code: string; message: string };
  parentNodeId: string | null;
  status?: number;
};

export async function postNodeGenerate(payload: NodeGenerateRequest): Promise<NodeGenerateResponse> {
  const res = await fetchApi("/api/node/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as NodeErrorResponse;
    const msg = err?.error?.message ?? `Request failed: ${res.status}`;
    const e = new Error(msg) as Error & { code?: string; status?: number };
    e.code = err?.error?.code;
    e.status = err?.status ?? res.status;
    throw e;
  }
  return data as NodeGenerateResponse;
}

export async function postNodeGenerateStream(
  payload: NodeGenerateRequest,
  handlers: {
    onPartial?: (partial: { image: string; requestId?: string | null; index?: number | null }) => void;
    onPhase?: (phase: { phase?: string; requestId?: string | null }) => void;
  } = {},
  options: { signal?: AbortSignal } = {},
): Promise<NodeGenerateResponse> {
  const requestId = payload.requestId ?? `nreq_${crypto.randomUUID()}`;
  ensureConnected();

  return new Promise<NodeGenerateResponse>((resolve, reject) => {
    let settled = false;
    const submitController = new AbortController();
    const submitSignal = mergeAbortSignals(options.signal, submitController.signal);
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimer();
      unsub();
      fn();
    };
    const unsub = subscribe(requestId, null, (event, data) => {
      if (settled) return;
      if (event === "partial") {
        handlers.onPartial?.(data as { image: string; requestId?: string | null; index?: number | null });
      } else if (event === "phase") {
        handlers.onPhase?.(data as { phase?: string; requestId?: string | null });
      } else if (event === "done") {
        finish(() => resolve(data as unknown as NodeGenerateResponse));
      } else if (event === "error") {
        finish(() => reject(parseSseErrorPayload(data, "Node generation failed")));
      }
    });
    const clearTimer = armStreamTimeout(() => {
      finish(() => {
        submitController.abort();
        void cancelInflight(requestId);
        reject(new Error("Node generation stream timed out"));
      });
    });

    if (options.signal) {
      if (options.signal.aborted) {
        finish(() => {
          submitController.abort();
          void cancelInflight(requestId);
          reject(new DOMException("Aborted", "AbortError"));
        });
        return;
      }
      options.signal.addEventListener("abort", () => {
        finish(() => {
          submitController.abort();
          void cancelInflight(requestId);
          reject(new DOMException("Aborted", "AbortError"));
        });
      }, { once: true });
    }

    void submitAsyncJobWithCapacityRetry({
      url: "/api/node/generate",
      payload: payload as unknown as Record<string, unknown>,
      requestId,
      signal: submitSignal,
      parseError: (res, data: NodeErrorResponse) => {
        const msg = data?.error?.message ?? `Request failed: ${res.status}`;
        const e = new Error(msg) as Error & { code?: string; status?: number };
        e.code = data?.error?.code;
        e.status = data?.status ?? res.status;
        return e;
      },
    }).then(() => {
      if (settled) return;
    }).catch((err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
  });
}
