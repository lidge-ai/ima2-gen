import type {
  GenerateRequest,
  GenerateResponse,
  MultimodeGenerateRequest,
  MultimodeGenerateResponse,
  GenerateItem,
} from "../types";
import { fetchApi, jsonFetch } from "./api-core";
import { subscribe, ensureConnected, armStreamTimeout } from "./eventChannel";
import { cancelInflight } from "./api-inflight";
import { parseSseErrorPayload } from "./sseStreamError";
import { mergeAbortSignals, submitAsyncJobWithCapacityRetry } from "./asyncJobSubmit";

export function postGenerate(payload: GenerateRequest): Promise<GenerateResponse> {
  return jsonFetch<GenerateResponse>("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function postGenerateStream(
  payload: GenerateRequest,
  options: { signal?: AbortSignal } = {},
): Promise<GenerateResponse> {
  const requestId = payload.requestId ?? `freq_${crypto.randomUUID()}`;
  ensureConnected();

  return new Promise<GenerateResponse>((resolve, reject) => {
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
      if (event === "done") {
        finish(() => resolve(data as unknown as GenerateResponse));
      } else if (event === "error") {
        finish(() => reject(parseSseErrorPayload(data, "Generation failed")));
      }
    });
    const clearTimer = armStreamTimeout(() => {
      finish(() => {
        submitController.abort();
        void cancelInflight(requestId);
        reject(new Error("Generation stream timed out"));
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
      url: "/api/generate",
      payload: payload as unknown as Record<string, unknown>,
      requestId,
      signal: submitSignal,
      parseError: (res, data: Record<string, unknown>) => {
        const err = parseSseErrorPayload(data, `Request failed: ${res.status}`);
        err.status = err.status ?? res.status;
        return err;
      },
    }).then(() => {
      if (settled) return;
    }).catch((err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
  });
}

export async function postMultimodeGenerateStream(
  payload: MultimodeGenerateRequest,
  handlers: {
    onPartial?: (partial: { image: string; requestId?: string | null; sequenceId?: string | null; index?: number | null }) => void;
    onImage?: (image: GenerateItem) => void;
    onPhase?: (phase: { phase?: string; requestId?: string | null; sequenceId?: string | null; maxImages?: number }) => void;
  } = {},
  options: { signal?: AbortSignal } = {},
): Promise<MultimodeGenerateResponse> {
  const requestId = payload.requestId ?? `req_${crypto.randomUUID()}`;
  ensureConnected();

  return new Promise<MultimodeGenerateResponse>((resolve, reject) => {
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
        handlers.onPartial?.(data as { image: string; requestId?: string | null; sequenceId?: string | null; index?: number | null });
      } else if (event === "image") {
        handlers.onImage?.(data as unknown as GenerateItem);
      } else if (event === "phase") {
        handlers.onPhase?.(data as { phase?: string; requestId?: string | null; sequenceId?: string | null; maxImages?: number });
      } else if (event === "done") {
        finish(() => resolve(data as unknown as MultimodeGenerateResponse));
      } else if (event === "error") {
        finish(() => reject(parseSseErrorPayload(data, "Multimode generation failed")));
      }
    });
    const clearTimer = armStreamTimeout(() => {
      finish(() => {
        submitController.abort();
        void cancelInflight(requestId);
        reject(new Error("Multimode generation stream timed out"));
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
      url: "/api/generate/multimode",
      payload: payload as unknown as Record<string, unknown>,
      requestId,
      signal: submitSignal,
      parseError: (res, data: { error?: string; code?: string; status?: number }) => {
        const e = new Error(data.error ?? `Request failed: ${res.status}`) as Error & { code?: string; status?: number };
        e.code = data.code;
        e.status = data.status ?? res.status;
        return e;
      },
    }).then(() => {
      if (settled) return;
    }).catch((err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
  });
}

export function postEdit(payload: GenerateRequest & { mask?: string }): Promise<GenerateResponse> {
  return jsonFetch<GenerateResponse>("/api/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
export async function importLocalImage(file: File): Promise<GenerateItem> {
  const buffer = await file.arrayBuffer();
  const res = await fetchApi("/api/history/import-local", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "image/png",
      "X-Ima2-Original-Filename": encodeURIComponent(file.name),
    },
    body: buffer,
  });
  if (!res.ok) {
    let detail: { error?: string; code?: string } = {};
    try {
      detail = await res.json();
    } catch {
      /* ignore */
    }
    const err = new Error(detail.error || `Import failed (${res.status})`);
    (err as Error & { code?: string }).code = detail.code || "IMPORT_FAILED";
    throw err;
  }
  const json = (await res.json()) as { item: GenerateItem };
  return json.item;
}

export type PromptBuilderChatRequest = {
  backend?: PromptBuilderBackend;
  model?: string;
  messages: Array<{
    role: string;
    content: string;
    attachments?: Array<{
      kind: "image" | "text" | "file";
      name: string;
      mimeType: string;
      size: number;
      dataUrl?: string;
      text?: string;
    }>;
  }>;
  context?: {
    currentPrompt?: string;
    insertedPrompts?: Array<{ name?: string; text?: string }>;
    settings?: Record<string, unknown>;
    currentResultPrompt?: string | null;
  };
};

export type PromptBuilderBackend = "auto" | "oauth" | "grok" | "api" | "grok-api";

export type PromptBuilderConfigResponse = {
  backend: PromptBuilderBackend;
  model: string;
  options: {
    backends: PromptBuilderBackend[];
    models: Record<PromptBuilderBackend, string[]>;
    autoOrder: Exclude<PromptBuilderBackend, "auto">[];
  };
  locked: { backend: boolean; model: boolean };
};

export type PromptBuilderChatResponse = {
  provider: string;
  backend: Exclude<PromptBuilderBackend, "auto">;
  requestedBackend: PromptBuilderBackend;
  model: string;
  message: { role: "assistant"; content: string };
  usage: Record<string, unknown> | null;
};

export function postPromptBuilderChat(
  body: PromptBuilderChatRequest,
): Promise<PromptBuilderChatResponse> {
  return jsonFetch<PromptBuilderChatResponse>("/api/prompt-builder/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getPromptBuilderConfig(): Promise<PromptBuilderConfigResponse> {
  return jsonFetch<PromptBuilderConfigResponse>("/api/prompt-builder/config");
}

export function putPromptBuilderConfig(
  body: Pick<PromptBuilderConfigResponse, "backend" | "model">,
): Promise<PromptBuilderConfigResponse> {
  return jsonFetch<PromptBuilderConfigResponse>("/api/prompt-builder/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type VideoGenerateRequest = {
  prompt: string;
  provider?: "grok" | "grok-api" | "comfy" | "88api";
  model?: string;
  mode?: "text-to-video" | "image-to-video" | "reference-to-video";
  sourceImage?: string;
  providerUrl?: string;
  sourceFilename?: string;
  referenceImages?: string[];
  referenceFilenames?: string[];
  firstFrame?: string;
  lastFrame?: string;
  videoMode?: "frames" | "reference";
  generateAudio?: boolean;
  referenceVideos?: Array<{ url: string; duration: number }>;
  referenceAudioUrls?: Array<{ url: string; duration: number }>;
  continueFromVideo?: string;
  continuityLineage?: import("../types").VideoContinuityLineage | null;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  topic?: string;
  sessionId?: string | null;
  clientNodeId?: string | null;
  clientRequestId?: string;
  requestId?: string;
  storyboard?: boolean;
  backgroundPreset?: import("../types").AssetGenBackgroundPreset;
};

export type VideoGenerateDone = {
  requestId: string;
  filename: string;
  url: string;
  mediaType: "video";
  provider?: "grok" | "grok-api" | "comfy" | "88api";
  model?: string;
  providerTaskId?: string;
  revisedPrompt?: string | null;
  elapsed?: number;
  video?: Record<string, unknown>;
  providerUrl?: string | null;
  videoSeries?: { topic?: string; chainIndex?: number } | null;
  videoContinuity?: import("../types").VideoContinuityLineage | null;
  /**
   * The server reports the model it actually ran (`effectiveModel`) alongside what was
   * asked for (`requestedModel`); they differ when a fallback kicks in. Both were
   * missing from this type, which is why the node path had nothing to store and fell
   * back to `model: null` — see routes/video.ts done payload.
   */
  requestedModel?: string | null;
  effectiveModel?: string | null;
  modelFallback?: boolean;
};

export async function postVideoGenerateStream(
  payload: VideoGenerateRequest,
  handlers: {
    onPlanning?: () => void;
    onSubmitted?: (d: { xaiVideoRequestId?: string; providerTaskId?: string }) => void;
    onProgress?: (d: { progress?: number | null; stalled?: boolean }) => void;
  } = {},
  options: { signal?: AbortSignal } = {},
): Promise<VideoGenerateDone> {
  const requestId = payload.requestId ?? `vreq_${crypto.randomUUID()}`;
  ensureConnected();

  return new Promise<VideoGenerateDone>((resolve, reject) => {
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
      if (event === "planning") handlers.onPlanning?.();
      else if (event === "submitted") handlers.onSubmitted?.(data as { xaiVideoRequestId?: string; providerTaskId?: string });
      else if (event === "progress") handlers.onProgress?.(data as { progress?: number | null; stalled?: boolean });
      else if (event === "done") {
        finish(() => resolve(data as unknown as VideoGenerateDone));
      } else if (event === "error") {
        finish(() => reject(parseSseErrorPayload(data, "Video generation failed")));
      }
    });
    const clearTimer = armStreamTimeout(() => {
      finish(() => {
        submitController.abort();
        void cancelInflight(requestId);
        reject(new Error("Video generation stream timed out"));
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
      url: "/api/video/generate",
      payload: { provider: "grok", ...payload } as unknown as Record<string, unknown>,
      requestId,
      signal: submitSignal,
      parseError: (res, data: { error?: string; code?: string; status?: number }) => {
        const e = new Error(data.error ?? `Request failed: ${res.status}`) as Error & { code?: string; status?: number };
        e.code = data.code;
        e.status = data.status ?? res.status;
        return e;
      },
    }).then(() => {
      if (settled) return;
    }).catch((err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
  });
}
