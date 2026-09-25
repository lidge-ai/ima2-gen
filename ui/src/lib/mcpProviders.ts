import { useCallback, useEffect, useState } from "react";
import { jsonFetch, jsonGetObservation } from "./api-core";
import { armStreamTimeout, subscribe, whenConnected } from "./eventChannel";
import { parseSseErrorPayload } from "./sseStreamError";

export type McpConnectionState =
  | "disconnected"
  | "connecting"
  | "auth_required"
  | "connected"
  | "offline"
  | "error";

export type McpSnapshotDiff = {
  drifted: string[];
  missing: string[];
  added: string[];
};

export type McpProviderStatus = {
  provider: string;
  state: McpConnectionState;
  authorizationUrl?: string;
  detail?: string;
  toolCount?: number;
  connectedAt?: string;
  snapshotDiff?: McpSnapshotDiff;
};

export type McpProviderRecord = {
  id: string;
  endpoint: string;
  enabled: boolean;
  /** Server-side execution capability (false = catalog-only/locked). */
  executable?: boolean;
  /** Server-supplied reason when execution is locked. */
  lockReason?: string;
  status: McpProviderStatus;
};

type McpProvidersResponse = { ok: boolean; providers: McpProviderRecord[] };
type McpStatusResponse = { ok: boolean; status: McpProviderStatus };

export type McpGenerateInput = {
  provider: string;
  kind: "image" | "video";
  prompt: string;
  model?: string;
  ratio?: string;
  parameters?: Record<string, McpPresetValue>;
  startFrameFilename?: string;
  endFrameFilename?: string;
  /** Up to 3 tagged references; tag is the @alias usable in the prompt. */
  references?: Array<{ filename: string; tag?: string }>;
  referenceVideoFilename?: string;
  /** Character element whose provider binding expands into references server-side. */
  characterElementId?: string;
  requestId?: string;
};

export type McpDoneResult = {
  requestId: string;
  filename: string;
  url: string;
  mediaType: "image" | "video";
  provider?: string;
  model?: string | null;
  createdAt?: number;
};

type McpJobCallbacks = {
  onDone: (result: McpDoneResult) => void | Promise<void>;
  onError?: (error: Error & { code?: string }) => void;
};

const PROVIDER_POLL_MS = 10_000;
let providerCache: McpProviderRecord[] = [];

export async function listMcpProviders(signal?: AbortSignal): Promise<McpProviderRecord[]> {
  const response = await jsonFetch<McpProvidersResponse>("/api/mcp/providers", { signal });
  providerCache = Array.isArray(response.providers) ? response.providers : [];
  return providerCache;
}

export function readMcpProviderObservation(signal?: AbortSignal): Promise<unknown> {
  return jsonGetObservation("/api/mcp/providers", signal);
}

export function readMcpModelObservation(provider: string, signal?: AbortSignal): Promise<unknown> {
  return jsonGetObservation(`/api/mcp/providers/${encodeURIComponent(provider)}/models`, signal);
}

export function getCachedMcpProviders(): readonly McpProviderRecord[] {
  return providerCache;
}

export function getConnectedMcpProvider(id: string): McpProviderRecord | null {
  return providerCache.find((provider) => provider.id === id && provider.status.state === "connected") ?? null;
}

export async function connectMcpProvider(id: string): Promise<McpProviderStatus> {
  const popup = window.open("about:blank", `ima2_mcp_${id}`);
  try {
    const response = await jsonFetch<McpStatusResponse>(
      `/api/mcp/providers/${encodeURIComponent(id)}/connect`,
      { method: "POST" },
    );
    const authorizationUrl = response.status.authorizationUrl;
    if (authorizationUrl) {
      if (!popup) throw new Error("MCP_POPUP_BLOCKED");
      popup.location.href = authorizationUrl;
    } else {
      popup?.close();
    }
    return response.status;
  } catch (error) {
    popup?.close();
    throw error;
  }
}

export async function refreshMcpProvider(id: string): Promise<McpProviderStatus> {
  const response = await jsonFetch<McpStatusResponse>(
    `/api/mcp/providers/${encodeURIComponent(id)}/refresh`,
    { method: "POST" },
  );
  return response.status;
}

export async function disconnectMcpProvider(id: string): Promise<McpProviderStatus> {
  const response = await jsonFetch<McpStatusResponse>(
    `/api/mcp/providers/${encodeURIComponent(id)}/connection`,
    { method: "DELETE" },
  );
  return response.status;
}

function stringEnum(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export async function getMcpModelOptions(
  provider: string,
  kind: "image" | "video",
  signal?: AbortSignal,
): Promise<string[]> {
  const toolId = `mcp.${provider}.generate_${kind}`;
  const response = await jsonFetch<{
    ok: boolean;
    data?: {
      tool?: {
        inputSchema?: {
          properties?: { model?: { enum?: unknown } };
        };
      };
    };
  }>(`/api/contracts/${encodeURIComponent(toolId)}`, { signal });
  return stringEnum(response.data?.tool?.inputSchema?.properties?.model?.enum);
}

export type McpPresetValue = string | number | boolean;
export type McpInputRole =
  | "text"
  | "image"
  | "start_image"
  | "end_image"
  | "image_references"
  | "video_references"
  | (string & {});
export type McpModelParameter = {
  name: string;
  type: "string" | "number" | "boolean" | "string_array";
  required?: boolean;
  description?: string;
  default?: McpPresetValue;
  options?: McpPresetValue[];
  min?: number;
  max?: number;
};
export type McpModelCapabilities = {
  source: "provider-declared" | "verified-contract";
  aspectRatios: string[];
  parameters: McpModelParameter[];
  inputRoles: McpInputRole[];
};
export type McpModelEntry = {
  id: string;
  label: string;
  description?: string;
  capabilities: McpModelCapabilities;
  executable?: boolean;
  lockReason?: string;
};
export type McpModelCatalog = { image: McpModelEntry[]; video: McpModelEntry[] };

/**
 * Canonical enriched catalog for every MCP provider. Runway is a verified
 * projection of its authenticated schema description; Higgsfield is the
 * bounded read-only models_explore projection. Errors and AbortError propagate
 * so callers can preserve their existing retry/teardown behavior.
 */
export async function getMcpModelCatalog(
  provider: string,
  signal?: AbortSignal,
): Promise<McpModelCatalog> {
  const response = await jsonFetch<{ ok: boolean; models?: McpModelCatalog }>(
    `/api/mcp/providers/${encodeURIComponent(provider)}/models`,
    { signal },
  );
  const models = response.models;
  return {
    image: Array.isArray(models?.image) ? models.image : [],
    video: Array.isArray(models?.video) ? models.video : [],
  };
}

function normalizeDone(data: Record<string, unknown>, requestId: string): McpDoneResult | null {
  if (typeof data.filename !== "string" || typeof data.url !== "string") return null;
  if (data.mediaType !== "image" && data.mediaType !== "video") return null;
  const model = data.model;
  return {
    requestId,
    filename: data.filename,
    url: data.url,
    mediaType: data.mediaType,
    provider: typeof data.provider === "string" ? data.provider : undefined,
    model: typeof model === "string" || model === null ? model as string | null : undefined,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : undefined,
  };
}

function watchMcpJob(requestId: string, callbacks: McpJobCallbacks): () => void {
  let settled = false;
  const finish = () => {
    if (settled) return false;
    settled = true;
    unsubscribe();
    cancelTimeout();
    return true;
  };
  const unsubscribe = subscribe(requestId, null, (event, data) => {
    if (event === "done") {
      const result = normalizeDone(data, requestId);
      if (!result || !finish()) return;
      void Promise.resolve(callbacks.onDone(result)).catch((error) => {
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
      return;
    }
    if (event === "error" && finish()) {
      callbacks.onError?.(parseSseErrorPayload(data,
        typeof data.message === "string" ? data.message : "MCP generation failed"));
    }
  });
  const cancelTimeout = armStreamTimeout(() => {
    if (!finish()) return;
    const error = new Error("MCP generation timed out") as Error & { code?: string };
    error.code = "MCP_STREAM_TIMEOUT";
    callbacks.onError?.(error);
  });
  return finish;
}

export async function startMcpGeneration(
  input: McpGenerateInput,
  callbacks: McpJobCallbacks,
): Promise<string> {
  const requestId = input.requestId ?? `mcp_ui_${crypto.randomUUID()}`;
  const stopWatching = watchMcpJob(requestId, callbacks);
  try {
    // Await SSE transport open BEFORE submitting (same guard as videoExtendStream):
    // on a fresh connection a terminal job event emitted before the server-side
    // subscription is installed would be lost, hanging the job until timeout.
    await whenConnected();
    const providers = await listMcpProviders();
    const selected = providers.find((provider) => provider.id === input.provider);
    if (!selected || selected.status.state !== "connected") {
      const error = new Error("MCP provider is not connected") as Error & { code?: string };
      error.code = selected ? "MCP_NOT_CONNECTED" : "MCP_PROVIDER_UNKNOWN";
      throw error;
    }
    await jsonFetch<{ ok: boolean; requestId: string }>("/api/mcp/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, requestId }),
    });
    return requestId;
  } catch (error) {
    stopWatching();
    throw error;
  }
}

export function useMcpProviders(): {
  providers: McpProviderRecord[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const [providers, setProviders] = useState<McpProviderRecord[]>(() => [...providerCache]);
  const [loading, setLoading] = useState(providerCache.length === 0);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listMcpProviders();
      setProviders([...next]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), PROVIDER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { providers, loading, error, refresh };
}
